import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { v4 as uuid } from 'uuid';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JWT_SECRET = process.env.JWT_SECRET || 'focustrack-dev-secret-change-in-prod';
const PORT = process.env.PORT || 3000;

// ─── Database ─────────────────────────────────────────────────────────────────

const dbFile = join(__dirname, 'db.json');
const adapter = new JSONFile(dbFile);
const db = new Low(adapter, {
  users: [],
  sessions: [],
  goals: []
});

await db.read();
db.data ||= { users: [], sessions: [], goals: [] };
await db.write();

// ─── Auth Middleware ──────────────────────────────────────────────────────────

function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'No token' });
  const token = header.replace('Bearer ', '');
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ─── App Setup ────────────────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(join(__dirname, '../dashboard')));

// ─── Auth Routes ──────────────────────────────────────────────────────────────

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: 'All fields required' });

  await db.read();
  const exists = db.data.users.find(u => u.email === email.toLowerCase());
  if (exists) return res.status(409).json({ error: 'Email already registered' });

  const hashed = await bcrypt.hash(password, 10);
  const user = {
    id: uuid(),
    name,
    email: email.toLowerCase(),
    password: hashed,
    createdAt: new Date().toISOString()
  };
  db.data.users.push(user);
  await db.write();

  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '90d' });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'All fields required' });

  await db.read();
  const user = db.data.users.find(u => u.email === email.toLowerCase());
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '90d' });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
});

app.get('/api/auth/me', auth, async (req, res) => {
  await db.read();
  const user = db.data.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user: { id: user.id, name: user.name, email: user.email } });
});

// ─── Sessions Routes ──────────────────────────────────────────────────────────

app.post('/api/sessions/sync', auth, async (req, res) => {
  const { sessions } = req.body;
  if (!Array.isArray(sessions)) return res.status(400).json({ error: 'Invalid payload' });

  await db.read();

  const enriched = sessions.map(s => ({
    id: uuid(),
    userId: req.user.id,
    url: s.url,
    domain: s.domain,
    startTime: s.startTime,
    endTime: s.endTime,
    duration: s.duration,
    date: s.date || new Date(s.startTime).toISOString().split('T')[0]
  }));

  db.data.sessions.push(...enriched);
  await db.write();
  res.json({ synced: enriched.length });
});

app.get('/api/sessions', auth, async (req, res) => {
  await db.read();
  const { from, to, limit } = req.query;
  let sessions = db.data.sessions.filter(s => s.userId === req.user.id);

  if (from) sessions = sessions.filter(s => s.date >= from);
  if (to) sessions = sessions.filter(s => s.date <= to);

  sessions.sort((a, b) => b.startTime - a.startTime);
  if (limit) sessions = sessions.slice(0, parseInt(limit));

  res.json({ sessions });
});

// ─── Analytics Routes ─────────────────────────────────────────────────────────

app.get('/api/analytics/daily', auth, async (req, res) => {
  await db.read();
  const { days = 30 } = req.query;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - parseInt(days));
  const cutoffStr = cutoff.toISOString().split('T')[0];

  const sessions = db.data.sessions.filter(
    s => s.userId === req.user.id && s.date >= cutoffStr
  );

  // Group by date
  const daily = {};
  sessions.forEach(s => {
    if (!daily[s.date]) daily[s.date] = { date: s.date, totalSeconds: 0, domains: {} };
    daily[s.date].totalSeconds += s.duration;
    daily[s.date].domains[s.domain] = (daily[s.date].domains[s.domain] || 0) + s.duration;
  });

  res.json({ daily: Object.values(daily).sort((a, b) => a.date.localeCompare(b.date)) });
});

app.get('/api/analytics/top-domains', auth, async (req, res) => {
  await db.read();
  const { days = 7 } = req.query;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - parseInt(days));
  const cutoffStr = cutoff.toISOString().split('T')[0];

  const sessions = db.data.sessions.filter(
    s => s.userId === req.user.id && s.date >= cutoffStr
  );

  const domainMap = {};
  sessions.forEach(s => {
    domainMap[s.domain] = (domainMap[s.domain] || 0) + s.duration;
  });

  const sorted = Object.entries(domainMap)
    .map(([domain, seconds]) => ({ domain, seconds }))
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, 20);

  res.json({ domains: sorted });
});

// ─── Goals Routes ─────────────────────────────────────────────────────────────

app.get('/api/goals', auth, async (req, res) => {
  await db.read();
  const goals = db.data.goals.filter(g => g.userId === req.user.id);
  res.json({ goals });
});

app.post('/api/goals', auth, async (req, res) => {
  const { name, targetHours, targetMinutes, domains } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });

  await db.read();
  const goal = {
    id: uuid(),
    userId: req.user.id,
    name,
    targetHours: targetHours || 0,
    targetMinutes: targetMinutes || 0,
    domains: domains || [],
    createdAt: new Date().toISOString()
  };
  db.data.goals.push(goal);
  await db.write();
  res.json({ goal });
});

app.delete('/api/goals/:id', auth, async (req, res) => {
  await db.read();
  db.data.goals = db.data.goals.filter(
    g => !(g.id === req.params.id && g.userId === req.user.id)
  );
  await db.write();
  res.json({ ok: true });
});

// ─── Streaks API ──────────────────────────────────────────────────────────────

app.get('/api/streaks', auth, async (req, res) => {
  await db.read();
  const goals = db.data.goals.filter(g => g.userId === req.user.id);
  const allSessions = db.data.sessions.filter(s => s.userId === req.user.id);

  const streaks = goals.map(goal => {
    const domains = goal.domains || [];
    const targetSec = (goal.targetHours || 0) * 3600 + (goal.targetMinutes || 0) * 60;

    // Get all dates this user has sessions
    const dateMap = {};
    allSessions.forEach(s => {
      if (domains.includes(s.domain)) {
        dateMap[s.date] = (dateMap[s.date] || 0) + s.duration;
      }
    });

    // Find dates where goal was hit
    const hitDates = Object.entries(dateMap)
      .filter(([, sec]) => sec >= targetSec)
      .map(([d]) => d)
      .sort();

    // Calculate streak
    let current = 0, longest = 0, streak = 0;
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    for (let i = hitDates.length - 1; i >= 0; i--) {
      if (i === hitDates.length - 1) {
        if (hitDates[i] !== today && hitDates[i] !== yesterday) break;
        streak = 1;
      } else {
        const prev = new Date(hitDates[i + 1]);
        const curr = new Date(hitDates[i]);
        const diff = Math.round((prev - curr) / 86400000);
        if (diff === 1) streak++;
        else break;
      }
    }
    current = streak;
    longest = hitDates.length > 0 ? (() => {
      let best = 0, run = 1;
      for (let i = 1; i < hitDates.length; i++) {
        const diff = Math.round((new Date(hitDates[i]) - new Date(hitDates[i - 1])) / 86400000);
        if (diff === 1) { run++; best = Math.max(best, run); }
        else run = 1;
      }
      return Math.max(best, run);
    })() : 0;

    return {
      goalId: goal.id,
      goalName: goal.name,
      currentStreak: current,
      longestStreak: longest,
      totalDaysHit: hitDates.length,
      lastHit: hitDates[hitDates.length - 1] || null
    };
  });

  res.json({ streaks });
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🎯 FocusTrack API running at http://localhost:${PORT}\n`);
});

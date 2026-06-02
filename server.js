import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { v4 as uuid } from 'uuid';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JWT_SECRET = process.env.JWT_SECRET || 'focustrack-dev-secret-change-in-prod';
const PORT = process.env.PORT || 3000;

// ─── Database ─────────────────────────────────────────────────────────────────

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Create tables if they don't exist
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id UUID PRIMARY KEY,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      url TEXT,
      domain TEXT NOT NULL,
      start_time BIGINT,
      end_time BIGINT,
      duration INTEGER NOT NULL,
      date DATE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS goals (
      id UUID PRIMARY KEY,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      target_hours INTEGER DEFAULT 0,
      target_minutes INTEGER DEFAULT 0,
      domains TEXT[] DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user_date ON sessions(user_id, date);
    CREATE INDEX IF NOT EXISTS idx_goals_user ON goals(user_id);
  `);
  console.log('Database ready');
}

await initDB();

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

  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
  if (existing.rows.length) return res.status(409).json({ error: 'Email already registered' });

  const hashed = await bcrypt.hash(password, 10);
  const id = uuid();
  await pool.query(
    'INSERT INTO users (id, name, email, password) VALUES ($1, $2, $3, $4)',
    [id, name, email.toLowerCase(), hashed]
  );

  const token = jwt.sign({ id, email: email.toLowerCase() }, JWT_SECRET, { expiresIn: '90d' });
  res.json({ token, user: { id, name, email: email.toLowerCase() } });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'All fields required' });

  const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
  const user = result.rows[0];
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '90d' });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
});

app.get('/api/auth/me', auth, async (req, res) => {
  const result = await pool.query('SELECT id, name, email FROM users WHERE id = $1', [req.user.id]);
  if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
  res.json({ user: result.rows[0] });
});

// ─── Sessions Routes ──────────────────────────────────────────────────────────

app.post('/api/sessions/sync', auth, async (req, res) => {
  const { sessions } = req.body;
  if (!Array.isArray(sessions)) return res.status(400).json({ error: 'Invalid payload' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const s of sessions) {
      await client.query(
        `INSERT INTO sessions (id, user_id, url, domain, start_time, end_time, duration, date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          uuid(), req.user.id, s.url, s.domain,
          s.startTime, s.endTime, s.duration,
          s.date || new Date(s.startTime).toISOString().split('T')[0]
        ]
      );
    }
    await client.query('COMMIT');
    res.json({ synced: sessions.length });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Sync failed' });
  } finally {
    client.release();
  }
});

app.get('/api/sessions', auth, async (req, res) => {
  const { from, to, limit = 500 } = req.query;
  let query = 'SELECT * FROM sessions WHERE user_id = $1';
  const params = [req.user.id];

  if (from) { params.push(from); query += ` AND date >= $${params.length}`; }
  if (to)   { params.push(to);   query += ` AND date <= $${params.length}`; }

  query += ` ORDER BY start_time DESC LIMIT $${params.length + 1}`;
  params.push(parseInt(limit));

  const result = await pool.query(query, params);
  res.json({ sessions: result.rows });
});

// ─── Analytics Routes ─────────────────────────────────────────────────────────

app.get('/api/analytics/daily', auth, async (req, res) => {
  const { days = 30 } = req.query;
  const result = await pool.query(`
    SELECT
      date::text,
      SUM(duration) AS "totalSeconds",
      json_object_agg(domain, domain_total) AS domains
    FROM (
      SELECT date, domain, SUM(duration) AS domain_total
      FROM sessions
      WHERE user_id = $1 AND date >= CURRENT_DATE - ($2::int - 1)
      GROUP BY date, domain
    ) sub
    GROUP BY date
    ORDER BY date ASC
  `, [req.user.id, parseInt(days)]);

  res.json({ daily: result.rows });
});

app.get('/api/analytics/top-domains', auth, async (req, res) => {
  const { days = 7 } = req.query;
  const result = await pool.query(`
    SELECT domain, SUM(duration) AS seconds
    FROM sessions
    WHERE user_id = $1 AND date >= CURRENT_DATE - ($2::int - 1)
    GROUP BY domain
    ORDER BY seconds DESC
    LIMIT 20
  `, [req.user.id, parseInt(days)]);

  res.json({ domains: result.rows });
});

// ─── Goals Routes ─────────────────────────────────────────────────────────────

app.get('/api/goals', auth, async (req, res) => {
  const result = await pool.query(
    'SELECT id, user_id AS "userId", name, target_hours AS "targetHours", target_minutes AS "targetMinutes", domains, created_at AS "createdAt" FROM goals WHERE user_id = $1 ORDER BY created_at ASC',
    [req.user.id]
  );
  res.json({ goals: result.rows });
});

app.post('/api/goals', auth, async (req, res) => {
  const { name, targetHours, targetMinutes, domains } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });

  const id = uuid();
  await pool.query(
    'INSERT INTO goals (id, user_id, name, target_hours, target_minutes, domains) VALUES ($1, $2, $3, $4, $5, $6)',
    [id, req.user.id, name, targetHours || 0, targetMinutes || 0, domains || []]
  );
  res.json({ goal: { id, name, targetHours, targetMinutes, domains } });
});

app.delete('/api/goals/:id', auth, async (req, res) => {
  await pool.query('DELETE FROM goals WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  res.json({ ok: true });
});

// ─── Streaks API ──────────────────────────────────────────────────────────────

app.get('/api/streaks', auth, async (req, res) => {
  const goalsResult = await pool.query(
    'SELECT id, name, target_hours AS "targetHours", target_minutes AS "targetMinutes", domains FROM goals WHERE user_id = $1',
    [req.user.id]
  );
  const goals = goalsResult.rows;

  const streaks = await Promise.all(goals.map(async goal => {
    const targetSec = (goal.targetHours || 0) * 3600 + (goal.targetMinutes || 0) * 60;
    const domains = goal.domains || [];

    if (!domains.length || targetSec === 0) {
      return { goalId: goal.id, goalName: goal.name, currentStreak: 0, longestStreak: 0, totalDaysHit: 0, lastHit: null };
    }

    // Get all dates where this goal's domains were used enough
    const result = await pool.query(`
      SELECT date::text, SUM(duration) AS total
      FROM sessions
      WHERE user_id = $1 AND domain = ANY($2)
      GROUP BY date
      HAVING SUM(duration) >= $3
      ORDER BY date ASC
    `, [req.user.id, domains, targetSec]);

    const hitDates = result.rows.map(r => r.date);
    if (!hitDates.length) return { goalId: goal.id, goalName: goal.name, currentStreak: 0, longestStreak: 0, totalDaysHit: 0, lastHit: null };

    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    // Current streak (from end)
    let current = 0;
    for (let i = hitDates.length - 1; i >= 0; i--) {
      if (i === hitDates.length - 1) {
        if (hitDates[i] !== today && hitDates[i] !== yesterday) break;
        current = 1;
      } else {
        const diff = Math.round((new Date(hitDates[i+1]) - new Date(hitDates[i])) / 86400000);
        if (diff === 1) current++;
        else break;
      }
    }

    // Longest streak
    let longest = 1, run = 1;
    for (let i = 1; i < hitDates.length; i++) {
      const diff = Math.round((new Date(hitDates[i]) - new Date(hitDates[i-1])) / 86400000);
      if (diff === 1) { run++; longest = Math.max(longest, run); }
      else run = 1;
    }

    return {
      goalId: goal.id,
      goalName: goal.name,
      currentStreak: current,
      longestStreak: longest,
      totalDaysHit: hitDates.length,
      lastHit: hitDates[hitDates.length - 1]
    };
  }));

  res.json({ streaks });
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🎯 FocusTrack API running at http://localhost:${PORT}\n`);
});

# ◈ TimeWise

A Chromium browser extension + web dashboard to track your browsing activity, set time-based goals, and build daily streaks.

---

## Project Structure

```
timewise/
├── extension/          ← Load this into Chrome
│   ├── manifest.json
│   ├── background.js   ← Core tracker (service worker)
│   ├── popup.html/css/js
│   └── icons/
├── backend/            ← Node.js API server
│   ├── server.js
│   └── db.json         ← Auto-created file database
└── dashboard/          ← Served by the backend at /
    └── index.html
```

---

## Setup

### 1. Backend Server

**Requirements:** Node.js 18+

```bash
cd backend
npm install
node server.js
```

The server starts at `http://localhost:3000`.  
The dashboard is served at `http://localhost:3000` automatically.

**Environment variables (optional):**
```
PORT=3000
JWT_SECRET=your-secret-key-here
```

---

### 2. Chrome Extension

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer Mode** (top right toggle)
3. Click **Load Unpacked**
4. Select the `extension/` folder

The TimeWise icon will appear in your toolbar.

---

### 3. First Use

1. Click the extension icon → **Sign Up** with your email
2. Tracking starts automatically once logged in
3. Add goals in the popup (click **+ Add**) or on the dashboard
4. Open the dashboard at `http://localhost:3000` for full reports

---

## How It Works

### Tracking
- The background service worker watches `tabs.onActivated` and `tabs.onUpdated`
- It records time spent per domain (idle detection pauses tracking)
- Sessions are buffered locally and synced to the server every 5 minutes
- All data is also stored in `chrome.storage.local` for offline use

### Goals
- You define a goal with a **name**, **target time** (e.g. 1h 30m), and **domains**
- Multiple domains can be grouped into one goal (e.g. github.com + theodinproject.com = "Learning")
- Progress is calculated from actual tracked time today
- When you hit the target: **notification fires + streak updates**

### Streaks
- A streak increments when you hit a goal's target on consecutive days
- Missing a day resets the current streak (longest streak is preserved)
- Streaks are shown as 🔥 count in both the popup and dashboard

---

## Deploying to Production

### Backend (e.g., Railway, Render, Fly.io)

1. Push the `backend/` folder
2. Set `JWT_SECRET` env var to a random string
3. Copy your hosted URL (e.g. `https://timewise.up.railway.app`)

### Update URLs

Replace `http://localhost:3000` in three places:
- `extension/background.js` → `const API_BASE = '...'`
- `extension/popup.js` → `const API_BASE = '...'`
- `dashboard/index.html` → `const API = '...'`

Then reload the extension in Chrome.

---

## API Reference

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | /api/auth/register | — | Create account |
| POST | /api/auth/login | — | Get JWT token |
| GET | /api/auth/me | ✓ | Current user |
| POST | /api/sessions/sync | ✓ | Upload sessions |
| GET | /api/sessions | ✓ | List sessions |
| GET | /api/analytics/daily | ✓ | Daily totals |
| GET | /api/analytics/top-domains | ✓ | Top domains |
| GET | /api/goals | ✓ | List goals |
| POST | /api/goals | ✓ | Create goal |
| DELETE | /api/goals/:id | ✓ | Delete goal |
| GET | /api/streaks | ✓ | Streak data for all goals |

---

## Customization

### Change idle timeout
In `background.js`, edit:
```js
chrome.idle.setDetectionInterval(60); // seconds of no input
```

### Change sync frequency
```js
chrome.alarms.create('syncData', { periodInMinutes: 5 }); // every 5 mins
```

### Add more goal types
Currently goals are time-based. You can extend the goal schema to support:
- Session count goals (open site X times)
- Page visit goals
- Consecutive day goals without time targets

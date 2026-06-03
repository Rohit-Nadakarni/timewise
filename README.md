# Timewise

A Chromium browser extension and web dashboard for live browser activity tracking, focus goals, and streaks.

## Project Structure

```text
focustrack/
├── extension/          Load this into Chrome
│   ├── manifest.json
│   ├── background.js
│   ├── popup.html/css/js
│   └── icons/
├── backend/            Deploy this to Render
│   ├── server.js
│   ├── schema.sql      Run this in Supabase first
│   └── package.json
└── dashboard/          Served automatically by the backend
    └── index.html
```

## Deployment

### Supabase

1. Create a Supabase project.
2. Open SQL Editor.
3. Paste and run `backend/schema.sql`.
4. Copy the database connection string from Project Settings.

### Render

1. Create a Render web service.
2. Set the root directory to `backend`.
3. Use `npm install` as the build command.
4. Use `node server.js` as the start command.
5. Add `DATABASE_URL`, `JWT_SECRET`, and `NODE_ENV=production`.

### URLs

Update these constants if your deployed API or dashboard URL changes:

- `extension/background.js`: `API_BASE`
- `extension/popup.js`: `API_BASE`
- `dashboard/index.html`: `API`

## How It Works

- The extension samples open tabs every 3 seconds while the service worker is awake.
- The focused tab is recorded as active time.
- Other open tabs, idle browser time, and unfocused browser time are recorded as idle/open time.
- Sessions sync to the server every 3 seconds when the user is signed in.
- The dashboard polls the API every 3 seconds and renders active and idle time separately.
- Goals are calculated from active focused-tab time.

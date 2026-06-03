-- Timewise Database Schema
-- Paste this into Supabase SQL Editor and run it.

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
  date DATE NOT NULL,
  activity_type TEXT NOT NULL DEFAULT 'active'
);

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS activity_type TEXT NOT NULL DEFAULT 'active';

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
CREATE INDEX IF NOT EXISTS idx_sessions_user_activity_date ON sessions(user_id, activity_type, date);
CREATE INDEX IF NOT EXISTS idx_sessions_domain ON sessions(domain);
CREATE INDEX IF NOT EXISTS idx_goals_user ON goals(user_id);

PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, display_name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('user','admin')),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, subtitle TEXT NOT NULL,
  category TEXT NOT NULL, starts_at TEXT NOT NULL, location TEXT NOT NULL,
  capacity INTEGER NOT NULL CHECK(capacity>0), description TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS registrations (
  id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id),
  user_id TEXT NOT NULL REFERENCES users(id), display_name TEXT NOT NULL,
  email TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(event_id,user_id)
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id),
  csrf TEXT NOT NULL, expires INTEGER NOT NULL
);

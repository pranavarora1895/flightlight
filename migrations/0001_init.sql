CREATE TABLE users (
  id         TEXT PRIMARY KEY,
  email      TEXT UNIQUE NOT NULL,
  alert_min  INTEGER NOT NULL DEFAULT 2000,
  alert_max  INTEGER NOT NULL DEFAULT 2400,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL
);

CREATE TABLE magic_links (
  token      TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_magic_links_email ON magic_links(email);

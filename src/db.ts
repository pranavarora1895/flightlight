import {
  DEFAULT_DESTINATION,
  DEFAULT_HUBS,
  DEFAULT_ORIGIN,
  formatHubList,
  parseHubList,
} from "./airports";
import type { User, UserRoute } from "./types";

export function userRoute(user: User): UserRoute {
  return {
    origin: user.origin ?? DEFAULT_ORIGIN,
    destination: user.destination ?? DEFAULT_DESTINATION,
    hubs: parseHubList(user.hubs ?? formatHubList(DEFAULT_HUBS)),
  };
}

export async function upsertUser(
  db: D1Database,
  email: string,
): Promise<User> {
  const normalized = email.trim().toLowerCase();
  const existing = await db
    .prepare("SELECT * FROM users WHERE email = ?")
    .bind(normalized)
    .first<User>();

  if (existing) {
    return normalizeUser(existing);
  }

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO users (id, email, origin, destination, hubs, alert_min, alert_max, active, created_at)
       VALUES (?, ?, ?, ?, ?, 2000, 2400, 1, ?)`,
    )
    .bind(
      id,
      normalized,
      DEFAULT_ORIGIN,
      DEFAULT_DESTINATION,
      formatHubList(DEFAULT_HUBS),
      createdAt,
    )
    .run();

  return {
    id,
    email: normalized,
    origin: DEFAULT_ORIGIN,
    destination: DEFAULT_DESTINATION,
    hubs: formatHubList(DEFAULT_HUBS),
    alert_min: 2000,
    alert_max: 2400,
    active: 1,
    created_at: createdAt,
  };
}

function normalizeUser(user: User): User {
  return {
    ...user,
    origin: user.origin ?? DEFAULT_ORIGIN,
    destination: user.destination ?? DEFAULT_DESTINATION,
    hubs: user.hubs ?? formatHubList(DEFAULT_HUBS),
  };
}

export async function getUserById(
  db: D1Database,
  id: string,
): Promise<User | null> {
  const user = await db
    .prepare("SELECT * FROM users WHERE id = ?")
    .bind(id)
    .first<User>();
  return user ? normalizeUser(user) : null;
}

export async function getActiveUsers(db: D1Database): Promise<User[]> {
  const result = await db
    .prepare("SELECT * FROM users WHERE active = 1 ORDER BY created_at ASC")
    .all<User>();
  return (result.results ?? []).map(normalizeUser);
}

export async function updateUserSettings(
  db: D1Database,
  userId: string,
  settings: {
    origin: string;
    destination: string;
    hubs: string;
    alertMin: number;
    alertMax: number;
  },
): Promise<void> {
  await db
    .prepare(
      `UPDATE users SET origin = ?, destination = ?, hubs = ?, alert_min = ?, alert_max = ? WHERE id = ?`,
    )
    .bind(
      settings.origin,
      settings.destination,
      settings.hubs,
      settings.alertMin,
      settings.alertMax,
      userId,
    )
    .run();
}

export async function createMagicLink(
  db: D1Database,
  email: string,
  ttlMinutes: number,
): Promise<string> {
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
  await db
    .prepare("INSERT INTO magic_links (token, email, expires_at) VALUES (?, ?, ?)")
    .bind(token, email.trim().toLowerCase(), expiresAt)
    .run();
  return token;
}

export async function consumeMagicLink(
  db: D1Database,
  token: string,
): Promise<string | null> {
  const row = await db
    .prepare("SELECT email, expires_at FROM magic_links WHERE token = ?")
    .bind(token)
    .first<{ email: string; expires_at: string }>();

  if (!row) return null;

  await db.prepare("DELETE FROM magic_links WHERE token = ?").bind(token).run();

  if (new Date(row.expires_at).getTime() < Date.now()) {
    return null;
  }

  return row.email;
}

export async function createSession(
  db: D1Database,
  userId: string,
  ttlDays: number,
): Promise<string> {
  const token = crypto.randomUUID();
  const expiresAt = new Date(
    Date.now() + ttlDays * 24 * 60 * 60 * 1000,
  ).toISOString();

  await db
    .prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(token, userId, expiresAt)
    .run();

  return token;
}

export async function deleteSession(
  db: D1Database,
  token: string,
): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
}

export async function getUserBySessionToken(
  db: D1Database,
  token: string,
): Promise<User | null> {
  const row = await db
    .prepare(
      `SELECT u.* FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`,
    )
    .bind(token)
    .first<User>();

  if (!row) return null;

  const session = await db
    .prepare("SELECT expires_at FROM sessions WHERE token = ?")
    .bind(token)
    .first<{ expires_at: string }>();

  if (!session || new Date(session.expires_at).getTime() < Date.now()) {
    await deleteSession(db, token);
    return null;
  }

  return normalizeUser(row);
}

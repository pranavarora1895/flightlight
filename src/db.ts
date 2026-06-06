import {
  DEFAULT_DESTINATION,
  DEFAULT_ORIGIN,
  resolveHubsForRoute,
} from "./airports";
import {
  DEFAULT_CHECK_INTERVAL_DAYS,
  DEFAULT_DEPART_END,
  DEFAULT_DEPART_START,
  DEFAULT_MAX_STOPS,
  DEFAULT_RETURN_END,
  DEFAULT_RETURN_START,
  DEFAULT_TRIP_MIN_DAYS,
} from "./constants";
import type { User, UserRoute } from "./types";

export function userRoute(user: User): UserRoute {
  const origin = user.origin ?? DEFAULT_ORIGIN;
  const destination = user.destination ?? DEFAULT_DESTINATION;
  return {
    origin,
    destination,
    hubs: resolveHubsForRoute(origin, destination),
  };
}

export async function getUserByEmail(
  db: D1Database,
  email: string,
): Promise<User | null> {
  const normalized = email.trim().toLowerCase();
  const user = await db
    .prepare("SELECT * FROM users WHERE email = ?")
    .bind(normalized)
    .first<User>();
  return user ? normalizeUser(user) : null;
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
      `INSERT INTO users (id, email, origin, destination, hubs, alert_min, alert_max, max_stops,
        depart_start, depart_end, return_start, return_end, trip_min_days,
        check_interval_days, auto_check, active, created_at)
       VALUES (?, ?, ?, ?, ?, 2000, 2400, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?)`,
    )
    .bind(
      id,
      normalized,
      DEFAULT_ORIGIN,
      DEFAULT_DESTINATION,
      "YYZ,YUL",
      DEFAULT_MAX_STOPS,
      DEFAULT_DEPART_START,
      DEFAULT_DEPART_END,
      DEFAULT_RETURN_START,
      DEFAULT_RETURN_END,
      DEFAULT_TRIP_MIN_DAYS,
      DEFAULT_CHECK_INTERVAL_DAYS,
      createdAt,
    )
    .run();

  return {
    id,
    email: normalized,
    origin: DEFAULT_ORIGIN,
    destination: DEFAULT_DESTINATION,
    hubs: "YYZ,YUL",
    alert_min: 2000,
    alert_max: 2400,
    max_stops: DEFAULT_MAX_STOPS,
    depart_start: DEFAULT_DEPART_START,
    depart_end: DEFAULT_DEPART_END,
    return_start: DEFAULT_RETURN_START,
    return_end: DEFAULT_RETURN_END,
    trip_min_days: DEFAULT_TRIP_MIN_DAYS,
    check_interval_days: DEFAULT_CHECK_INTERVAL_DAYS,
    auto_check: 1,
    active: 1,
    created_at: createdAt,
  };
}

function normalizeUser(user: User): User {
  return {
    ...user,
    origin: user.origin ?? DEFAULT_ORIGIN,
    destination: user.destination ?? DEFAULT_DESTINATION,
    max_stops: user.max_stops ?? DEFAULT_MAX_STOPS,
    depart_start: user.depart_start ?? DEFAULT_DEPART_START,
    depart_end: user.depart_end ?? DEFAULT_DEPART_END,
    return_start: user.return_start ?? DEFAULT_RETURN_START,
    return_end: user.return_end ?? DEFAULT_RETURN_END,
    trip_min_days: user.trip_min_days ?? DEFAULT_TRIP_MIN_DAYS,
    check_interval_days: user.check_interval_days ?? DEFAULT_CHECK_INTERVAL_DAYS,
    auto_check: user.auto_check ?? 1,
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

export async function setUserAutoCheck(
  db: D1Database,
  userId: string,
  autoCheck: boolean,
): Promise<void> {
  await db
    .prepare("UPDATE users SET auto_check = ? WHERE id = ? AND active = 1")
    .bind(autoCheck ? 1 : 0, userId)
    .run();
}

export async function getScheduledUsers(db: D1Database): Promise<User[]> {
  const result = await db
    .prepare(
      "SELECT * FROM users WHERE active = 1 AND auto_check = 1 ORDER BY created_at ASC",
    )
    .all<User>();
  return (result.results ?? []).map(normalizeUser);
}

export async function updateUserSettings(
  db: D1Database,
  userId: string,
  settings: {
    origin: string;
    destination: string;
    alertMin: number;
    alertMax: number;
    maxStops: number;
    departStart: string;
    departEnd: string;
    returnStart: string;
    returnEnd: string;
    tripMinDays: number;
    checkIntervalDays: number;
    autoCheck: boolean;
  },
): Promise<void> {
  await db
    .prepare(
      `UPDATE users SET origin = ?, destination = ?, alert_min = ?, alert_max = ?, max_stops = ?,
        depart_start = ?, depart_end = ?, return_start = ?, return_end = ?, trip_min_days = ?,
        check_interval_days = ?, auto_check = ? WHERE id = ?`,
    )
    .bind(
      settings.origin,
      settings.destination,
      settings.alertMin,
      settings.alertMax,
      settings.maxStops,
      settings.departStart,
      settings.departEnd,
      settings.returnStart,
      settings.returnEnd,
      settings.tripMinDays,
      settings.checkIntervalDays,
      settings.autoCheck ? 1 : 0,
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

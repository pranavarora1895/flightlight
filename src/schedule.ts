import { CRON_HOUR_UTC, CRON_MINUTE_UTC } from "./constants";
import { getActiveUsers, userRoute } from "./db";
import type { Env, User } from "./types";

function userLastRunKey(userId: string): string {
  return `tracker:lastRunAt:${userId}`;
}

async function getUserLastCheckAt(
  kv: KVNamespace,
  userId: string,
): Promise<string | null> {
  const perUser = await kv.get(userLastRunKey(userId));
  if (perUser) return perUser;
  return kv.get("tracker:lastRunAt");
}

export const CRON_EXPRESSION = "0 14 * * *";
export const LAST_CRON_AT_KEY = "tracker:lastCronAt";
export const LAST_CRON_SUMMARY_KEY = "tracker:lastCronSummary";
export interface CronRunSummary {
  skipped: boolean;
  skipReason?: string;
  usersChecked: number;
  searchCount: number;
  at: string;
}

export interface UserScheduleRow {
  userId: string;
  email: string;
  origin: string;
  destination: string;
  autoCheck: boolean;
  checkIntervalDays: number;
  lastRunAt: string | null;
  nextCheckAt: string | null;
  dueAtNextCron: boolean;
}

export interface GlobalScheduleStatus {
  cronExpression: string;
  cronLabel: string;
  nextCronAt: string;
  lastCronAt: string | null;
  lastCronSummary: CronRunSummary | null;
  activeUsers: number;
  scheduledUsers: number;
  dueAtNextCron: number;
  users: UserScheduleRow[];
}

export function nextCronUtc(from = new Date()): Date {
  const next = new Date(
    Date.UTC(
      from.getUTCFullYear(),
      from.getUTCMonth(),
      from.getUTCDate(),
      CRON_HOUR_UTC,
      CRON_MINUTE_UTC,
      0,
      0,
    ),
  );
  if (next <= from) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next;
}

export function firstCronOnOrAfter(target: Date): Date {
  const dayStart = new Date(
    Date.UTC(
      target.getUTCFullYear(),
      target.getUTCMonth(),
      target.getUTCDate(),
      CRON_HOUR_UTC,
      CRON_MINUTE_UTC,
      0,
      0,
    ),
  );
  if (dayStart >= target) return dayStart;
  const next = new Date(dayStart);
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

function userIntervalMs(user: User): number {
  return user.check_interval_days * 24 * 60 * 60 * 1000;
}

function buildUserScheduleRow(
  user: User,
  lastRunAt: string | null,
  nextCron: Date,
): UserScheduleRow {
  const route = userRoute(user);

  if (!user.auto_check) {
    return {
      userId: user.id,
      email: user.email,
      origin: route.origin,
      destination: route.destination,
      autoCheck: false,
      checkIntervalDays: user.check_interval_days,
      lastRunAt,
      nextCheckAt: null,
      dueAtNextCron: false,
    };
  }

  if (!lastRunAt) {
    return {
      userId: user.id,
      email: user.email,
      origin: route.origin,
      destination: route.destination,
      autoCheck: true,
      checkIntervalDays: user.check_interval_days,
      lastRunAt: null,
      nextCheckAt: nextCron.toISOString(),
      dueAtNextCron: true,
    };
  }

  const dueFromLast = new Date(
    new Date(lastRunAt).getTime() + userIntervalMs(user),
  );
  const dueAtNextCron = dueFromLast <= nextCron;
  const nextCheckAt =
    dueFromLast <= new Date()
      ? nextCronUtc()
      : firstCronOnOrAfter(dueFromLast);

  return {
    userId: user.id,
    email: user.email,
    origin: route.origin,
    destination: route.destination,
    autoCheck: true,
    checkIntervalDays: user.check_interval_days,
    lastRunAt,
    nextCheckAt: nextCheckAt.toISOString(),
    dueAtNextCron,
  };
}

export async function recordCronInvocation(
  kv: KVNamespace,
  summary: Omit<CronRunSummary, "at">,
): Promise<void> {
  const at = new Date().toISOString();
  await kv.put(LAST_CRON_AT_KEY, at);
  await kv.put(
    LAST_CRON_SUMMARY_KEY,
    JSON.stringify({ ...summary, at } satisfies CronRunSummary),
  );
}

export async function getGlobalScheduleStatus(
  env: Env,
): Promise<GlobalScheduleStatus> {
  const users = await getActiveUsers(env.DB);
  const nextCron = nextCronUtc();

  const lastCronAt = await env.PRICE_HISTORY.get(LAST_CRON_AT_KEY);
  const summaryRaw = await env.PRICE_HISTORY.get(LAST_CRON_SUMMARY_KEY);
  let lastCronSummary: CronRunSummary | null = null;
  if (summaryRaw) {
    try {
      lastCronSummary = JSON.parse(summaryRaw) as CronRunSummary;
    } catch {
      lastCronSummary = null;
    }
  }

  const rows: UserScheduleRow[] = [];
  for (const user of users) {
    const lastRunAt = await getUserLastCheckAt(env.PRICE_HISTORY, user.id);
    rows.push(buildUserScheduleRow(user, lastRunAt, nextCron));
  }

  rows.sort((a, b) => {
    if (a.dueAtNextCron !== b.dueAtNextCron) {
      return a.dueAtNextCron ? -1 : 1;
    }
    if (!a.nextCheckAt && !b.nextCheckAt) return a.email.localeCompare(b.email);
    if (!a.nextCheckAt) return 1;
    if (!b.nextCheckAt) return -1;
    return a.nextCheckAt.localeCompare(b.nextCheckAt);
  });

  const scheduledUsers = rows.filter((row) => row.autoCheck).length;
  const dueAtNextCron = rows.filter(
    (row) => row.autoCheck && row.dueAtNextCron,
  ).length;
  return {
    cronExpression: CRON_EXPRESSION,
    cronLabel: `Daily at ${String(CRON_HOUR_UTC).padStart(2, "0")}:${String(CRON_MINUTE_UTC).padStart(2, "0")} UTC`,
    nextCronAt: nextCron.toISOString(),
    lastCronAt,
    lastCronSummary,
    activeUsers: users.length,
    scheduledUsers,
    dueAtNextCron,
    users: rows,
  };
}

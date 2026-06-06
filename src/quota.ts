import { getSerpapiMonthlyLimit, parseSearchTier } from "./constants";
import type { Env, SearchTier } from "./types";

export interface QuotaStatus {
  used: number;
  limit: number;
  exhausted: boolean;
  month: string;
  tier: SearchTier;
}

export function serpapiMonthKey(date = new Date()): string {
  return date.toISOString().slice(0, 7);
}

function usageKey(month = serpapiMonthKey()): string {
  return `serpapi:usage:${month}`;
}

export async function getSerpapiUsage(
  kv: KVNamespace,
  month = serpapiMonthKey(),
): Promise<number> {
  const raw = await kv.get(usageKey(month));
  if (!raw) return 0;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function incrementSerpapiUsage(
  kv: KVNamespace,
  count = 1,
): Promise<number> {
  const month = serpapiMonthKey();
  const key = usageKey(month);
  const current = await getSerpapiUsage(kv, month);
  const next = current + count;
  await kv.put(key, String(next), {
    expirationTtl: 60 * 60 * 24 * 40,
  });
  return next;
}

export async function getQuotaStatus(env: Env): Promise<QuotaStatus> {
  const tier = parseSearchTier(env.SEARCH_TIER);
  const month = serpapiMonthKey();
  const limit = getSerpapiMonthlyLimit(tier);
  const used = await getSerpapiUsage(env.PRICE_HISTORY, month);
  return {
    used,
    limit,
    exhausted: used >= limit,
    month,
    tier,
  };
}

export class SerpapiQuotaExhaustedError extends Error {
  readonly used: number;
  readonly limit: number;

  constructor(used: number, limit: number) {
    super(
      `Serpapi search limit reached for this month (${used}/${limit}). Automatic and manual checks are paused until next month.`,
    );
    this.name = "SerpapiQuotaExhaustedError";
    this.used = used;
    this.limit = limit;
  }
}

export async function assertQuotaAvailable(env: Env): Promise<QuotaStatus> {
  const quota = await getQuotaStatus(env);
  if (quota.exhausted) {
    throw new SerpapiQuotaExhaustedError(quota.used, quota.limit);
  }
  return quota;
}

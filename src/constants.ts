import type { Hub, SearchProfile, SearchTier } from "./types";

/** Default trip windows for new users (your original YYT→DEL dates). */
export const DEFAULT_DEPART_START = "2026-11-18";
export const DEFAULT_DEPART_END = "2026-12-02";
export const DEFAULT_RETURN_START = "2026-12-30";
export const DEFAULT_RETURN_END = "2027-01-13";
export const DEFAULT_TRIP_MIN_DAYS = 28;

export const RETURN_DATE_SAMPLES = 3;
export const MIN_TRIP_MIN_DAYS = 1;
export const MAX_TRIP_MIN_DAYS = 90;

export const FREE_DEPARTURE_DATE_COUNT = 4;
export const PAID_DEPARTURE_DATE_COUNT = 5;

/** Known domestic leg estimates (CAD) when API returns nothing */
export const DOMESTIC_FALLBACKS: Record<string, number> = {
  "YYT-YYZ": 380,
  "YYZ-YYT": 380,
  "YYT-YUL": 440,
  "YUL-YYT": 440,
};

export const KV_TTL_SECONDS = 2_592_000; // 30 days
export const ALERT_DEDUP_TTL_SECONDS = 86_400; // 24 hours
export const API_DELAY_MS = 600;
/** Cheapest N fares considered per Serpapi response when combining legs */
export const OPTIONS_PER_SEARCH = 5;

export const ALERT_MIN_BOUND = 500;
export const ALERT_MAX_BOUND = 10_000;
export const DEFAULT_MAX_STOPS = 2;
export const MAX_STOPS_MIN = 0;
export const MAX_STOPS_MAX = 6;

/** Worker cron: daily automatic check window (see wrangler.jsonc triggers.crons). */
export const CRON_HOUR_UTC = 14;
export const CRON_MINUTE_UTC = 0;

export const DEFAULT_CHECK_INTERVAL_DAYS = 3;
export const MIN_CHECK_INTERVAL_DAYS = 2;
export const MAX_CHECK_INTERVAL_DAYS = 30;

/** Serpapi monthly search limits by app tier (self-tracked in KV) */
export const SERPAPI_MONTHLY_LIMIT_FREE = 250;
export const SERPAPI_MONTHLY_LIMIT_PAID = 1000;

export function getSerpapiMonthlyLimit(tier: SearchTier): number {
  return tier === "paid"
    ? SERPAPI_MONTHLY_LIMIT_PAID
    : SERPAPI_MONTHLY_LIMIT_FREE;
}

export const SESSION_COOKIE = "yyt_session";
export const SESSION_DAYS = 30;
export const MAGIC_LINK_MINUTES = 15;

export function getDomesticFallback(from: string, to: string): number {
  return DOMESTIC_FALLBACKS[`${from}-${to}`] ?? 400;
}

export function parseSearchTier(raw: string): SearchTier {
  return raw === "paid" ? "paid" : "free";
}

export function getSearchProfile(tier: SearchTier): SearchProfile {
  if (tier === "paid") {
    return {
      tier: "paid",
      departureDateCount: PAID_DEPARTURE_DATE_COUNT,
      hubsPerRun: "all",
      runIntervalMs: 48 * 60 * 60 * 1000,
      alwaysLiveDomestic: true,
      domesticCacheMaxAgeMs: 0,
      estimatedSearchesPerRun: 35,
      label: "Paid · ~35 searches/run",
    };
  }

  return {
    tier: "free",
    departureDateCount: FREE_DEPARTURE_DATE_COUNT,
    hubsPerRun: "rotate",
      runIntervalMs: 48 * 60 * 60 * 1000,
    alwaysLiveDomestic: false,
    domesticCacheMaxAgeMs: 7 * 24 * 60 * 60 * 1000,
    estimatedSearchesPerRun: 16,
    label: "Free · ~16 searches/run",
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function formatCad(amount: number): string {
  return `$${amount.toLocaleString("en-CA")}`;
}

export function formatCadFull(amount: number): string {
  return `${formatCad(amount)} CAD`;
}

export function routeViaKey(routePath?: string[], hub?: string): string {
  if (routePath && routePath.length > 2) {
    const via = routePath.slice(1, -1).join("-");
    if (via) return via;
  }
  return hub ?? "direct";
}

export function dealKey(record: {
  userId: string;
  origin: string;
  hub: string;
  destination: string;
  depDate: string;
  retDate: string;
  routePath?: string[];
}): string {
  const via = routeViaKey(record.routePath, record.hub);
  return `${record.userId}:${record.origin}:${via}:${record.destination}:${record.depDate}:${record.retDate}`;
}

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export function isPriceRecordKey(key: string): boolean {
  // runDate:userId:origin:hub:dest:depDate:retDate
  return /^\d{4}-\d{2}-\d{2}:[^:]+:[A-Z]{3}:[A-Z]{3}:[A-Z]{3}:\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}$/.test(
    key,
  );
}

/** @deprecated legacy keys without userId */
export function isLegacyPriceRecordKey(key: string): boolean {
  return /^\d{4}-\d{2}-\d{2}:[A-Z]{3}:\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}$/.test(
    key,
  );
}

export type { Hub };

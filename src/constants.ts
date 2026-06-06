import type { Hub, SearchProfile, SearchTier } from "./types";

export const RETURN_DATES = ["2026-12-30", "2027-01-06", "2027-01-13"];

export const PAID_DEPARTURE_DATES = [
  "2026-11-18",
  "2026-11-21",
  "2026-11-25",
  "2026-11-28",
  "2026-12-02",
];

export const FREE_DEPARTURE_DATES = [
  "2026-11-18",
  "2026-11-21",
  "2026-11-25",
  "2026-11-28",
];

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

export const ALERT_MIN_BOUND = 500;
export const ALERT_MAX_BOUND = 10_000;

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
      departureDates: PAID_DEPARTURE_DATES,
      hubsPerRun: "all",
      runIntervalMs: 48 * 60 * 60 * 1000,
      alwaysLiveDomestic: true,
      domesticCacheMaxAgeMs: 0,
      estimatedSearchesPerRun: 20,
      label: "Paid · ~20 searches/run",
    };
  }

  return {
    tier: "free",
    departureDates: FREE_DEPARTURE_DATES,
    hubsPerRun: "rotate",
    runIntervalMs: 72 * 60 * 60 * 1000,
    alwaysLiveDomestic: false,
    domesticCacheMaxAgeMs: 7 * 24 * 60 * 60 * 1000,
    estimatedSearchesPerRun: 9,
    label: "Free · ~9 searches/run",
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

export function dealKey(record: {
  userId: string;
  origin: string;
  hub: string;
  destination: string;
  depDate: string;
  retDate: string;
}): string {
  return `${record.userId}:${record.origin}:${record.hub}:${record.destination}:${record.depDate}:${record.retDate}`;
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

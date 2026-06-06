export interface AirportInfo {
  code: string;
  city: string;
  country: string;
}

export const POPULAR_AIRPORTS: AirportInfo[] = [
  { code: "YYT", city: "St. John's", country: "Canada" },
  { code: "YYZ", city: "Toronto", country: "Canada" },
  { code: "YUL", city: "Montreal", country: "Canada" },
  { code: "YVR", city: "Vancouver", country: "Canada" },
  { code: "YHZ", city: "Halifax", country: "Canada" },
  { code: "DEL", city: "Delhi", country: "India" },
  { code: "BOM", city: "Mumbai", country: "India" },
  { code: "LHR", city: "London", country: "UK" },
  { code: "DXB", city: "Dubai", country: "UAE" },
  { code: "JFK", city: "New York", country: "USA" },
  { code: "LAX", city: "Los Angeles", country: "USA" },
];

const AIRPORT_MAP = new Map(POPULAR_AIRPORTS.map((a) => [a.code, a]));

export function airportLabel(code: string): string {
  const info = AIRPORT_MAP.get(code);
  if (!info) return code;
  return `${info.city} (${code})`;
}

export function airportCity(code: string): string {
  return AIRPORT_MAP.get(code)?.city ?? code;
}

export function normalizeIata(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isValidIata(code: string): boolean {
  return /^[A-Z]{3}$/.test(code);
}

export function parseHubList(raw: string): string[] {
  const hubs = raw
    .split(/[,;\s]+/)
    .map(normalizeIata)
    .filter((h) => isValidIata(h));

  return [...new Set(hubs)];
}

export function formatHubList(hubs: string[]): string {
  return hubs.join(",");
}

export const DEFAULT_ORIGIN = "YYT";
export const DEFAULT_DESTINATION = "DEL";

/** Major airports where international flights typically depart (no domestic connection needed). */
const MAJOR_INTL_HUBS = new Set(["YYZ", "YUL", "YVR", "YYC", "YOW", "YWG"]);

/** Default connection airports when origin is a smaller Canadian city. */
const DEFAULT_CONNECTION_HUBS = ["YYZ", "YUL"];

/**
 * Pick connection hub(s) automatically from origin → destination.
 * Users only set from/to; the tracker tries sensible hub options behind the scenes.
 */
export function resolveHubsForRoute(origin: string, destination: string): string[] {
  const from = normalizeIata(origin);
  const to = normalizeIata(destination);
  if (from === to) return [];

  if (MAJOR_INTL_HUBS.has(from)) {
    return [from];
  }

  return [...DEFAULT_CONNECTION_HUBS];
}

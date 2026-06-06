import { API_DELAY_MS, OPTIONS_PER_SEARCH, sleep } from "./constants";
import {
  assertQuotaAvailable,
  incrementSerpapiUsage,
  SerpapiQuotaExhaustedError,
} from "./quota";
import type {
  Env,
  FlightSearchResult,
  SerpapiFlightOption,
  SerpapiResponse,
} from "./types";

const SERPAPI_BASE = "https://serpapi.com/search";

export class SerpapiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SerpapiError";
  }
}

export { SerpapiQuotaExhaustedError };

interface SearchContext {
  departureId: string;
  arrivalId: string;
  outboundDate: string;
  returnDate?: string;
  roundTrip: boolean;
}

function buildFallbackFlightsUrl(ctx: SearchContext): string {
  const q = ctx.roundTrip
    ? `Flights from ${ctx.departureId} to ${ctx.arrivalId} on ${ctx.outboundDate} returning ${ctx.returnDate}`
    : `Flights from ${ctx.departureId} to ${ctx.arrivalId} on ${ctx.outboundDate}`;
  return `https://www.google.com/travel/flights/search?q=${encodeURIComponent(q)}&curr=CAD`;
}

function extractBookingUrl(
  data: SerpapiResponse,
  ctx: SearchContext,
): string {
  const fromApi = data.search_metadata?.google_flights_url?.trim();
  if (fromApi && fromApi.length > 0) {
    return fromApi;
  }
  return buildFallbackFlightsUrl(ctx);
}

export function countOptionStops(option: SerpapiFlightOption): number {
  if (option.layovers && option.layovers.length > 0) {
    return option.layovers.length;
  }
  const segments = option.flights?.length ?? 1;
  return Math.max(0, segments - 1);
}

function maxStopsToSerpapiParam(maxStops: number): string {
  if (maxStops <= 0) return "1";
  if (maxStops === 1) return "2";
  if (maxStops === 2) return "3";
  // 3+ stops: API only filters to "2 or fewer" at best — fetch all and filter client-side
  return "0";
}

export function extractOutboundPath(
  option: SerpapiFlightOption,
  origin: string,
  destination: string,
): string[] {
  const flights = option.flights ?? [];
  if (flights.length === 0) return [origin, destination];

  const path: string[] = [];
  for (const leg of flights) {
    const dep = leg.departure_airport?.id?.toUpperCase();
    const arr = leg.arrival_airport?.id?.toUpperCase();
    if (dep) {
      if (path.length === 0 || path[path.length - 1] !== dep) path.push(dep);
    }
    if (arr) {
      path.push(arr);
      if (arr === destination.toUpperCase()) break;
    }
  }

  if (path.length < 2) return [origin.toUpperCase(), destination.toUpperCase()];
  return path;
}

function optionToResult(
  option: SerpapiFlightOption,
  ctx: SearchContext,
  bookingUrl: string,
): FlightSearchResult {
  return {
    price: option.price!,
    airline: pickAirlineFromOption(option),
    bookingUrl,
    stops: countOptionStops(option),
    routePath: extractOutboundPath(option, ctx.departureId, ctx.arrivalId),
    estimated: false,
  };
}

function parseOptions(
  data: SerpapiResponse,
  ctx: SearchContext,
  maxStops: number,
  limit = OPTIONS_PER_SEARCH,
): FlightSearchResult[] {
  const bookingUrl = extractBookingUrl(data, ctx);
  const results: FlightSearchResult[] = [];
  const options = [...(data.best_flights ?? []), ...(data.other_flights ?? [])]
    .filter((option) => option.price != null)
    .sort((a, b) => (a.price ?? 0) - (b.price ?? 0));

  for (const option of options) {
    const stops = countOptionStops(option);
    if (stops > maxStops) continue;
    results.push(optionToResult(option, ctx, bookingUrl));
    if (results.length >= limit) break;
  }

  if (results.length === 0 && data.price_insights?.lowest_price != null) {
    results.push({
      price: data.price_insights.lowest_price,
      airline: pickAirline(data),
      bookingUrl,
      stops: 0,
      routePath: [ctx.departureId.toUpperCase(), ctx.arrivalId.toUpperCase()],
      estimated: true,
    });
  }

  return results;
}

function pickAirline(data: SerpapiResponse): string {
  const first = data.best_flights?.[0] ?? data.other_flights?.[0];
  return first ? pickAirlineFromOption(first) : "Unknown";
}

function pickAirlineFromOption(option: {
  flights?: { airline?: string }[];
  airline?: string;
}): string {
  const legAirline = option.flights?.[0]?.airline;
  if (legAirline) return legAirline;
  if (option.airline) return option.airline;
  return "Unknown";
}

async function serpapiFetchOptions(
  env: Env,
  params: Record<string, string>,
  ctx: SearchContext,
  label: string,
  maxStops: number,
): Promise<FlightSearchResult[]> {
  const url = new URL(SERPAPI_BASE);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("engine", "google_flights");
  url.searchParams.set("api_key", env.SERPAPI_KEY);
  url.searchParams.set("currency", "CAD");
  url.searchParams.set("adults", "1");
  url.searchParams.set("stops", maxStopsToSerpapiParam(maxStops));
  url.searchParams.set("sort_by", "2");
  url.searchParams.set("hl", "en");

  await assertQuotaAvailable(env);

  const started = Date.now();
  console.log(
    `[serpapi] ${label} → ${url.pathname}?${url.searchParams.toString().replace(env.SERPAPI_KEY, "***")}`,
  );

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new SerpapiError(`HTTP ${response.status} for ${label}`);
  }

  const data = (await response.json()) as SerpapiResponse;
  const durationMs = Date.now() - started;

  if (data.search_metadata?.status === "Error") {
    throw new SerpapiError(data.error ?? `Serpapi error for ${label}`);
  }

  await incrementSerpapiUsage(env.PRICE_HISTORY);

  const parsed = parseOptions(data, ctx, maxStops);
  const best = parsed[0];
  console.log(
    `[serpapi] ${label} done in ${durationMs}ms options=${parsed.length} best=${best?.price ?? "none"} stops=${best?.stops ?? "n/a"} airline=${best?.airline ?? "n/a"}`,
  );

  await sleep(API_DELAY_MS);
  return parsed;
}

export async function searchRoundTripOptions(
  env: Env,
  departureId: string,
  arrivalId: string,
  outboundDate: string,
  returnDate: string,
  maxStops: number,
): Promise<FlightSearchResult[]> {
  const ctx: SearchContext = {
    departureId,
    arrivalId,
    outboundDate,
    returnDate,
    roundTrip: true,
  };
  return serpapiFetchOptions(
    env,
    {
      departure_id: departureId,
      arrival_id: arrivalId,
      outbound_date: outboundDate,
      return_date: returnDate,
      type: "1",
    },
    ctx,
    `RT ${departureId}→${arrivalId} ${outboundDate}/${returnDate}`,
    maxStops,
  );
}

export async function searchOneWayOptions(
  env: Env,
  departureId: string,
  arrivalId: string,
  outboundDate: string,
  maxStops: number,
): Promise<FlightSearchResult[]> {
  const ctx: SearchContext = {
    departureId,
    arrivalId,
    outboundDate,
    roundTrip: false,
  };
  return serpapiFetchOptions(
    env,
    {
      departure_id: departureId,
      arrival_id: arrivalId,
      outbound_date: outboundDate,
      type: "2",
    },
    ctx,
    `OW ${departureId}→${arrivalId} ${outboundDate}`,
    maxStops,
  );
}

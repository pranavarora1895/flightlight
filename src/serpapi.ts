import { API_DELAY_MS, sleep } from "./constants";
import type { Env, FlightSearchResult, SerpapiResponse } from "./types";

const SERPAPI_BASE = "https://serpapi.com/search";

export class SerpapiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SerpapiError";
  }
}

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

function parsePrice(
  data: SerpapiResponse,
  ctx: SearchContext,
): FlightSearchResult | null {
  const bookingUrl = extractBookingUrl(data, ctx);

  const options = [...(data.best_flights ?? []), ...(data.other_flights ?? [])];
  let cheapestFromOptions: FlightSearchResult | null = null;

  for (const option of options) {
    if (option.price == null) continue;
    if (!cheapestFromOptions || option.price < cheapestFromOptions.price) {
      cheapestFromOptions = {
        price: option.price,
        airline: pickAirlineFromOption(option),
        bookingUrl,
      };
    }
  }

  if (cheapestFromOptions) {
    return cheapestFromOptions;
  }

  if (data.price_insights?.lowest_price != null) {
    return {
      price: data.price_insights.lowest_price,
      airline: pickAirline(data),
      bookingUrl,
    };
  }

  return null;
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

async function serpapiFetch(
  env: Env,
  params: Record<string, string>,
  ctx: SearchContext,
  label: string,
): Promise<FlightSearchResult | null> {
  const url = new URL(SERPAPI_BASE);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("engine", "google_flights");
  url.searchParams.set("api_key", env.SERPAPI_KEY);
  url.searchParams.set("currency", "CAD");
  url.searchParams.set("adults", "1");
  url.searchParams.set("stops", "2");
  url.searchParams.set("hl", "en");

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

  const parsed = parsePrice(data, ctx);
  console.log(
    `[serpapi] ${label} done in ${durationMs}ms price=${parsed?.price ?? "none"} airline=${parsed?.airline ?? "n/a"} book=${parsed?.bookingUrl ? "yes" : "no"}`,
  );

  await sleep(API_DELAY_MS);
  return parsed;
}

export async function searchRoundTrip(
  env: Env,
  departureId: string,
  arrivalId: string,
  outboundDate: string,
  returnDate: string,
): Promise<FlightSearchResult | null> {
  const ctx: SearchContext = {
    departureId,
    arrivalId,
    outboundDate,
    returnDate,
    roundTrip: true,
  };
  return serpapiFetch(
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
  );
}

export async function searchOneWay(
  env: Env,
  departureId: string,
  arrivalId: string,
  outboundDate: string,
): Promise<FlightSearchResult | null> {
  const ctx: SearchContext = {
    departureId,
    arrivalId,
    outboundDate,
    roundTrip: false,
  };
  return serpapiFetch(
    env,
    {
      departure_id: departureId,
      arrival_id: arrivalId,
      outbound_date: outboundDate,
      type: "2",
    },
    ctx,
    `OW ${departureId}→${arrivalId} ${outboundDate}`,
  );
}

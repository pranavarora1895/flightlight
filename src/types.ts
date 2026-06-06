export type SearchTier = "free" | "paid";

export type Hub = string;

export interface Env {
  PRICE_HISTORY: KVNamespace;
  DB: D1Database;
  EMAIL: SendEmail;
  SERPAPI_KEY: string;
  RESEND_API_KEY: string;
  INVITE_CODE: string;
  SESSION_SECRET: string;
  FROM_EMAIL: string;
  APP_URL: string;
  SEARCH_TIER: string;
}

export interface User {
  id: string;
  email: string;
  origin: string;
  destination: string;
  hubs: string;
  alert_min: number;
  alert_max: number;
  active: number;
  created_at: string;
}

export interface UserRoute {
  origin: string;
  destination: string;
  hubs: string[];
}

export interface KVRecord {
  userId: string;
  origin: string;
  destination: string;
  checkedAt: string;
  hub: Hub;
  depDate: string;
  retDate: string;
  intlPrice: number;
  domesticPrice: number;
  domesticEstimated: boolean;
  totalPrice: number;
  airline: string;
  intlBookingUrl?: string;
  domesticOutboundBookingUrl?: string;
  domesticReturnBookingUrl?: string;
  kvKey?: string;
}

export interface Deal extends KVRecord {
  dealKey: string;
}

export interface DomesticCacheEntry {
  price: number;
  checkedAt: string;
  estimated: boolean;
}

export interface SearchProfile {
  tier: SearchTier;
  departureDates: string[];
  hubsPerRun: "all" | "rotate";
  runIntervalMs: number;
  alwaysLiveDomestic: boolean;
  domesticCacheMaxAgeMs: number;
  estimatedSearchesPerRun: number;
  label: string;
}

export interface SerpapiFlightLeg {
  airline?: string;
  flight_number?: string;
}

export interface SerpapiFlightOption {
  price?: number;
  flights?: SerpapiFlightLeg[];
  airline?: string;
  departure_token?: string;
  booking_token?: string;
}

export interface SerpapiResponse {
  search_metadata?: {
    status?: string;
    id?: string;
    google_flights_url?: string;
  };
  error?: string;
  price_insights?: {
    lowest_price?: number;
  };
  best_flights?: SerpapiFlightOption[];
  other_flights?: SerpapiFlightOption[];
}

export interface FlightSearchResult {
  price: number;
  airline: string;
  bookingUrl: string;
}

export interface RunOptions {
  skipIntervalGate?: boolean;
  manual?: boolean;
}

export interface RunResult {
  skipped: boolean;
  skipReason?: string;
  log: string[];
  deals: Deal[];
  searchCount: number;
  tier: SearchTier;
}

export interface DashboardContext {
  user: User;
  records: KVRecord[];
  lastRunAt: string | null;
  nextRunEstimate: string | null;
  tierLabel: string;
  message?: string;
  error?: string;
}

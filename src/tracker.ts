import {
  dealKey,
  getDomesticFallback,
  getSearchProfile,
  isLegacyPriceRecordKey,
  isPriceRecordKey,
  KV_TTL_SECONDS,
  parseSearchTier,
  RETURN_DATES,
  todayUtc,
} from "./constants";
import { getActiveUsers, userRoute } from "./db";
import { sendDealAlertEmail } from "./email";
import { SerpapiError, searchOneWay, searchRoundTrip } from "./serpapi";
import type {
  Deal,
  DomesticCacheEntry,
  Env,
  KVRecord,
  RunOptions,
  RunResult,
  SearchProfile,
  User,
} from "./types";

const ALERT_DEDUP_TTL = 86_400;
const RUN_LOCK_KEY = "tracker:runLock";
const RUN_LOCK_TTL_SECONDS = 900; // 15 min — longer than any single run

function buildDomesticBookUrl(from: string, to: string, date: string): string {
  const q = `Flights from ${from} to ${to} on ${date}`;
  return `https://www.google.com/travel/flights/search?q=${encodeURIComponent(q)}&curr=CAD`;
}

async function getTrackerState(
  kv: KVNamespace,
  key: string,
  fallback: number,
): Promise<number> {
  const raw = await kv.get(key);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function setTrackerState(
  kv: KVNamespace,
  key: string,
  value: number,
): Promise<void> {
  await kv.put(key, String(value));
}

async function getLastRunAt(kv: KVNamespace): Promise<string | null> {
  return kv.get("tracker:lastRunAt");
}

async function tryAcquireRunLock(kv: KVNamespace): Promise<boolean> {
  const existing = await kv.get(RUN_LOCK_KEY);
  if (existing) return false;
  await kv.put(RUN_LOCK_KEY, new Date().toISOString(), {
    expirationTtl: RUN_LOCK_TTL_SECONDS,
  });
  return true;
}

async function releaseRunLock(kv: KVNamespace): Promise<void> {
  await kv.delete(RUN_LOCK_KEY);
}

function formatNextRunFromLast(lastRunAt: string, intervalMs: number): string {
  return new Date(new Date(lastRunAt).getTime() + intervalMs).toISOString();
}

export async function getNextRunEstimate(env: Env): Promise<string | null> {
  const profile = getSearchProfile(parseSearchTier(env.SEARCH_TIER));
  const lastRunAt = await getLastRunAt(env.PRICE_HISTORY);
  if (!lastRunAt) return "Pending first run";

  const next = new Date(new Date(lastRunAt).getTime() + profile.runIntervalMs);
  return next.toISOString();
}

async function shouldSkipRun(
  env: Env,
  profile: SearchProfile,
): Promise<string | null> {
  const lastRunAt = await getLastRunAt(env.PRICE_HISTORY);
  if (!lastRunAt) return null;

  const elapsed = Date.now() - new Date(lastRunAt).getTime();
  if (elapsed < profile.runIntervalMs) {
    const hoursLeft = Math.ceil(
      (profile.runIntervalMs - elapsed) / (60 * 60 * 1000),
    );
    return `Last run ${lastRunAt}; next run in ~${hoursLeft}h`;
  }

  return null;
}

function resolveHubsForUser(
  profile: SearchProfile,
  user: User,
  hubIndex: number,
): { hubs: string[]; nextHubIndex: number } {
  const route = userRoute(user);
  if (route.hubs.length === 0) {
    return { hubs: [], nextHubIndex: hubIndex };
  }

  if (profile.hubsPerRun === "all") {
    return { hubs: route.hubs, nextHubIndex: hubIndex };
  }

  const hub = route.hubs[hubIndex % route.hubs.length];
  return {
    hubs: [hub],
    nextHubIndex: (hubIndex + 1) % route.hubs.length,
  };
}

async function getDomesticLegPrice(
  env: Env,
  profile: SearchProfile,
  from: string,
  to: string,
  date: string,
  log: string[],
): Promise<{ price: number; estimated: boolean; apiCalled: boolean; bookingUrl: string }> {
  const fallbackBookUrl = buildDomesticBookUrl(from, to, date);
  const cacheKey = `domestic:${from}:${to}`;

  if (!profile.alwaysLiveDomestic) {
    const cachedRaw = await env.PRICE_HISTORY.get(cacheKey);
    if (cachedRaw) {
      const cached = JSON.parse(cachedRaw) as DomesticCacheEntry;
      const age = Date.now() - new Date(cached.checkedAt).getTime();
      if (age < profile.domesticCacheMaxAgeMs) {
        log.push(`  domestic ${from}→${to}: cache hit ${cached.price} CAD`);
        return { price: cached.price, estimated: cached.estimated, apiCalled: false, bookingUrl: fallbackBookUrl };
      }
    }
  }

  try {
    const result = await searchOneWay(env, from, to, date);
    if (result) {
      const entry: DomesticCacheEntry = {
        price: result.price,
        checkedAt: new Date().toISOString(),
        estimated: false,
      };
      await env.PRICE_HISTORY.put(cacheKey, JSON.stringify(entry), {
        expirationTtl: KV_TTL_SECONDS,
      });
      log.push(`  domestic ${from}→${to}: live ${result.price} CAD`);
      return {
        price: result.price,
        estimated: false,
        apiCalled: true,
        bookingUrl: result.bookingUrl,
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.push(`  domestic ${from}→${to}: API error (${message}), using fallback`);
  }

  const fallback = getDomesticFallback(from, to);
  log.push(`  domestic ${from}→${to}: fallback ${fallback} CAD`);
  return { price: fallback, estimated: true, apiCalled: false, bookingUrl: fallbackBookUrl };
}

async function savePriceRecord(
  kv: KVNamespace,
  runDate: string,
  record: KVRecord,
): Promise<Deal> {
  const key = `${runDate}:${record.userId}:${record.origin}:${record.hub}:${record.destination}:${record.depDate}:${record.retDate}`;
  await kv.put(key, JSON.stringify(record), { expirationTtl: KV_TTL_SECONDS });
  return { ...record, dealKey: dealKey(record), kvKey: key };
}

async function runForUser(
  env: Env,
  user: User,
  profile: SearchProfile,
  retDate: string,
  runDate: string,
  hubIndex: number,
  log: string[],
): Promise<{ deals: Deal[]; searchCount: number; nextHubIndex: number }> {
  const route = userRoute(user);
  const { hubs, nextHubIndex } = resolveHubsForUser(profile, user, hubIndex);

  if (hubs.length === 0) {
    log.push(`User ${user.email}: no connection hubs configured, skipping.`);
    return { deals: [], searchCount: 0, nextHubIndex };
  }

  const deals: Deal[] = [];
  let searchCount = 0;

  log.push(
    `User ${user.email}: ${route.origin}→[${hubs.join("|")}]→${route.destination} ret=${retDate}`,
  );

  for (const hub of hubs) {
    for (const depDate of profile.departureDates) {
      log.push(`  Checking via ${hub} dep=${depDate}`);

      try {
        const intl = await searchRoundTrip(
          env,
          hub,
          route.destination,
          depDate,
          retDate,
        );
        searchCount += 1;
        if (!intl) {
          log.push("    no international results");
          continue;
        }

        let domesticPrice = 0;
        let domesticEstimated = false;
        let domesticOutboundBookingUrl: string | undefined;
        let domesticReturnBookingUrl: string | undefined;

        if (route.origin !== hub) {
          const outbound = await getDomesticLegPrice(
            env,
            profile,
            route.origin,
            hub,
            depDate,
            log,
          );
          if (outbound.apiCalled) searchCount += 1;
          domesticOutboundBookingUrl = outbound.bookingUrl;

          const inbound = await getDomesticLegPrice(
            env,
            profile,
            hub,
            route.origin,
            retDate,
            log,
          );
          if (inbound.apiCalled) searchCount += 1;
          domesticReturnBookingUrl = inbound.bookingUrl;

          domesticPrice = outbound.price + inbound.price;
          domesticEstimated = outbound.estimated || inbound.estimated;
        }

        const totalPrice = intl.price + domesticPrice;

        const record: KVRecord = {
          userId: user.id,
          origin: route.origin,
          destination: route.destination,
          checkedAt: new Date().toISOString(),
          hub,
          depDate,
          retDate,
          intlPrice: intl.price,
          domesticPrice,
          domesticEstimated,
          totalPrice,
          airline: intl.airline,
          intlBookingUrl: intl.bookingUrl,
          domesticOutboundBookingUrl,
          domesticReturnBookingUrl,
        };

        const deal = await savePriceRecord(env.PRICE_HISTORY, runDate, record);
        deals.push(deal);
        log.push(
          `    total=${totalPrice} CAD (intl=${intl.price} + connection=${domesticPrice}${domesticEstimated ? " est" : ""})`,
        );
      } catch (error) {
        const message =
          error instanceof SerpapiError
            ? error.message
            : error instanceof Error
              ? error.message
              : String(error);
        log.push(`    error: ${message}`);
        console.error(
          `[tracker] user=${user.email} hub=${hub} dep=${depDate}`,
          error,
        );
      }
    }
  }

  return { deals, searchCount, nextHubIndex };
}

async function dispatchAlertsForUser(
  env: Env,
  user: User,
  deals: Deal[],
  log: string[],
): Promise<void> {
  const matching = deals.filter(
    (d) =>
      d.userId === user.id &&
      d.totalPrice >= user.alert_min &&
      d.totalPrice <= user.alert_max,
  );

  if (matching.length === 0) {
    log.push(`No deals in range for ${user.email}.`);
    return;
  }

  const toSend: Deal[] = [];
  for (const deal of matching) {
    const dedupKey = `alerts:${user.id}:${deal.dealKey}`;
    const seen = await env.PRICE_HISTORY.get(dedupKey);
    if (seen) continue;
    toSend.push(deal);
    await env.PRICE_HISTORY.put(dedupKey, new Date().toISOString(), {
      expirationTtl: ALERT_DEDUP_TTL,
    });
  }

  if (toSend.length === 0) {
    log.push(`Alerts already sent recently for ${user.email}.`);
    return;
  }

  await sendDealAlertEmail(env, user.email, toSend);
  log.push(`Sent ${toSend.length} alert(s) to ${user.email}.`);
}

export async function listPriceRecords(
  kv: KVNamespace,
  userId: string,
): Promise<KVRecord[]> {
  const records: KVRecord[] = [];
  let cursor: string | undefined;

  do {
    const page = await kv.list({ cursor });
    for (const key of page.keys) {
      if (!isPriceRecordKey(key.name) && !isLegacyPriceRecordKey(key.name)) {
        continue;
      }
      const raw = await kv.get(key.name);
      if (!raw) continue;
      const record = JSON.parse(raw) as KVRecord;
      if (record.userId && record.userId !== userId) continue;
      if (!record.userId && isLegacyPriceRecordKey(key.name)) {
        record.userId = userId;
        record.origin = record.origin ?? "YYT";
        record.destination = record.destination ?? "DEL";
      }
      records.push({ ...record, kvKey: key.name });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  return records.sort((a, b) => a.totalPrice - b.totalPrice);
}

export async function runTracker(
  env: Env,
  options: RunOptions = {},
): Promise<RunResult> {
  const log: string[] = [];
  const tier = parseSearchTier(env.SEARCH_TIER);
  const profile = getSearchProfile(tier);
  let searchCount = 0;

  log.push(`Starting tracker tier=${tier} (${profile.label})`);

  if (!options.skipIntervalGate) {
    const skipReason = await shouldSkipRun(env, profile);
    if (skipReason) {
      log.push(`Skipped: ${skipReason}`);
      return { skipped: true, skipReason, log, deals: [], searchCount: 0, tier };
    }
  } else if (options.manual) {
    log.push("Manual run — automatic schedule resets after this completes.");
  } else if (tier === "free") {
    log.push("Manual run on free tier — watch Serpapi quota.");
  }

  const lockAcquired = await tryAcquireRunLock(env.PRICE_HISTORY);
  if (!lockAcquired) {
    const skipReason = options.manual
      ? "A price check is already running. Try again in a few minutes."
      : "Skipped: another run is already in progress";
    log.push(skipReason);
    return { skipped: true, skipReason, log, deals: [], searchCount: 0, tier };
  }

  try {
    const users = await getActiveUsers(env.DB);
    if (users.length === 0) {
      log.push("No active users.");
      return { skipped: false, log, deals: [], searchCount: 0, tier };
    }

    const returnIndex = await getTrackerState(
      env.PRICE_HISTORY,
      "tracker:returnDateIndex",
      0,
    );
    const retDate = RETURN_DATES[returnIndex % RETURN_DATES.length];
    const runDate = todayUtc();
    const allDeals: Deal[] = [];

    log.push(`Return date: ${retDate}`);

    for (const user of users) {
      const hubIndex = await getTrackerState(
        env.PRICE_HISTORY,
        `tracker:hubIndex:${user.id}`,
        0,
      );

      const result = await runForUser(
        env,
        user,
        profile,
        retDate,
        runDate,
        hubIndex,
        log,
      );
      searchCount += result.searchCount;
      allDeals.push(...result.deals);

      if (profile.hubsPerRun === "rotate") {
        await setTrackerState(
          env.PRICE_HISTORY,
          `tracker:hubIndex:${user.id}`,
          result.nextHubIndex,
        );
      }

      try {
        await dispatchAlertsForUser(env, user, result.deals, log);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.push(`Alert error for ${user.email}: ${message}`);
        console.error("[tracker] alert failed", error);
      }
    }

    const lastRunAt = new Date().toISOString();
    await env.PRICE_HISTORY.put("tracker:lastRunAt", lastRunAt);
    await setTrackerState(
      env.PRICE_HISTORY,
      "tracker:returnDateIndex",
      (returnIndex + 1) % RETURN_DATES.length,
    );

    const nextRunAt = formatNextRunFromLast(lastRunAt, profile.runIntervalMs);
    log.push(`Completed ${searchCount} Serpapi searches, ${allDeals.length} deals saved.`);
    log.push(`Next automatic check: ${nextRunAt}`);

    return { skipped: false, log, deals: allDeals, searchCount, tier };
  } finally {
    await releaseRunLock(env.PRICE_HISTORY);
  }
}

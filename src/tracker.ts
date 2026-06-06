import {
  dealKey,
  getDomesticFallback,
  routeViaKey,
  getSearchProfile,
  isLegacyPriceRecordKey,
  isPriceRecordKey,
  KV_TTL_SECONDS,
  parseSearchTier,
  todayUtc,
} from "./constants";
import { getActiveUsers, getScheduledUsers, userRoute } from "./db";
import { sendDealAlertEmail } from "./email";
import {
  buildUserTripSchedule,
  departureDatesForReturn,
  userTripDates,
} from "./dates";
import { findBestItinerary } from "./optimizer";
import { getQuotaStatus, SerpapiQuotaExhaustedError } from "./quota";
import {
  SerpapiError,
  searchOneWayOptions,
  searchRoundTripOptions,
} from "./serpapi";
import type {
  Deal,
  DomesticCacheEntry,
  Env,
  KVRecord,
  RunOptions,
  FlightSearchResult,
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

function userLastRunKey(userId: string): string {
  return `tracker:lastRunAt:${userId}`;
}

export async function getUserLastCheckAt(
  kv: KVNamespace,
  userId: string,
): Promise<string | null> {
  const perUser = await kv.get(userLastRunKey(userId));
  if (perUser) return perUser;
  return kv.get("tracker:lastRunAt");
}

async function setUserLastCheckAt(
  kv: KVNamespace,
  userId: string,
  iso: string,
): Promise<void> {
  await kv.put(userLastRunKey(userId), iso);
}

function userIntervalMs(user: User): number {
  return user.check_interval_days * 24 * 60 * 60 * 1000;
}

async function filterUsersDueForCheck(
  kv: KVNamespace,
  users: User[],
  log: string[],
): Promise<User[]> {
  const due: User[] = [];

  for (const user of users) {
    const lastRunAt = await getUserLastCheckAt(kv, user.id);
    if (!lastRunAt) {
      due.push(user);
      continue;
    }

    const elapsed = Date.now() - new Date(lastRunAt).getTime();
    if (elapsed >= userIntervalMs(user)) {
      due.push(user);
      continue;
    }

    const hoursLeft = Math.ceil((userIntervalMs(user) - elapsed) / (60 * 60 * 1000));
    log.push(
      `Skipping ${user.email}: next automatic check in ~${hoursLeft}h (every ${user.check_interval_days} days)`,
    );
  }

  return due;
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

export async function getNextRunEstimate(
  env: Env,
  user: User,
): Promise<string | null> {
  if (!user.auto_check) return null;

  const lastRunAt = await getUserLastCheckAt(env.PRICE_HISTORY, user.id);
  if (!lastRunAt) return "Pending first run";

  return formatNextRunFromLast(lastRunAt, userIntervalMs(user));
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

async function getDomesticLegOptions(
  env: Env,
  profile: SearchProfile,
  from: string,
  to: string,
  date: string,
  maxStops: number,
  log: string[],
): Promise<{ options: FlightSearchResult[]; apiCalled: boolean }> {
  const fallbackBookUrl = buildDomesticBookUrl(from, to, date);
  const cacheKey = `domestic:${from}:${to}:${date}`;

  if (!profile.alwaysLiveDomestic) {
    const cachedRaw = await env.PRICE_HISTORY.get(cacheKey);
    if (cachedRaw) {
      const cached = JSON.parse(cachedRaw) as DomesticCacheEntry;
      const age = Date.now() - new Date(cached.checkedAt).getTime();
      if (age < profile.domesticCacheMaxAgeMs) {
        log.push(`  domestic ${from}→${to} ${date}: cache hit ${cached.price} CAD`);
        return {
          options: [
            {
              price: cached.price,
              airline: "Estimated",
              bookingUrl: fallbackBookUrl,
              stops: 0,
              routePath: [from.toUpperCase(), to.toUpperCase()],
              estimated: true,
            },
          ],
          apiCalled: false,
        };
      }
    }
  }

  try {
    const results = await searchOneWayOptions(env, from, to, date, maxStops);
    if (results.length > 0) {
      const best = results[0];
      const entry: DomesticCacheEntry = {
        price: best.price,
        checkedAt: new Date().toISOString(),
        estimated: false,
      };
      await env.PRICE_HISTORY.put(cacheKey, JSON.stringify(entry), {
        expirationTtl: KV_TTL_SECONDS,
      });
      log.push(
        `  domestic ${from}→${to} ${date}: live ${results.length} option(s), best ${best.price} CAD (${best.stops} stop${best.stops === 1 ? "" : "s"})`,
      );
      return { options: results, apiCalled: true };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.push(`  domestic ${from}→${to} ${date}: API error (${message}), using fallback`);
  }

  const fallback = getDomesticFallback(from, to);
  log.push(`  domestic ${from}→${to} ${date}: fallback ${fallback} CAD`);
  return {
    options: [
      {
        price: fallback,
        airline: "Estimated",
        bookingUrl: fallbackBookUrl,
        stops: 0,
        routePath: [from.toUpperCase(), to.toUpperCase()],
        estimated: true,
      },
    ],
    apiCalled: false,
  };
}

function mergeRoutePaths(segments: string[][]): string[] {
  const merged: string[] = [];
  for (const segment of segments) {
    for (const code of segment) {
      const upper = code.toUpperCase();
      if (merged.length === 0 || merged[merged.length - 1] !== upper) {
        merged.push(upper);
      }
    }
  }
  return merged;
}

function displayHub(routePath: string[], origin: string): string {
  if (routePath.length > 2) return routePath[1];
  return origin.toUpperCase();
}

function recordFromDirect(
  user: User,
  route: { origin: string; destination: string },
  depDate: string,
  retDate: string,
  best: FlightSearchResult,
): KVRecord {
  const routePath = best.routePath;
  return {
    userId: user.id,
    origin: route.origin,
    destination: route.destination,
    checkedAt: new Date().toISOString(),
    hub: displayHub(routePath, route.origin),
    routePath,
    depDate,
    retDate,
    intlPrice: best.price,
    domesticPrice: 0,
    domesticEstimated: false,
    totalPrice: best.price,
    airline: best.airline,
    totalStops: best.stops,
    intlStops: best.stops,
    domesticStops: 0,
    intlBookingUrl: best.bookingUrl,
  };
}

function recordFromSplit(
  user: User,
  route: { origin: string; destination: string },
  depDate: string,
  retDate: string,
  best: ReturnType<typeof findBestItinerary> & object,
): KVRecord {
  const segments: string[][] = [];
  if (best.outbound) segments.push(best.outbound.routePath);
  segments.push(best.intl.routePath);
  const routePath = mergeRoutePaths(segments);

  return {
    userId: user.id,
    origin: route.origin,
    destination: route.destination,
    checkedAt: new Date().toISOString(),
    hub: displayHub(routePath, route.origin),
    routePath,
    depDate,
    retDate,
    intlPrice: best.intl.price,
    domesticPrice: best.domesticPrice,
    domesticEstimated: best.domesticEstimated,
    totalPrice: best.totalPrice,
    airline: best.intl.airline,
    totalStops: best.totalStops,
    intlStops: best.intl.stops,
    domesticStops: best.domesticStops,
    intlBookingUrl: best.intl.bookingUrl,
    domesticOutboundBookingUrl: best.outbound?.bookingUrl,
    domesticReturnBookingUrl: best.inbound?.bookingUrl,
  };
}

async function trySplitItinerary(
  env: Env,
  profile: SearchProfile,
  route: { origin: string; destination: string },
  hub: string,
  depDate: string,
  retDate: string,
  maxStops: number,
  log: string[],
): Promise<{ itinerary: NonNullable<ReturnType<typeof findBestItinerary>>; searchCount: number } | null> {
  let searchCount = 0;
  const intlOptions = await searchRoundTripOptions(
    env,
    hub,
    route.destination,
    depDate,
    retDate,
    maxStops,
  );
  searchCount += 1;
  if (intlOptions.length === 0) return null;

  const needsDomestic = route.origin !== hub;
  let outboundOptions: FlightSearchResult[] = [];
  let inboundOptions: FlightSearchResult[] = [];

  if (needsDomestic) {
    const outbound = await getDomesticLegOptions(
      env,
      profile,
      route.origin,
      hub,
      depDate,
      maxStops,
      log,
    );
    if (outbound.apiCalled) searchCount += 1;

    const inbound = await getDomesticLegOptions(
      env,
      profile,
      hub,
      route.origin,
      retDate,
      maxStops,
      log,
    );
    if (inbound.apiCalled) searchCount += 1;

    outboundOptions = outbound.options;
    inboundOptions = inbound.options;
  }

  const itinerary = findBestItinerary(
    intlOptions,
    outboundOptions,
    inboundOptions,
    maxStops,
    needsDomestic,
  );
  if (!itinerary) return null;

  return { itinerary, searchCount };
}

async function savePriceRecord(
  kv: KVNamespace,
  runDate: string,
  record: KVRecord,
): Promise<Deal> {
  const via = routeViaKey(record.routePath, record.hub);
  const key = `${runDate}:${record.userId}:${record.origin}:${via}:${record.destination}:${record.depDate}:${record.retDate}`;
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
  const schedule = buildUserTripSchedule(user, profile);
  const trip = userTripDates(user);
  const departureDates = departureDatesForReturn(schedule, retDate);

  const deals: Deal[] = [];
  let searchCount = 0;

  const maxStops = user.max_stops ?? 2;
  log.push(
    `User ${user.email}: ${route.origin}→${route.destination} dep=${trip.departStart}..${trip.departEnd} ret=${retDate} minAway=${trip.tripMinDays}d maxStops=${maxStops}${hubs.length > 0 ? ` splitFallback=[${hubs.join("|")}]` : ""}`,
  );

  if (departureDates.length === 0) {
    log.push(
      `  No departures for return ${retDate} with min ${trip.tripMinDays} day(s) away — skipping.`,
    );
    return { deals, searchCount, nextHubIndex };
  }

  for (const depDate of departureDates) {
    log.push(`  Checking dep=${depDate}`);

    let bestRecord: KVRecord | null = null;
    let bestLog = "";

    try {
      const directOptions = await searchRoundTripOptions(
        env,
        route.origin,
        route.destination,
        depDate,
        retDate,
        maxStops,
      );
      searchCount += 1;

      if (directOptions.length > 0) {
        const direct = directOptions[0];
        bestRecord = recordFromDirect(user, route, depDate, retDate, direct);
        bestLog = `    direct ${direct.routePath.join("→")} = ${direct.price} CAD (${direct.stops} stop${direct.stops === 1 ? "" : "s"})`;
      } else {
        log.push(`    no direct results within ${maxStops} stop(s)`);
      }
    } catch (error) {
      if (error instanceof SerpapiQuotaExhaustedError) {
        throw error;
      }
      const message =
        error instanceof SerpapiError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error);
      log.push(`    direct search error: ${message}`);
      console.error(
        `[tracker] user=${user.email} direct dep=${depDate}`,
        error,
      );
    }

    for (const hub of hubs) {
      try {
        const split = await trySplitItinerary(
          env,
          profile,
          route,
          hub,
          depDate,
          retDate,
          maxStops,
          log,
        );
        if (!split) {
          log.push(`    split via ${hub}: no results`);
          continue;
        }

        searchCount += split.searchCount;
        const splitRecord = recordFromSplit(
          user,
          route,
          depDate,
          retDate,
          split.itinerary,
        );

        if (!bestRecord || splitRecord.totalPrice < bestRecord.totalPrice) {
          bestRecord = splitRecord;
          const path = splitRecord.routePath?.join("→") ?? `${route.origin}→${hub}→${route.destination}`;
          bestLog = `    split ${path} = ${splitRecord.totalPrice} CAD (${splitRecord.totalStops} stop${splitRecord.totalStops === 1 ? "" : "s"}${splitRecord.domesticEstimated ? " est" : ""})`;
        }
      } catch (error) {
        if (error instanceof SerpapiQuotaExhaustedError) {
          throw error;
        }
        const message =
          error instanceof SerpapiError
            ? error.message
            : error instanceof Error
              ? error.message
              : String(error);
        log.push(`    split via ${hub} error: ${message}`);
        console.error(
          `[tracker] user=${user.email} hub=${hub} dep=${depDate}`,
          error,
        );
      }
    }

    if (!bestRecord) {
      log.push(`    no itinerary for dep=${depDate}`);
      continue;
    }

    const deal = await savePriceRecord(env.PRICE_HISTORY, runDate, bestRecord);
    deals.push(deal);
    log.push(bestLog);
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

  const quota = await getQuotaStatus(env);
  log.push(`Serpapi usage this month: ${quota.used}/${quota.limit}`);
  if (quota.exhausted) {
    const skipReason = `Serpapi search limit reached for ${quota.month} (${quota.used}/${quota.limit}). Paused until next month.`;
    log.push(`Skipped: ${skipReason}`);
    return {
      skipped: true,
      skipReason,
      quotaExhausted: true,
      log,
      deals: [],
      searchCount: 0,
      usersChecked: 0,
      tier,
    };
  }

  if (options.manual) {
    log.push("Manual run — resets each user's automatic schedule after this completes.");
  }

  const lockAcquired = await tryAcquireRunLock(env.PRICE_HISTORY);
  if (!lockAcquired) {
    const skipReason = options.manual
      ? "A price check is already running. Try again in a few minutes."
      : "Skipped: another run is already in progress";
    log.push(skipReason);
    return {
      skipped: true,
      skipReason,
      log,
      deals: [],
      searchCount: 0,
      usersChecked: 0,
      tier,
    };
  }

  try {
    let users = options.manual
      ? await getActiveUsers(env.DB)
      : await getScheduledUsers(env.DB);

    if (users.length === 0) {
      const skipReason = options.manual
        ? "No active users."
        : "Automatic checks paused — no users have automatic tracking enabled.";
      log.push(skipReason);
      return {
        skipped: true,
        skipReason,
        log,
        deals: [],
        searchCount: 0,
        usersChecked: 0,
        tier,
      };
    }

    if (!options.manual) {
      users = await filterUsersDueForCheck(env.PRICE_HISTORY, users, log);
      if (users.length === 0) {
        const skipReason = "No users due for automatic check yet.";
        log.push(`Skipped: ${skipReason}`);
        return {
          skipped: true,
          skipReason,
          log,
          deals: [],
          searchCount: 0,
          usersChecked: 0,
          tier,
        };
      }
    }

    const runDate = todayUtc();
    const allDeals: Deal[] = [];
    const usersToCheck = users.length;
    let usersProcessed = 0;

    for (const user of users) {
      try {
        const schedule = buildUserTripSchedule(user, profile);
        const returnIndex = await getTrackerState(
          env.PRICE_HISTORY,
          `tracker:returnDateIndex:${user.id}`,
          0,
        );
        const retDate =
          schedule.returnDates[
            returnIndex % Math.max(schedule.returnDates.length, 1)
          ];
        if (!retDate) {
          log.push(`User ${user.email}: no return dates in window — skipping.`);
          continue;
        }

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

        await setTrackerState(
          env.PRICE_HISTORY,
          `tracker:returnDateIndex:${user.id}`,
          schedule.returnDates.length > 0
            ? (returnIndex + 1) % schedule.returnDates.length
            : 0,
        );

        try {
          await dispatchAlertsForUser(env, user, result.deals, log);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log.push(`Alert error for ${user.email}: ${message}`);
          console.error("[tracker] alert failed", error);
        }

        const checkedAt = new Date().toISOString();
        await setUserLastCheckAt(env.PRICE_HISTORY, user.id, checkedAt);
        usersProcessed += 1;
        log.push(
          `  ${user.email}: next automatic check after ${user.check_interval_days} day${user.check_interval_days === 1 ? "" : "s"}`,
        );
      } catch (error) {
        if (error instanceof SerpapiQuotaExhaustedError) {
          log.push(error.message);
          return {
            skipped: true,
            skipReason: error.message,
            quotaExhausted: true,
            log,
            deals: allDeals,
            searchCount,
            usersChecked: usersProcessed,
            tier,
          };
        }
        throw error;
      }
    }

    log.push(`Completed ${searchCount} Serpapi searches, ${allDeals.length} deals saved.`);

    return {
      skipped: false,
      log,
      deals: allDeals,
      searchCount,
      usersChecked: usersToCheck,
      tier,
    };
  } finally {
    await releaseRunLock(env.PRICE_HISTORY);
  }
}

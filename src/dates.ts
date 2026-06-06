import {
  DEFAULT_DEPART_END,
  DEFAULT_DEPART_START,
  DEFAULT_RETURN_END,
  DEFAULT_RETURN_START,
  DEFAULT_TRIP_MIN_DAYS,
  MAX_TRIP_MIN_DAYS,
  MIN_TRIP_MIN_DAYS,
  RETURN_DATE_SAMPLES,
} from "./constants";
import type { SearchProfile, User } from "./types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface UserTripDates {
  departStart: string;
  departEnd: string;
  returnStart: string;
  returnEnd: string;
  tripMinDays: number;
}

export interface UserTripSchedule {
  departureDates: string[];
  returnDates: string[];
  tripMinDays: number;
}

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = parseUtcDate(value);
  return parsed !== null && formatDateOnly(parsed) === value;
}

export function parseUtcDate(iso: string): Date | null {
  if (!ISO_DATE.test(iso)) return null;
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

export function formatDateOnly(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function daysBetween(startIso: string, endIso: string): number {
  const start = parseUtcDate(startIso);
  const end = parseUtcDate(endIso);
  if (!start || !end) return -1;
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

export function sampleDatesInRange(
  startIso: string,
  endIso: string,
  count: number,
): string[] {
  if (count <= 0) return [];

  const start = parseUtcDate(startIso);
  const end = parseUtcDate(endIso);
  if (!start || !end || end < start) return [];

  if (count === 1) return [startIso];

  const startMs = start.getTime();
  const endMs = end.getTime();
  const step = (endMs - startMs) / (count - 1);
  const dates: string[] = [];

  for (let i = 0; i < count; i++) {
    dates.push(formatDateOnly(new Date(startMs + Math.round(step * i))));
  }

  return [...new Set(dates)].sort();
}

export function userTripDates(user: User): UserTripDates {
  return {
    departStart: user.depart_start ?? DEFAULT_DEPART_START,
    departEnd: user.depart_end ?? DEFAULT_DEPART_END,
    returnStart: user.return_start ?? DEFAULT_RETURN_START,
    returnEnd: user.return_end ?? DEFAULT_RETURN_END,
    tripMinDays: user.trip_min_days ?? DEFAULT_TRIP_MIN_DAYS,
  };
}

export function buildUserTripSchedule(
  user: User,
  profile: SearchProfile,
): UserTripSchedule {
  const trip = userTripDates(user);
  return {
    departureDates: sampleDatesInRange(
      trip.departStart,
      trip.departEnd,
      profile.departureDateCount,
    ),
    returnDates: sampleDatesInRange(
      trip.returnStart,
      trip.returnEnd,
      RETURN_DATE_SAMPLES,
    ),
    tripMinDays: trip.tripMinDays,
  };
}

export function departureDatesForReturn(
  schedule: UserTripSchedule,
  retDate: string,
): string[] {
  return schedule.departureDates.filter(
    (depDate) => daysBetween(depDate, retDate) >= schedule.tripMinDays,
  );
}

export function validateTripDateSettings(input: {
  departStart: string;
  departEnd: string;
  returnStart: string;
  returnEnd: string;
  tripMinDays: number;
}): string | null {
  const fields = [
    ["Depart from", input.departStart],
    ["Depart by", input.departEnd],
    ["Return from", input.returnStart],
    ["Return by", input.returnEnd],
  ] as const;

  for (const [label, value] of fields) {
    if (!isIsoDate(value)) {
      return `${label} must be a valid date (YYYY-MM-DD).`;
    }
  }

  if (input.departEnd < input.departStart) {
    return "Depart by must be on or after depart from.";
  }

  if (input.returnEnd < input.returnStart) {
    return "Return by must be on or after return from.";
  }

  if (
    !Number.isFinite(input.tripMinDays) ||
    input.tripMinDays < MIN_TRIP_MIN_DAYS ||
    input.tripMinDays > MAX_TRIP_MIN_DAYS
  ) {
    return `Min days away must be between ${MIN_TRIP_MIN_DAYS} and ${MAX_TRIP_MIN_DAYS}.`;
  }

  if (daysBetween(input.departEnd, input.returnStart) < input.tripMinDays) {
    return "Return window must start at least your min days away after the latest departure.";
  }

  const earliestReturn = sampleDatesInRange(
    input.returnStart,
    input.returnEnd,
    1,
  )[0];
  const latestDepart = input.departEnd;
  if (
    earliestReturn &&
    daysBetween(latestDepart, earliestReturn) < input.tripMinDays
  ) {
    return "At least one departure/return pair must satisfy your min days away.";
  }

  return null;
}

export function formatDateRange(start: string, end: string): string {
  if (start === end) return start;
  return `${start} – ${end}`;
}

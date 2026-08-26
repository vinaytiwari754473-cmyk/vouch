import type { EpochSeconds, ISTDate } from "./types";

const IST_OFFSET_SECONDS = 5 * 60 * 60 + 30 * 60;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export class DateValueError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "DateValueError";
  }
}

export function epochSeconds(value: unknown, label = "timestamp"): EpochSeconds {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    Object.is(value, -0) ||
    value < 0
  ) {
    throw new DateValueError(`${label} must be a non-negative safe-integer Unix timestamp`);
  }
  const milliseconds = (value + IST_OFFSET_SECONDS) * 1000;
  if (!Number.isSafeInteger(milliseconds)) {
    throw new DateValueError(`${label} is outside the supported date range`);
  }
  const probe = new Date(milliseconds);
  if (Number.isNaN(probe.getTime())) {
    throw new DateValueError(`${label} is outside the supported date range`);
  }
  return value as EpochSeconds;
}

export function parseISTDate(value: unknown, label = "date"): ISTDate {
  if (typeof value !== "string") {
    throw new DateValueError(`${label} must use YYYY-MM-DD`);
  }
  const match = DATE_PATTERN.exec(value);
  if (match === null) {
    throw new DateValueError(`${label} must use YYYY-MM-DD`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw new DateValueError(`${label} is not a real calendar date`);
  }
  return value as ISTDate;
}

export function epochToISTDate(value: EpochSeconds | number): ISTDate {
  const safe = epochSeconds(value);
  return new Date((safe + IST_OFFSET_SECONDS) * 1000)
    .toISOString()
    .slice(0, 10) as ISTDate;
}

export function addCalendarDays(value: ISTDate | string, days: number): ISTDate {
  const safeDate = parseISTDate(value);
  if (!Number.isSafeInteger(days)) {
    throw new DateValueError("calendar-day offset must be a safe integer");
  }
  const match = DATE_PATTERN.exec(safeDate);
  if (match === null) throw new DateValueError("date invariant failed");
  const timestamp = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const result = new Date(timestamp + days * 86_400_000);
  return result.toISOString().slice(0, 10) as ISTDate;
}

export function isWithinPostingWindow(
  settledDate: ISTDate,
  postingDate: ISTDate,
  windowDays: number,
): boolean {
  return postingDate >= settledDate && postingDate <= addCalendarDays(settledDate, windowDays);
}

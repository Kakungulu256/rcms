import { isValid, parseISO } from "date-fns";

export type RentHistoryEntry = {
  effectiveDate: string;
  amount: number;
  source?: "house" | "override" | "manual";
  note?: string;
};

export type ProrationMode = "actual_days" | "fixed_30";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const FIXED_PRORATION_DAYS = 30;

let defaultProrationMode: ProrationMode = "actual_days";

function roundCurrency(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function roundProratedRent(value: number) {
  const normalized = Number(value) || 0;
  if (normalized <= 0) return 0;
  return Math.round(normalized / 1000) * 1000;
}

export function normalizeProrationMode(value?: string | null): ProrationMode {
  return value === "fixed_30" ? "fixed_30" : "actual_days";
}

export function setDefaultProrationMode(value?: string | null) {
  defaultProrationMode = normalizeProrationMode(value);
}

function isValidMonth(value: string) {
  if (!/^\d{4}-\d{2}$/.test(value)) return false;
  const month = Number(value.slice(5, 7));
  return month >= 1 && month <= 12;
}

export function formatEffectiveMonth(value?: string | null) {
  if (!value) return "";
  return String(value).slice(0, 7);
}

export function normalizeEffectiveMonth(value?: string | null) {
  if (!value) return null;
  const monthValue = String(value).slice(0, 7);
  if (!isValidMonth(monthValue)) return null;
  return `${monthValue}-01`;
}

function formatDateUtc(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function previousMonthStart(value: string) {
  const parsed = parseISO(`${value}T00:00:00.000Z`);
  if (!isValid(parsed)) return "";
  const prev = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() - 1, 1));
  return formatDateUtc(prev);
}

function parseDateOnlyUtc(value?: string | null) {
  if (!value) return null;
  const normalized = String(value).slice(0, 10);
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseMonthStartUtc(monthKey: string) {
  const parsed = new Date(`${monthKey}-01T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function endOfMonthUtc(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

function diffDaysInclusive(start: Date, end: Date) {
  return Math.floor((end.getTime() - start.getTime()) / MS_PER_DAY) + 1;
}

function isSameMonthUtc(left: Date, right: Date) {
  return (
    left.getUTCFullYear() === right.getUTCFullYear() &&
    left.getUTCMonth() === right.getUTCMonth()
  );
}

function prorateMonthlyRent(params: {
  baseRent: number;
  monthKey: string;
  occupancyStartDate?: string | null;
  occupancyEndDate?: string | null;
  prorationMode?: ProrationMode;
}) {
  const { baseRent, monthKey, occupancyStartDate, occupancyEndDate } = params;
  const normalizedRent = Number(baseRent) || 0;
  if (normalizedRent <= 0) return 0;

  const monthStart = parseMonthStartUtc(monthKey);
  if (!monthStart) return roundCurrency(normalizedRent);
  const monthEnd = endOfMonthUtc(monthStart);
  const occupancyStart = parseDateOnlyUtc(occupancyStartDate);
  const occupancyEnd = parseDateOnlyUtc(occupancyEndDate);

  if (!occupancyStart) {
    return roundCurrency(normalizedRent);
  }

  const isMoveInMonth = isSameMonthUtc(occupancyStart, monthStart);
  if (!isMoveInMonth) {
    return roundCurrency(normalizedRent);
  }

  if (occupancyEnd && isSameMonthUtc(occupancyEnd, monthStart)) {
    return roundCurrency(normalizedRent);
  }

  const effectiveStart =
    occupancyStart && occupancyStart > monthStart ? occupancyStart : monthStart;
  const effectiveEnd = monthEnd;

  if (effectiveEnd < effectiveStart) {
    return 0;
  }

  const occupiedDays = diffDaysInclusive(effectiveStart, effectiveEnd);
  const totalDaysInMonth = diffDaysInclusive(monthStart, monthEnd);
  const mode = params.prorationMode ?? defaultProrationMode;
  const denominator = mode === "fixed_30" ? FIXED_PRORATION_DAYS : totalDaysInMonth;
  if (occupiedDays >= denominator) {
    return roundCurrency(normalizedRent);
  }
  return roundProratedRent((normalizedRent * occupiedDays) / denominator);
}

export function parseRentHistory(value?: string | null): RentHistoryEntry[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is RentHistoryEntry =>
          Boolean(item) &&
          typeof item.effectiveDate === "string" &&
          typeof item.amount === "number"
      )
      .slice()
      .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  } catch {
    return [];
  }
}

function buildEffectiveHistory(
  _tenantHistory: RentHistoryEntry[],
  houseHistory: RentHistoryEntry[]
) {
  return houseHistory
    .slice()
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
}

export function buildRentByMonth(params: {
  months: string[];
  houseHistoryJson?: string | null;
  fallbackRent: number;
  occupancyStartDate?: string | null;
  occupancyEndDate?: string | null;
  prorationMode?: ProrationMode;
}) {
  const {
    months,
    houseHistoryJson,
    fallbackRent,
    occupancyStartDate,
    occupancyEndDate,
    prorationMode,
  } = params;
  const houseHistory = parseRentHistory(houseHistoryJson);
  const history = buildEffectiveHistory([], houseHistory);
  const rentByMonth: Record<string, number> = {};
  months.forEach((month) => {
    const monthStart = `${month}-01`;
    const entry = history
      .filter((item) => item.effectiveDate <= monthStart)
      .at(-1);
    const baseRent = entry?.amount ?? fallbackRent;
    rentByMonth[month] = prorateMonthlyRent({
      baseRent,
      monthKey: month,
      occupancyStartDate,
      occupancyEndDate,
      prorationMode,
    });
  });
  return rentByMonth;
}

export function getBaseRentForMonth(params: {
  monthKey: string;
  houseHistoryJson?: string | null;
  fallbackRent: number;
}) {
  const { monthKey, houseHistoryJson, fallbackRent } = params;
  const houseHistory = parseRentHistory(houseHistoryJson);
  const monthStart = `${monthKey}-01`;
  const entry = houseHistory
    .slice()
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate))
    .filter((item) => item.effectiveDate <= monthStart)
    .at(-1);
  return entry?.amount ?? fallbackRent;
}

export function appendRentHistory(
  existing: string | null | undefined,
  entry: RentHistoryEntry
): string {
  const history = parseRentHistory(existing);
  const filtered = history.filter(
    (item) => item.effectiveDate !== entry.effectiveDate
  );
  filtered.push(entry);
  filtered.sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  return JSON.stringify(filtered);
}

export function upsertRentHistoryEntry(params: {
  existing?: string | null;
  entry: RentHistoryEntry;
  replaceDate?: string | null;
}): string {
  const { existing, entry, replaceDate } = params;
  const history = parseRentHistory(existing);
  const targetDate = replaceDate ?? entry.effectiveDate;
  const filtered = history.filter((item) => item.effectiveDate !== targetDate);
  filtered.push(entry);
  filtered.sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  return JSON.stringify(filtered);
}

export function appendRentHistoryWithBaseline(params: {
  existing?: string | null;
  newEntry: RentHistoryEntry;
  previousAmount?: number | null;
  baselineDate?: string | null;
}): string {
  const { existing, newEntry, previousAmount, baselineDate } = params;
  const history = parseRentHistory(existing);
  const normalizedEffectiveDate =
    normalizeEffectiveMonth(newEntry.effectiveDate) ?? newEntry.effectiveDate;
  const normalizedEntry = { ...newEntry, effectiveDate: normalizedEffectiveDate };
  const sortedHistory = history
    .slice()
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  const earliestEntry = sortedHistory[0] ?? null;
  const hasPriorEntry = history.some(
    (item) => item.effectiveDate < normalizedEntry.effectiveDate
  );
  const previousRate =
    typeof previousAmount === "number" && Number.isFinite(previousAmount)
      ? previousAmount
      : null;
  let nextHistory = history;

  if (!hasPriorEntry) {
    const baselineCandidate = normalizeEffectiveMonth(baselineDate) ?? "";
    let baselineEffective = baselineCandidate;
    if (!baselineEffective || baselineEffective >= normalizedEntry.effectiveDate) {
      baselineEffective = previousMonthStart(normalizedEntry.effectiveDate);
    }

    if (baselineEffective && baselineEffective < normalizedEntry.effectiveDate) {
      if (earliestEntry && earliestEntry.effectiveDate > normalizedEntry.effectiveDate) {
        nextHistory = history.filter(
          (item) => item.effectiveDate !== baselineEffective
        );
        nextHistory = nextHistory.map((item) =>
          item.effectiveDate === earliestEntry.effectiveDate
            ? {
                ...item,
                effectiveDate: baselineEffective,
                source: item.source ?? normalizedEntry.source,
              }
            : item
        );
      } else if (!earliestEntry && previousRate != null) {
        nextHistory = parseRentHistory(
          appendRentHistory(existing ?? null, {
            effectiveDate: baselineEffective,
            amount: previousRate,
            source: normalizedEntry.source,
          })
        );
      }
    }
  }

  return appendRentHistory(JSON.stringify(nextHistory), normalizedEntry);
}

export function removeRentHistoryEntry(
  existing: string | null | undefined,
  effectiveDate: string
): string {
  const history = parseRentHistory(existing);
  const filtered = history.filter((item) => item.effectiveDate !== effectiveDate);
  filtered.sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  return JSON.stringify(filtered);
}

import { addDays, format, isValid, parseISO } from "date-fns";

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

function entryPriority(entry: RentHistoryEntry) {
  return entry.source === "house" ? 0 : 1;
}

function buildEffectiveHistory(
  tenantHistory: RentHistoryEntry[],
  houseHistory: RentHistoryEntry[]
) {
  const tenantSpecificHistory = tenantHistory.filter((entry) => entry.source !== "house");
  const baseHistory =
    tenantSpecificHistory.length > 0
      ? [...houseHistory, ...tenantSpecificHistory]
      : houseHistory.length > 0
        ? houseHistory
        : tenantHistory;

  return baseHistory.sort((a, b) => {
    const dateOrder = a.effectiveDate.localeCompare(b.effectiveDate);
    if (dateOrder !== 0) return dateOrder;
    return entryPriority(a) - entryPriority(b);
  });
}

export function buildRentByMonth(params: {
  months: string[];
  tenantHistoryJson?: string | null;
  houseHistoryJson?: string | null;
  fallbackRent: number;
  occupancyStartDate?: string | null;
  occupancyEndDate?: string | null;
  prorationMode?: ProrationMode;
}) {
  const {
    months,
    tenantHistoryJson,
    houseHistoryJson,
    fallbackRent,
    occupancyStartDate,
    occupancyEndDate,
    prorationMode,
  } = params;
  const tenantHistory = parseRentHistory(tenantHistoryJson);
  const houseHistory = parseRentHistory(houseHistoryJson);
  const history = buildEffectiveHistory(tenantHistory, houseHistory);
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

export function appendRentHistoryWithBaseline(params: {
  existing?: string | null;
  newEntry: RentHistoryEntry;
  previousAmount?: number | null;
  baselineDate?: string | null;
}): string {
  const { existing, newEntry, previousAmount, baselineDate } = params;
  const history = parseRentHistory(existing);
  const sortedHistory = history
    .slice()
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  const earliestEntry = sortedHistory[0] ?? null;
  const hasPriorEntry = history.some(
    (item) => item.effectiveDate < newEntry.effectiveDate
  );
  const previousRate =
    typeof previousAmount === "number" && Number.isFinite(previousAmount)
      ? previousAmount
      : null;
  let nextHistory = history;

  if (!hasPriorEntry) {
    const baselineCandidate = String(baselineDate ?? "").slice(0, 10);
    let baselineEffective = baselineCandidate;
    if (!baselineEffective || baselineEffective >= newEntry.effectiveDate) {
      const parsed = parseISO(`${newEntry.effectiveDate}T00:00:00.000Z`);
      if (isValid(parsed)) {
        baselineEffective = format(addDays(parsed, -1), "yyyy-MM-dd");
      } else {
        baselineEffective = "";
      }
    }

    if (baselineEffective && baselineEffective < newEntry.effectiveDate) {
      if (earliestEntry && earliestEntry.effectiveDate > newEntry.effectiveDate) {
        nextHistory = history.filter(
          (item) => item.effectiveDate !== baselineEffective
        );
        nextHistory = nextHistory.map((item) =>
          item.effectiveDate === earliestEntry.effectiveDate
            ? {
                ...item,
                effectiveDate: baselineEffective,
                source: item.source ?? newEntry.source,
              }
            : item
        );
      } else if (!earliestEntry && previousRate != null) {
        nextHistory = parseRentHistory(
          appendRentHistory(existing ?? null, {
            effectiveDate: baselineEffective,
            amount: previousRate,
            source: newEntry.source,
          })
        );
      }
    }
  }

  return appendRentHistory(JSON.stringify(nextHistory), newEntry);
}

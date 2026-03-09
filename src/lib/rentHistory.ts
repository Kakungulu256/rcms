export type RentHistoryEntry = {
  effectiveDate: string;
  amount: number;
  source?: "house" | "override" | "manual";
  note?: string;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function roundCurrency(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function roundProratedRent(value: number) {
  const normalized = Number(value) || 0;
  if (normalized <= 0) return 0;
  return Math.round(normalized / 1000) * 1000;
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

function prorateMonthlyRent(params: {
  baseRent: number;
  monthKey: string;
  occupancyStartDate?: string | null;
  occupancyEndDate?: string | null;
}) {
  const { baseRent, monthKey, occupancyStartDate, occupancyEndDate } = params;
  const normalizedRent = Number(baseRent) || 0;
  if (normalizedRent <= 0) return 0;

  const monthStart = parseMonthStartUtc(monthKey);
  if (!monthStart) return roundCurrency(normalizedRent);
  const monthEnd = endOfMonthUtc(monthStart);
  const occupancyStart = parseDateOnlyUtc(occupancyStartDate);
  const occupancyEnd = parseDateOnlyUtc(occupancyEndDate);

  const effectiveStart =
    occupancyStart && occupancyStart > monthStart ? occupancyStart : monthStart;
  const effectiveEnd =
    occupancyEnd && occupancyEnd < monthEnd ? occupancyEnd : monthEnd;

  if (effectiveEnd < effectiveStart) {
    return 0;
  }

  const occupiedDays = diffDaysInclusive(effectiveStart, effectiveEnd);
  const totalDaysInMonth = diffDaysInclusive(monthStart, monthEnd);
  if (occupiedDays >= totalDaysInMonth) {
    return roundCurrency(normalizedRent);
  }
  return roundProratedRent((normalizedRent * occupiedDays) / totalDaysInMonth);
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
}) {
  const {
    months,
    tenantHistoryJson,
    houseHistoryJson,
    fallbackRent,
    occupancyStartDate,
    occupancyEndDate,
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

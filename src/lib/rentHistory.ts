export type RentHistoryEntry = {
  effectiveDate: string;
  amount: number;
  source: "house" | "override" | "manual";
  note?: string;
};

function monthKey(dateValue: string) {
  return dateValue.slice(0, 7);
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

export function buildRentByMonth(params: {
  months: string[];
  tenantHistoryJson?: string | null;
  houseHistoryJson?: string | null;
  fallbackRent: number;
}) {
  const { months, tenantHistoryJson, houseHistoryJson, fallbackRent } = params;
  const tenantHistory = parseRentHistory(tenantHistoryJson);
  const houseHistory = parseRentHistory(houseHistoryJson);
  const history = tenantHistory.length > 0 ? tenantHistory : houseHistory;
  const rentByMonth: Record<string, number> = {};
  months.forEach((month) => {
    const monthStart = `${month}-01`;
    const entry = history
      .filter((item) => item.effectiveDate <= monthStart)
      .at(-1);
    rentByMonth[month] = entry?.amount ?? fallbackRent;
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

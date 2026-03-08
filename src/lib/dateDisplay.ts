import { format, isValid, parseISO } from "date-fns";

function parseDateValue(value: string | Date): Date | null {
  if (value instanceof Date) {
    return isValid(value) ? value : null;
  }
  if (/^\d{4}-\d{2}$/.test(value)) {
    const parsed = parseISO(`${value}-01`);
    return isValid(parsed) ? parsed : null;
  }
  const parsed = parseISO(value);
  return isValid(parsed) ? parsed : null;
}

export function formatDisplayDate(
  value?: string | Date | null,
  fallback = "--"
): string {
  if (!value) return fallback;
  const parsed = parseDateValue(value);
  return parsed ? format(parsed, "dd/MM/yy") : fallback;
}

export function formatShortMonth(
  value?: string | Date | null,
  fallback = "--"
): string {
  if (!value) return fallback;
  const parsed = parseDateValue(value);
  return parsed ? format(parsed, "MMM yyyy") : fallback;
}

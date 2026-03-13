import type { House } from "./schema";

function normalizeText(value?: string | null): string {
  return String(value ?? "").trim();
}

export function compareHouseLabels(a: House, b: House): number {
  const codeA = normalizeText(a.code);
  const codeB = normalizeText(b.code);
  const codeCompare = codeA.localeCompare(codeB, undefined, {
    numeric: true,
    sensitivity: "base",
  });
  if (codeCompare !== 0) return codeCompare;

  const nameA = normalizeText(a.name);
  const nameB = normalizeText(b.name);
  return nameA.localeCompare(nameB, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function sortHousesNatural(houses: House[]): House[] {
  return [...houses].sort(compareHouseLabels);
}

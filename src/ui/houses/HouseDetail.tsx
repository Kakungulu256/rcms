import type { House } from "../../lib/schema";
import type { RentHistoryEntry } from "../../lib/rentHistory";
import { formatEffectiveMonth, parseRentHistory } from "../../lib/rentHistory";
import { formatAmount } from "../../lib/numberFormat";

type Props = {
  house?: House | null;
  canManage?: boolean;
  onEditHistory?: (entry: RentHistoryEntry) => void;
  onAddHistory?: () => void;
  onDeleteHistory?: (entry: RentHistoryEntry) => void;
};

export default function HouseDetail({
  house,
  canManage,
  onEditHistory,
  onAddHistory,
  onDeleteHistory,
}: Props) {
  if (!house) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-500">
        Select a house to view details.
      </div>
    );
  }

  const history = parseRentHistory(house.rentHistoryJson ?? null);

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-slate-500">
            House Detail
          </div>
          <h4 className="mt-3 text-xl font-semibold text-white">{house.code}</h4>
          <p className="mt-1 text-sm text-slate-400">{house.name || "--"}</p>
        </div>
        <span className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300">
          {house.status}
        </span>
      </div>
      <div className="mt-6 grid gap-4 text-sm text-slate-300 md:grid-cols-2">
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
          <div className="text-xs uppercase tracking-[0.2em] text-slate-500">
            Monthly Rent
          </div>
          <div className="amount mt-2 text-lg font-semibold text-slate-100">
            {formatAmount(house.monthlyRent)}
          </div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
          <div className="text-xs uppercase tracking-[0.2em] text-slate-500">
            Notes
          </div>
          <div className="mt-2 text-sm text-slate-300">
            {house.notes || "No notes yet."}
          </div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 md:col-span-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-500">
              Rent History
            </div>
            {canManage && onAddHistory ? (
              <button
                type="button"
                onClick={onAddHistory}
                className="shrink-0 whitespace-nowrap rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-100 transition hover:bg-slate-800/60"
              >
                Add Rate
              </button>
            ) : null}
          </div>
          <div className="mt-3 space-y-2 text-sm text-slate-300">
            {history.length > 0 ? (
              history
                .slice()
                .reverse()
                .map((entry, index) => (
                  <div
                    key={`${entry.effectiveDate}-${entry.amount}-${index}`}
                    className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="text-xs uppercase tracking-[0.2em] text-slate-500">
                        {formatEffectiveMonth(entry.effectiveDate) ||
                          entry.effectiveDate}
                      </div>
                      <div className="mt-1 truncate text-sm font-semibold text-slate-100">
                        {formatAmount(entry.amount)}
                      </div>
                    </div>
                    {canManage && (onEditHistory || onDeleteHistory) ? (
                      <div className="flex shrink-0 items-center gap-2 text-xs">
                        {onEditHistory ? (
                          <button
                            type="button"
                            className="rounded-full border border-slate-700 px-3 py-1 text-slate-100 transition hover:bg-slate-800/60"
                            onClick={() => onEditHistory(entry)}
                          >
                            Edit
                          </button>
                        ) : null}
                        {onDeleteHistory ? (
                          <button
                            type="button"
                            className="rounded-full border border-rose-500/40 px-3 py-1 text-rose-200 transition hover:bg-rose-500/10"
                            onClick={() => onDeleteHistory(entry)}
                          >
                            Remove
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ))
            ) : (
              <div className="text-slate-500">No rent history recorded.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

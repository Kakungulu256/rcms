import type { House } from "../../lib/schema";
import { parseRentHistory } from "../../lib/rentHistory";

type Props = {
  house?: House | null;
};

export default function HouseDetail({ house }: Props) {
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
      <div className="flex items-start justify-between">
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
      <div className="mt-6 grid gap-4 text-sm text-slate-300">
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
          <div className="text-xs uppercase tracking-[0.2em] text-slate-500">
            Monthly Rent
          </div>
          <div className="amount mt-2 text-lg font-semibold text-slate-100">
            {house.monthlyRent.toLocaleString(undefined, {
              minimumFractionDigits: 2,
            })}
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
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
          <div className="text-xs uppercase tracking-[0.2em] text-slate-500">
            Rent History
          </div>
          <div className="mt-2 space-y-2 text-sm text-slate-300">
            {history.length > 0 ? (
              history
                .slice()
                .reverse()
                .map((entry, index) => (
                  <div key={`${entry.effectiveDate}-${entry.amount}-${index}`}>
                    {entry.effectiveDate}:{" "}
                    {entry.amount.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                    })}
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

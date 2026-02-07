import type { AllocationPreview } from "./allocation";

type Props = {
  preview: AllocationPreview | null;
};

export default function AllocationPreviewPanel({ preview }: Props) {
  if (!preview) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-500">
        Complete the form to preview allocation.
      </div>
    );
  }

  return (
    <div
      className="rounded-2xl border p-5"
      style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
    >
      <div className="text-sm font-semibold text-slate-100">Allocation Preview</div>
      <div className="mt-1 text-xs text-slate-500">
        Payment will apply to the oldest unpaid months first.
      </div>
      <div className="mt-4 space-y-3">
        {preview.lines.map((line) => (
          <div
            key={line.month}
            className="rounded-xl border px-4 py-3"
            style={{ backgroundColor: "var(--surface-strong)", borderColor: "var(--border)" }}
          >
            <div className="flex items-center justify-between text-sm text-slate-200">
              <span>{line.month}</span>
              <span>
                Applied{" "}
                {line.applied.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                })}
              </span>
            </div>
            <div className="mt-1 text-xs text-slate-500">
              Remaining:{" "}
              {line.remaining.toLocaleString(undefined, {
                minimumFractionDigits: 2,
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

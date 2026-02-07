type Props = {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
};

export default function Modal({ open, title, description, onClose, children }: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-4">
      <div
        className="w-full max-w-lg rounded-2xl border p-6 shadow-2xl"
        style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold" style={{ color: "var(--text)" }}>
              {title}
            </h3>
            {description && (
              <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
                {description}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-md border px-3 py-1 text-xs"
            style={{ borderColor: "var(--border)", color: "var(--muted)" }}
          >
            Close
          </button>
        </div>
        <div className="mt-6 max-h-[70vh] overflow-y-auto pr-1">{children}</div>
      </div>
    </div>
  );
}

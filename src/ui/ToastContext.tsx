import { createContext, useCallback, useContext, useMemo, useState } from "react";

export type ToastKind = "success" | "error" | "warning" | "info";

type Toast = {
  id: string;
  kind: ToastKind;
  message: string;
};

type ToastContextValue = {
  push: (kind: ToastKind, message: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

function generateId() {
  return Math.random().toString(36).slice(2);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = generateId();
    setToasts((prev) => [...prev, { id, kind, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 4000);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed right-6 top-6 z-50 space-y-3" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={[
              "rounded-xl border px-4 py-3 text-sm shadow-lg",
              toast.kind === "success" && "border-emerald-400 bg-emerald-600 text-white",
              toast.kind === "error" && "border-rose-400 bg-rose-600 text-white",
              toast.kind === "warning" && "border-amber-400 bg-amber-500 text-white",
              toast.kind === "info" && "border-blue-400 bg-blue-600 text-white",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return ctx;
}

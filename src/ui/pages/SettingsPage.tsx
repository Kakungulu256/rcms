export default function SettingsPage() {
  return (
    <section className="space-y-6">
      <header>
        <div className="text-xs uppercase tracking-[0.35em] text-slate-500">
          Settings
        </div>
        <h3 className="mt-3 text-2xl font-semibold text-white">
          Admin Configuration
        </h3>
        <p className="mt-2 text-sm text-slate-400">
          System settings and access control.
        </p>
      </header>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
        <div className="text-sm font-semibold text-slate-100">
          Settings Panel
        </div>
        <div className="mt-2 text-xs text-slate-500">
          Available in a future enhancement.
        </div>
      </div>
    </section>
  );
}

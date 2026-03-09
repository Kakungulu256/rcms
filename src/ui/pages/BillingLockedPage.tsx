import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";

export default function BillingLockedPage() {
  const { billing, role } = useAuth();
  const isAdmin = role === "admin";

  return (
    <section className="space-y-6">
      <header>
        <div className="text-xs uppercase tracking-[0.35em] text-slate-500">Billing</div>
        <h3 className="mt-3 text-2xl font-semibold text-white">Access Locked</h3>
        <p className="mt-2 text-sm text-slate-400">
          {billing?.bannerMessage ||
            "Subscription is inactive. Upgrade or restore billing to continue using premium features."}
        </p>
      </header>

      <div className="rounded-2xl border border-rose-600/40 bg-rose-950/30 p-6">
        <div className="text-sm font-semibold text-rose-100">
          {billing?.bannerTitle || "Subscription required"}
        </div>
        <p className="mt-2 text-sm text-rose-100/80">
          {isAdmin
            ? "Open settings to upgrade your plan or resolve overdue billing."
            : "Contact your workspace admin to renew or upgrade billing."}
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          {isAdmin ? (
            <Link to="/app/settings" className="btn-primary text-sm">
              Open Billing Settings
            </Link>
          ) : null}
          <Link to="/app" className="btn-secondary text-sm">
            Back to Dashboard
          </Link>
        </div>
      </div>
    </section>
  );
}

import { useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export default function AppShell() {
  const { user, permissions, signOut, billing, canAccessFeature } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const compactSidebar = collapsed && !mobileNavOpen;
  const billingLocked = billing?.accessState === "locked";

  const navItems = [
    {
      to: "/app",
      label: "Dashboard",
      visible: true,
      end: true,
      premium: false,
    },
    {
      to: "/app/houses",
      label: "Houses",
      visible: permissions.canManageHouses,
      premium: true,
      featureKey: "houses.manage",
    },
    {
      to: "/app/tenants",
      label: "Tenants",
      visible: permissions.canViewTenants,
      premium: true,
      featureKey: "tenants.view",
    },
    {
      to: "/app/payments",
      label: "Payments",
      visible: permissions.canViewPayments,
      premium: true,
      featureKey: "payments.view",
    },
    {
      to: "/app/security-deposits",
      label: "Security Deposits",
      visible: permissions.canViewReports,
      premium: true,
      featureKey: "security_deposits.view",
    },
    {
      to: "/app/expenses",
      label: "Expenses",
      visible: permissions.canRecordExpenses,
      premium: true,
      featureKey: "expenses.manage",
    },
    {
      to: "/app/migration",
      label: "Old Records",
      visible: permissions.canUseMigration,
      premium: true,
      featureKey: "migration.use",
    },
    {
      to: "/app/reports",
      label: "Reports",
      visible: permissions.canViewReports,
      premium: true,
      featureKey: "reports.view",
    },
    {
      to: "/app/settings",
      label: "Settings",
      visible: permissions.canAccessSettings,
      premium: false,
    },
    {
      to: "/app/billing-lock",
      label: "Billing",
      visible: billingLocked,
      premium: false,
    },
  ].filter((item) => item.visible);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-6 focus:top-6 focus:z-50 focus:rounded-lg focus:bg-slate-900 focus:px-4 focus:py-2 focus:text-sm focus:text-white"
      >
        Skip to main content
      </a>
      <div className="flex min-h-screen">
        {mobileNavOpen && (
          <button
            type="button"
            aria-label="Close sidebar"
            onClick={() => setMobileNavOpen(false)}
            className="fixed inset-0 z-30 bg-slate-950/45 md:hidden"
          />
        )}
        <aside
          className={[
            "sidebar-shell fixed inset-y-0 left-0 z-40 flex flex-col overflow-visible border-r px-4 py-6 transition-all duration-200 md:relative md:z-20",
            mobileNavOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
            "w-[260px]",
            compactSidebar ? "md:w-[92px]" : "md:w-[260px]",
          ].join(" ")}
          style={{ backgroundColor: "var(--sidebar)", borderColor: "var(--sidebar-border)" }}
        >
          <button
            type="button"
            onClick={() => setCollapsed((prev) => !prev)}
            className="sidebar-toggle absolute -right-3 top-8 z-30 hidden h-7 w-7 items-center justify-center rounded-full border text-sm leading-none shadow-sm md:flex"
            style={{ borderColor: "var(--sidebar-border)", color: "var(--sidebar-muted)" }}
            aria-label={compactSidebar ? "Expand sidebar" : "Collapse sidebar"}
            aria-pressed={compactSidebar}
          >
            {compactSidebar ? ">" : "<"}
          </button>

          <div className="mb-8">
            <div className="flex items-center">
              <div
                className={[
                  "sidebar-brand rounded-xl",
                  compactSidebar ? "w-full px-2 py-2" : "px-4 py-3",
                ].join(" ")}
              >
                <div className={["text-xs font-semibold", compactSidebar ? "text-center" : ""].join(" ")} style={{ color: "var(--sidebar-brand-text)" }}>
                  {compactSidebar ? "RC" : "RCMS"}
                </div>
                {!compactSidebar && (
                  <>
                    <h1 className="mt-2 text-xl font-semibold" style={{ color: "var(--sidebar-brand-text)" }}>
                      Rent Collection
                    </h1>
                    <p className="mt-1 text-sm" style={{ color: "var(--sidebar-brand-muted)" }}>
                      Operations & reporting
                    </p>
                  </>
                )}
              </div>
            </div>
          </div>

          <nav className="space-y-1 text-sm">
            {navItems.map((item) => {
              const decision = item.featureKey ? canAccessFeature(item.featureKey) : { allowed: true };
              const locked = item.premium && !decision.allowed;
              const labelWithState = locked ? `${item.label} (Locked)` : item.label;
              if (locked) {
                return (
                  <Link
                    key={item.to}
                    to="/app/upgrade"
                    state={{ featureKey: item.featureKey, reason: decision.reason }}
                    onClick={() => setMobileNavOpen(false)}
                    className="sidebar-link block rounded-lg border border-dashed border-amber-400/60 px-3 py-2 text-amber-200 opacity-85 transition hover:opacity-100"
                    title={compactSidebar ? labelWithState : decision.reason ?? labelWithState}
                    aria-label={labelWithState}
                  >
                    <span className={["flex items-center", compactSidebar ? "justify-center" : "justify-between gap-2"].join(" ")}>
                      <span className="text-xs font-semibold">
                        {compactSidebar ? item.label.charAt(0) : item.label}
                      </span>
                      {!compactSidebar ? (
                        <span className="rounded-full border border-amber-500/60 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-100">
                          Locked
                        </span>
                      ) : null}
                      {compactSidebar && <span className="nav-tooltip">{labelWithState}</span>}
                    </span>
                  </Link>
                );
              }

              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={() => setMobileNavOpen(false)}
                  className={({ isActive }) =>
                    [
                      "sidebar-link block rounded-lg px-3 py-2 transition",
                      isActive ? "sidebar-link-active font-semibold" : "",
                    ].join(" ")
                  }
                  title={compactSidebar ? item.label : undefined}
                  aria-label={item.label}
                >
                  <span className={["flex items-center", compactSidebar ? "justify-center" : "gap-2"].join(" ")}>
                    <span className="text-xs font-semibold">
                      {compactSidebar ? item.label.charAt(0) : item.label}
                    </span>
                    {compactSidebar && (
                      <span className="nav-tooltip">{item.label}</span>
                    )}
                  </span>
                </NavLink>
              );
            })}
          </nav>
        </aside>

        <div className="flex flex-1 flex-col">
          <header
            className="border-b px-4 py-4 md:px-8 md:py-5"
            style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  onClick={() => setMobileNavOpen(true)}
                  className="btn-secondary text-xs md:hidden"
                  aria-label="Open sidebar"
                >
                  Menu
                </button>
                <div>
                <h2 className="text-lg font-semibold" style={{ color: "var(--text)" }}>
                  Rent Collection Management
                </h2>
                <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
                  Welcome back. Review today's collection status.
                </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="hidden text-xs sm:block" style={{ color: "var(--muted)" }}>
                  {user?.email ?? "Signed in"}
                </div>
                <button
                  onClick={signOut}
                  className="btn-secondary text-sm"
                >
                  Sign Out
                </button>
              </div>
            </div>
            {billing?.bannerTitle && billing?.bannerMessage && (
              <div
                className="mt-4 rounded-xl border px-4 py-3 text-sm"
                style={{
                  borderColor:
                    billing.bannerTone === "danger"
                      ? "rgba(244, 63, 94, 0.45)"
                      : billing.bannerTone === "warning"
                        ? "rgba(251, 191, 36, 0.45)"
                        : "rgba(56, 189, 248, 0.45)",
                  backgroundColor:
                    billing.bannerTone === "danger"
                      ? "rgba(190, 24, 93, 0.15)"
                      : billing.bannerTone === "warning"
                        ? "rgba(180, 83, 9, 0.15)"
                        : "rgba(14, 116, 144, 0.15)",
                  color: "var(--text)",
                }}
              >
                <div className="font-semibold">{billing.bannerTitle}</div>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs md:text-sm">{billing.bannerMessage}</span>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to="/app/upgrade" className="btn-secondary text-xs md:text-sm">
                      View Plans
                    </Link>
                    {permissions.canAccessSettings ? (
                      <Link to="/app/settings" className="btn-secondary text-xs md:text-sm">
                        Manage Billing
                      </Link>
                    ) : null}
                  </div>
                </div>
              </div>
            )}
          </header>

          <main
            id="main"
            className="flex-1 py-4 md:py-8"
            style={{ backgroundColor: "var(--bg)" }}
          >
            <div className="mx-auto w-full max-w-[1400px] px-4 md:px-8">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export default function AppShell() {
  const { user, permissions, signOut } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const compactSidebar = collapsed && !mobileNavOpen;

  const navItems = [
    { to: "/", label: "Dashboard", visible: true },
    { to: "/houses", label: "Houses", visible: true },
    { to: "/tenants", label: "Tenants", visible: true },
    { to: "/payments", label: "Payments", visible: true },
    { to: "/expenses", label: "Expenses", visible: true },
    { to: "/migration", label: "Migration", visible: permissions.canUseMigration },
    { to: "/reports", label: "Reports", visible: permissions.canViewReports },
    // { to: "/settings", label: "Settings", visible: permissions.canAccessSettings },
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
                      Rental Collection
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
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
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
            ))}
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
                  Rental Collection Management
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

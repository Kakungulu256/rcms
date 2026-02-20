import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export default function AppShell() {
  const { user, permissions, signOut } = useAuth();
  const [collapsed, setCollapsed] = useState(false);

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
        <aside
          className={[
            "sidebar-shell relative z-20 flex flex-col overflow-visible border-r px-4 py-6 transition-[width] duration-200",
            collapsed ? "w-[92px]" : "w-[260px]",
          ].join(" ")}
          style={{ backgroundColor: "var(--sidebar)", borderColor: "var(--sidebar-border)" }}
        >
          <button
            type="button"
            onClick={() => setCollapsed((prev) => !prev)}
            className="sidebar-toggle absolute -right-3 top-8 z-30 flex h-7 w-7 items-center justify-center rounded-full border text-sm leading-none shadow-sm"
            style={{ borderColor: "var(--sidebar-border)", color: "var(--sidebar-muted)" }}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-pressed={collapsed}
          >
            {collapsed ? ">" : "<"}
          </button>

          <div className="mb-8">
            <div className="flex items-center">
              <div
                className={[
                  "sidebar-brand rounded-xl",
                  collapsed ? "w-full px-2 py-2" : "px-4 py-3",
                ].join(" ")}
              >
                <div className={["text-xs font-semibold", collapsed ? "text-center" : ""].join(" ")} style={{ color: "var(--sidebar-brand-text)" }}>
                  {collapsed ? "RC" : "RCMS"}
                </div>
                {!collapsed && (
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
                className={({ isActive }) =>
                  [
                    "sidebar-link block rounded-lg px-3 py-2 transition",
                    isActive ? "sidebar-link-active font-semibold" : "",
                  ].join(" ")
                }
                title={collapsed ? item.label : undefined}
                aria-label={item.label}
              >
                <span className={["flex items-center", collapsed ? "justify-center" : "gap-2"].join(" ")}>
                  <span className="text-xs font-semibold">
                    {collapsed ? item.label.charAt(0) : item.label}
                  </span>
                  {collapsed && (
                    <span className="nav-tooltip">{item.label}</span>
                  )}
                </span>
              </NavLink>
            ))}
          </nav>
        </aside>

        <div className="flex flex-1 flex-col">
          <header
            className="border-b px-8 py-5"
            style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold" style={{ color: "var(--text)" }}>
                  Rental Collection Management
                </h2>
                <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
                  Welcome back. Review today's collection status.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-xs" style={{ color: "var(--muted)" }}>
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
            className="flex-1 py-8"
            style={{ backgroundColor: "var(--bg)" }}
          >
            <div className="mx-auto w-full max-w-[1400px] px-8">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

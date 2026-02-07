import React from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useNavigate } from "react-router-dom";
import { account } from "../lib/appwrite";

const navItems = [
  { to: "/", label: "Dashboard" },
  { to: "/houses", label: "Houses" },
  { to: "/tenants", label: "Tenants" },
  { to: "/payments", label: "Payments" },
  { to: "/expenses", label: "Expenses" },
  { to: "/migration", label: "Migration" },
  { to: "/reports", label: "Reports" },
  { to: "/settings", label: "Settings" },
];

export default function AppShell() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = React.useState(false);
  const [theme, setTheme] = React.useState(() => {
    return localStorage.getItem("rcms-theme") ?? "light";
  });
  const [sessionLabel, setSessionLabel] = React.useState("Checking session...");

  React.useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("rcms-theme", theme);
  }, [theme]);

  React.useEffect(() => {
    let active = true;
    account
      .get()
      .then(() => {
        if (active) setSessionLabel("Session OK");
      })
      .catch(() => {
        if (active) setSessionLabel("No session");
      });
    return () => {
      active = false;
    };
  }, []);
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
            "flex flex-col border-r px-4 py-6 transition-all duration-200",
            collapsed ? "w-20" : "w-[260px]",
          ].join(" ")}
          style={{ backgroundColor: "var(--sidebar)", borderColor: "var(--border)" }}
        >
          <div className="mb-8">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold" style={{ color: "var(--sidebar-text)" }}>
                  RCMS
                </div>
                {!collapsed && (
                  <>
                    <h1 className="mt-2 text-xl font-semibold" style={{ color: "var(--sidebar-text)" }}>
                      Rental Collection
                    </h1>
                    <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
                      Operations & reporting
                    </p>
                  </>
                )}
              </div>
              <button
                onClick={() => setCollapsed((prev) => !prev)}
                className="rounded-md border px-2 py-1 text-xs"
                style={{ borderColor: "var(--border)", color: "var(--muted)" }}
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              >
                {collapsed ? ">" : "<"}
              </button>
            </div>
          </div>

          <nav className="space-y-1 text-sm">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  [
                    "block rounded-lg px-3 py-2 transition",
                    isActive
                      ? "font-semibold"
                      : "",
                  ].join(" ")
                }
                style={({ isActive }) => ({
                  backgroundColor: isActive ? "var(--sidebar-active-bg)" : "transparent",
                  color: isActive ? "var(--sidebar-active-text)" : "var(--sidebar-text)",
                  borderLeft: isActive ? `3px solid var(--accent)` : "3px solid transparent",
                })}
                title={collapsed ? item.label : undefined}
                aria-label={item.label}
              >
                <span className="flex items-center gap-2">
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
                <div className="text-xs" style={{ color: "var(--muted)" }}>
                  {sessionLabel}
                </div>
                <button
                  className="btn-secondary text-sm"
                  onClick={() => navigate("/reports")}
                >
                  Export
                </button>
                <button
                  className="btn-primary text-sm"
                  onClick={() => navigate("/payments")}
                >
                  New Payment
                </button>
                <button
                  onClick={() =>
                    setTheme((prev) => (prev === "dark" ? "light" : "dark"))
                  }
                  className="btn-secondary text-sm"
                >
                  {theme === "dark" ? "Light" : "Dark"}
                </button>
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

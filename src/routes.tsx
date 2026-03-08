import { createBrowserRouter, Navigate } from "react-router-dom";
import AppShell from "./ui/AppShell";
import DashboardPage from "./ui/pages/DashboardPage";
import ExpensesPage from "./ui/pages/ExpensesPage";
import HousesPage from "./ui/pages/HousesPage";
import LoginPage from "./ui/pages/LoginPage";
import MigrationPage from "./ui/pages/MigrationPage";
import PaymentsPage from "./ui/pages/PaymentsPage";
import ReportsPage from "./ui/pages/ReportsPage";
import SettingsPage from "./ui/pages/SettingsPage";
import TenantsPage from "./ui/pages/TenantsPage";
import RequireAuth from "./auth/RequireAuth";
import RequireRole from "./auth/RequireRole";

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  {
    path: "/",
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      {
        path: "houses",
        element: (
          <RequireRole allow={["admin", "clerk"]}>
            <HousesPage />
          </RequireRole>
        ),
      },
      {
        path: "tenants",
        element: (
          <RequireRole allow={["admin", "clerk", "viewer"]}>
            <TenantsPage />
          </RequireRole>
        ),
      },
      {
        path: "payments",
        element: (
          <RequireRole allow={["admin", "clerk", "viewer"]}>
            <PaymentsPage />
          </RequireRole>
        ),
      },
      {
        path: "expenses",
        element: (
          <RequireRole allow={["admin", "clerk"]}>
            <ExpensesPage />
          </RequireRole>
        ),
      },
      {
        path: "migration",
        element: (
          <RequireRole allow={["admin", "clerk"]}>
            <MigrationPage />
          </RequireRole>
        ),
      },
      { path: "reports", element: <ReportsPage /> },
      {
        path: "settings",
        element: (
          <RequireRole allow={["admin"]}>
            <SettingsPage />
          </RequireRole>
        ),
      },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);

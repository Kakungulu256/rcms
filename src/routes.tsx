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
      { path: "houses", element: <HousesPage /> },
      { path: "tenants", element: <TenantsPage /> },
      { path: "payments", element: <PaymentsPage /> },
      { path: "expenses", element: <ExpensesPage /> },
      { path: "migration", element: <MigrationPage /> },
      { path: "reports", element: <ReportsPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);

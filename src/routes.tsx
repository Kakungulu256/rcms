import { createBrowserRouter, Navigate } from "react-router-dom";
import AppShell from "./ui/AppShell";
import DashboardPage from "./ui/pages/DashboardPage";
import ExpensesPage from "./ui/pages/ExpensesPage";
import HousesPage from "./ui/pages/HousesPage";
import LandingPage from "./ui/pages/LandingPage";
import LoginPage from "./ui/pages/LoginPage";
import MigrationPage from "./ui/pages/MigrationPage";
import PaymentsPage from "./ui/pages/PaymentsPage";
import ReportsPage from "./ui/pages/ReportsPage";
import ResetPasswordPage from "./ui/pages/ResetPasswordPage";
import SecurityDepositsPage from "./ui/pages/SecurityDepositsPage";
import SettingsPage from "./ui/pages/SettingsPage";
import SignupPage from "./ui/pages/SignupPage";
import TenantsPage from "./ui/pages/TenantsPage";
import UpgradePage from "./ui/pages/UpgradePage";
import RequireAuth from "./auth/RequireAuth";
import RequireBillingAccess from "./auth/RequireBillingAccess";
import RequireFeature from "./auth/RequireFeature";
import RequireRole from "./auth/RequireRole";
import RequirePlatformOwner from "./auth/RequirePlatformOwner";
import BillingLockedPage from "./ui/pages/BillingLockedPage";
import PlatformOwnerPage from "./ui/pages/PlatformOwnerPage";

export const router = createBrowserRouter([
  { path: "/", element: <LandingPage /> },
  { path: "/login", element: <LoginPage /> },
  { path: "/signup", element: <SignupPage /> },
  { path: "/reset-password", element: <ResetPasswordPage /> },
  { path: "/houses", element: <Navigate to="/app/houses" replace /> },
  { path: "/tenants", element: <Navigate to="/app/tenants" replace /> },
  { path: "/payments", element: <Navigate to="/app/payments" replace /> },
  { path: "/security-deposits", element: <Navigate to="/app/security-deposits" replace /> },
  { path: "/expenses", element: <Navigate to="/app/expenses" replace /> },
  { path: "/migration", element: <Navigate to="/app/migration" replace /> },
  { path: "/reports", element: <Navigate to="/app/reports" replace /> },
  { path: "/settings", element: <Navigate to="/app/settings" replace /> },
  {
    path: "/app",
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
          <RequireFeature featureKey="houses.manage">
            <RequireBillingAccess>
              <RequireRole allow={["admin", "clerk"]}>
                <HousesPage />
              </RequireRole>
            </RequireBillingAccess>
          </RequireFeature>
        ),
      },
      {
        path: "tenants",
        element: (
          <RequireFeature featureKey="tenants.view">
            <RequireBillingAccess>
              <RequireRole allow={["admin", "clerk", "viewer"]}>
                <TenantsPage />
              </RequireRole>
            </RequireBillingAccess>
          </RequireFeature>
        ),
      },
      {
        path: "payments",
        element: (
          <RequireFeature featureKey="payments.view">
            <RequireBillingAccess>
              <RequireRole allow={["admin", "clerk", "viewer"]}>
                <PaymentsPage />
              </RequireRole>
            </RequireBillingAccess>
          </RequireFeature>
        ),
      },
      {
        path: "expenses",
        element: (
          <RequireFeature featureKey="expenses.manage">
            <RequireBillingAccess>
              <RequireRole allow={["admin", "clerk"]}>
                <ExpensesPage />
              </RequireRole>
            </RequireBillingAccess>
          </RequireFeature>
        ),
      },
      {
        path: "migration",
        element: (
          <RequireFeature featureKey="migration.use">
            <RequireBillingAccess>
              <RequireRole allow={["admin", "clerk"]}>
                <MigrationPage />
              </RequireRole>
            </RequireBillingAccess>
          </RequireFeature>
        ),
      },
      {
        path: "reports",
        element: (
          <RequireFeature featureKey="reports.view">
            <RequireBillingAccess>
              <ReportsPage />
            </RequireBillingAccess>
          </RequireFeature>
        ),
      },
      {
        path: "security-deposits",
        element: (
          <RequireFeature featureKey="security_deposits.view">
            <RequireBillingAccess>
              <RequireRole allow={["admin", "clerk", "viewer"]}>
                <SecurityDepositsPage />
              </RequireRole>
            </RequireBillingAccess>
          </RequireFeature>
        ),
      },
      { path: "upgrade", element: <UpgradePage /> },
      { path: "billing-lock", element: <BillingLockedPage /> },
      {
        path: "settings",
        element: (
          <RequireRole allow={["admin"]}>
            <SettingsPage />
          </RequireRole>
        ),
      },
      {
        path: "platform",
        element: (
          <RequirePlatformOwner>
            <PlatformOwnerPage />
          </RequirePlatformOwner>
        ),
      },
      { path: "*", element: <Navigate to="/app" replace /> },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);

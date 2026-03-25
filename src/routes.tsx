import { createBrowserRouter, Navigate } from "react-router-dom";
import AppShell from "./ui/AppShell";
import AppIndexPage from "./ui/pages/AppIndexPage";
import ExpensesPage from "./ui/pages/ExpensesPage";
import HousesPage from "./ui/pages/HousesPage";
import AcceptInvitePage from "./ui/pages/AcceptInvitePage";
import LoginPage from "./ui/pages/LoginPage";
import MigrationPage from "./ui/pages/MigrationPage";
import PaymentsPage from "./ui/pages/PaymentsPage";
import ReportsPage from "./ui/pages/ReportsPage";
import ResetPasswordPage from "./ui/pages/ResetPasswordPage";
import SecurityDepositsPage from "./ui/pages/SecurityDepositsPage";
import SettingsPage from "./ui/pages/SettingsPage";
import SignupPage from "./ui/pages/SignupPage";
import TenantsPage from "./ui/pages/TenantsPage";
import BillingDashboardPage from "./ui/pages/BillingDashboardPage";
import RequireAuth from "./auth/RequireAuth";
import RequireBillingAccess from "./auth/RequireBillingAccess";
import RequireFeature from "./auth/RequireFeature";
import RequireRole from "./auth/RequireRole";
import RequirePlatformOwner from "./auth/RequirePlatformOwner";
import RequireWorkspace from "./auth/RequireWorkspace";
import BillingLockedPage from "./ui/pages/BillingLockedPage";
import PlatformOwnerPage from "./ui/pages/PlatformOwnerPage";

export const router = createBrowserRouter([
  { path: "/", element: <Navigate to="/login" replace /> },
  { path: "/accept-invite", element: <AcceptInvitePage /> },
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
      { index: true, element: <AppIndexPage /> },
      {
        path: "houses",
        element: (
          <RequireWorkspace>
            <RequireFeature featureKey="houses.manage">
              <RequireBillingAccess>
                <RequireRole allow={["admin", "clerk"]}>
                  <HousesPage />
                </RequireRole>
              </RequireBillingAccess>
            </RequireFeature>
          </RequireWorkspace>
        ),
      },
      {
        path: "tenants",
        element: (
          <RequireWorkspace>
            <RequireFeature featureKey="tenants.view">
              <RequireBillingAccess>
                <RequireRole allow={["admin", "clerk", "viewer"]}>
                  <TenantsPage />
                </RequireRole>
              </RequireBillingAccess>
            </RequireFeature>
          </RequireWorkspace>
        ),
      },
      {
        path: "payments",
        element: (
          <RequireWorkspace>
            <RequireFeature featureKey="payments.view">
              <RequireBillingAccess>
                <RequireRole allow={["admin", "clerk", "viewer"]}>
                  <PaymentsPage />
                </RequireRole>
              </RequireBillingAccess>
            </RequireFeature>
          </RequireWorkspace>
        ),
      },
      {
        path: "expenses",
        element: (
          <RequireWorkspace>
            <RequireFeature featureKey="expenses.manage">
              <RequireBillingAccess>
                <RequireRole allow={["admin", "clerk"]}>
                  <ExpensesPage />
                </RequireRole>
              </RequireBillingAccess>
            </RequireFeature>
          </RequireWorkspace>
        ),
      },
      {
        path: "migration",
        element: (
          <RequireWorkspace>
            <RequireFeature featureKey="migration.use">
              <RequireBillingAccess>
                <RequireRole allow={["admin", "clerk"]}>
                  <MigrationPage />
                </RequireRole>
              </RequireBillingAccess>
            </RequireFeature>
          </RequireWorkspace>
        ),
      },
      {
        path: "reports",
        element: (
          <RequireWorkspace>
            <RequireFeature featureKey="reports.view">
              <RequireBillingAccess>
                <ReportsPage />
              </RequireBillingAccess>
            </RequireFeature>
          </RequireWorkspace>
        ),
      },
      {
        path: "security-deposits",
        element: (
          <RequireWorkspace>
            <RequireFeature featureKey="security_deposits.view">
              <RequireBillingAccess>
                <RequireRole allow={["admin", "clerk", "viewer"]}>
                  <SecurityDepositsPage />
                </RequireRole>
              </RequireBillingAccess>
            </RequireFeature>
          </RequireWorkspace>
        ),
      },
      {
        path: "billing",
        element: (
          <RequireWorkspace>
            <RequireRole allow={["admin"]}>
              <BillingDashboardPage />
            </RequireRole>
          </RequireWorkspace>
        ),
      },
      {
        path: "upgrade",
        element: (
          <RequireWorkspace>
            <Navigate to="/app/billing" replace />
          </RequireWorkspace>
        ),
      },
      {
        path: "billing-lock",
        element: (
          <RequireWorkspace>
            <BillingLockedPage />
          </RequireWorkspace>
        ),
      },
      {
        path: "settings",
        element: (
          <RequireWorkspace>
            <RequireRole allow={["admin"]}>
              <SettingsPage />
            </RequireRole>
          </RequireWorkspace>
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

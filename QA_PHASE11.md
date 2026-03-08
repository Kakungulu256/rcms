# Phase 11 QA Record

Date: 2026-03-09

## Scope checked
- Proration policy for partial occupancy months (including February/leap-year behavior).
- House assignment availability rules (vacant-only assignment).
- Security deposit deduction flow (expense -> tenant ledger -> reports).
- RBAC visibility/actions for deposit and report surfaces.

## Validation summary
1. Proration policy consistency
- Formula confirmed in frontend/shared rent engine and backend functions:
  - `src/lib/rentHistory.ts`
  - `functions/allocateRentPayment/main.js`
  - `functions/computeTenantStatus/main.js`
  - `functions/migrateHistoricalData/main.js`
- Policy confirmed:
  - Inclusive day count (`start` and `end` are billable).
  - Actual-day proration (`monthlyRent * occupiedDays / daysInMonth`).
  - Currency rounding to 2 decimals.

2. Vacant-only house assignment
- Tenant form shows only vacant houses (while preserving currently assigned house during edit):
  - `src/ui/tenants/TenantForm.tsx`
- Server-side/page-side guard blocks assigning non-vacant houses:
  - `src/ui/pages/TenantsPage.tsx`

3. Deposit deduction flow
- Expense maintenance toggle and note capture:
  - `src/ui/expenses/ExpenseForm.tsx`
- Ledger sync from maintenance expense to occupying tenant:
  - `src/ui/pages/ExpensesPage.tsx`
- Tenant ledger/running balance view:
  - `src/ui/tenants/TenantDetail.tsx`
- Aggregate deposit page:
  - `src/ui/pages/SecurityDepositsPage.tsx`
- Report + export coverage:
  - `src/ui/pages/ReportsPage.tsx` (`Deposit Deductions` report type)

4. RBAC coverage for new surfaces
- Permission model:
  - `src/auth/rbac.ts`
- Route-level access:
  - `src/routes.tsx`
- Navigation visibility:
  - `src/ui/AppShell.tsx`
- Expected role behavior in current implementation:
  - Admin: full Phase 11 access.
  - Clerk: houses/tenants/payments/expenses/reports/deposits; no payment reversal or settings.
  - Viewer: tenants/payments/reports/deposits read-only; no houses/expenses/migration/settings mutations.

## Automated checks run
- `npm run build` -> passed.
- `node --check functions/allocateRentPayment/main.js` -> passed.
- `node --check functions/computeTenantStatus/main.js` -> passed.
- `node --check functions/migrateHistoricalData/main.js` -> passed.

## Manual UAT checklist (to execute in environment)
1. Proration edge cases
- Move-in late month (e.g., 28th) and verify prorated first month in tenant, dashboard, and reports.
- Move-out mid-month and verify prorated final month.
- February non-leap and leap-year cases; verify denominator days are 28/29 accordingly.

2. Vacant-only assignment
- Create tenant: ensure house selector excludes occupied/inactive houses.
- Edit tenant: ensure current house remains selectable while still preventing reassignment to other occupied houses.

3. Deposit deduction chain
- Create maintenance expense with `Affects tenant security deposit` checked and house selected.
- Verify record appears in tenant Deposit Deductions section.
- Verify record appears in Security Deposits page aggregates.
- Verify record appears in Reports -> `Deposit Deductions` (screen, PDF, XLSX).

4. RBAC behavior
- Viewer account: confirm read-only report/deposit visibility and no create/edit controls.
- Clerk account: confirm ability to record expenses/payments but not reverse payments or access settings.
- Admin account: confirm full access including settings.

## Findings
- No code-level regressions found in this QA pass.
- Final policy sign-off still requires live-data/manual UAT execution against your Appwrite environment.

# Phase 9 QA Record

Date: 2026-03-08

## Scope checked
- Inactive-arrears split calculations in dashboard and reports.
- Summary report/export totals and notes alignment.
- Payment and expense receipt edit/replace/remove behavior.
- Role-based permissions for viewer, clerk, and admin.

## Findings and fixes applied
1. Reverse payment API path was not role-restricted in backend function.
- Risk: clerk could reverse by calling function directly outside UI.
- Fix: added admin-role verification in `functions/allocateRentPayment/main.js` before reversal flow.

2. Summary report next-month and arrears-count logic could include inactive tenants.
- Risk: active obligations in summary could be overstated after move-out/inactive split.
- Fix: updated `src/ui/pages/ReportsPage.tsx`:
  - `rentExpectedNextMonth` now excludes tenants inactive by next month end.
  - `tenantsWithArrearsCount` now counts active arrears only.

## Validation run
- `npm run build` passed.
- `node --check functions/allocateRentPayment/main.js` passed.

## Notes
- This pass validates implementation logic and build integrity.
- Full role behavior still depends on Appwrite team/collection permissions being applied in the environment (`scripts/apply-permissions.mjs`).

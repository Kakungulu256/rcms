# RCMS Implementation TODO (Ordered Sequence)

Use this list in order. Complete and verify each item before moving to the next.

## Phase 1: Data and Rules Foundation

1. [ ] Add tenant onboarding type and deposit fields
- Add `tenantType` (`new` or `old`) to tenant records.
- Add deposit tracking fields (for example: `securityDepositRequired`, `securityDepositAmount`, `securityDepositPaid`, `securityDepositBalance`, `securityDepositRefunded`).
- Add/update Appwrite attributes and indexes.

2. [x] Enforce move-out and tenant status linkage
- When `moveOutDate` is entered or updated, auto-set tenant status to `inactive`.
- Ensure edit forms and backend logic keep this consistent.

3. [x] Enforce tenant-house status automation
- On tenant assignment to a house, house status becomes `occupied`.
- On tenant move-out/deactivation, house status becomes `vacant` (unless explicitly `inactive`).
- Remove conflicting manual behavior where needed.

4. [x] Stop arrears after tenant move-out/deactivation
- Update arrears calculations so future months after effective end date are excluded.
- Apply this rule consistently in tenant detail, dashboard, and reports.

## Phase 2: Payment Flow and Deposit Logic

5. [x] Update payment form for new/old tenant handling
- Show onboarding type clearly for payment recording.
- Add input/logic for deposit handling on first payment for `new` tenants only.

6. [x] Implement security deposit allocation rule
- For `new` tenant initial payment: first one-month-rent amount goes to deposit (one-time).
- Remaining amount allocates to rent months oldest-first.
- `old` tenants skip deposit path entirely.

7. [x] Store and display payment notes as status source
- Ensure payment note is captured and stored consistently.
- Prepare data model usage so report status can use recorded notes directly.

## Phase 3: Dashboard Accuracy and Formatting

8. [x] Correct Dashboard Overview calculations
- Recheck formulas for expected rent, collected rent, arrears, and expense totals with new rules.
- Ensure values are numerically correct with reversals and deposit separation.

9. [x] Remove trailing `.00` on dashboard totals
- Format dashboard totals/figures without forced decimal zeros.

## Phase 4: Report Changes

10. [x] Remove report metric cards section
- Remove the top report summary cards block shown in screenshot (`Range`, `Rent Collected`, `Total Expenses`, `Net Collection`, `Active Tenants`, `Outstanding Tenant Balances`).

11. [x] Update summary report status column to use payment notes
- Replace computed status words for this report output.
- Use clerk/admin-entered payment note text as status.

12. [x] Add dynamic Move-out Date column in tenancy summary
- Show the column only when at least one tenant in selected range has a move-out date relevant to that range.

13. [x] Standardize date and month formatting in views/reports
- Use `DD/MM/YY` for displayed dates.
- Use short month names (for example `Mar 2026`).

14. [x] Add personal note input before export
- Add optional report note field/button before PDF/XLSX export.
- Include this note in exported output.

15. [x] Include outstanding total balance in report notes footer
- Ensure bottom notes section includes total outstanding balance.

## Phase 5: Receipts and Files

16. [x] Add receipt upload for payments
- Allow image/file upload when recording payment.
- Store file in Appwrite storage and link file metadata to payment.

17. [x] Add receipt upload for expenses
- Allow image/file upload when recording expense.
- Store file in Appwrite storage and link file metadata to expense.

## Phase 6: RBAC and Admin User Management

18. [x] Tighten RBAC visibility and actions (Admin/Clerk/Viewer)
- Enforce page access, action buttons, and mutation permissions by role.
- Verify both UI-level and backend collection permissions.

19. [x] Add admin user management (create user + assign role/team)
- Admin can create users from app UI.
- User is added to Appwrite auth and assigned to proper team (`admin`, `clerk`, `viewer`).

## Phase 7: Language Simplification and Final QA

20. [x] Replace technical terms with simpler English in UI
- Simplify terms like `migration`, `snapshot`, `rent override`, and related labels/help text.

21. [x] Full regression pass
- Run build, smoke test all modules, and verify report/export behavior.
- Verify deposit, arrears, move-out/status, house automation, uploads, and RBAC end-to-end.

## Phase 8: Report and Allocation Accuracy Fixes (New)

22. [x] Ensure overpayments always carry forward correctly
- Confirm backend allocation applies extra payment to upcoming months after arrears/current dues.
- Handle edge cases (inactive/moved-out tenant, large overpayment, reversal impact).
- Keep frontend preview and backend final allocation consistent.

23. [x] Add fallback handling for legacy payments without `allocationJson`
- In report/tenant calculations, map unallocated legacy payments to their payment month (instead of counting as zero).
- Ensure this fallback is used consistently in rent-paid, balances, and status-note month matching.

24. [x] Fix landlord transfer formula by expense source
- Compute `Total cash to transfer to Landlord` as:
- `Total Rent Collected - Sum(expenses where source = rent_cash)`.
- Exclude `external` funded expenses from landlord transfer deduction.

25. [x] Align "Total Rent Collected" definitions across report sections
- Use one clear rule for summary cards/table/PDF/XLSX/export notes.
- Verify totals match row-level values and selected report range.

26. [x] Add targeted report accuracy test scenarios
- Scenario A: overpayment covering arrears + future months.
- Scenario B: mixed expense sources (`rent_cash` + `external`).
- Scenario C: legacy payment without allocation metadata.
- Scenario D: reversal in same report month.


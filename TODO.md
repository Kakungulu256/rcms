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

## Phase 9: Reporting, Receipts, and Inactive-Arrears Split (New)

27. [x] Update Summary Report `Unit No.` format
- Display as `House Name-HouseCode` in summary report rows.
- Ensure this applies consistently in on-screen report, PDF export, and XLSX export.

28. [x] Remove `USh` currency prefix from reports
- Remove `USh` text from summary report tables/notes and exported PDF.
- Keep numeric formatting readable (thousands separators, no forced trailing `.00` unless needed).

29. [x] Enable auto-wrap for long report cell text
- Ensure long status notes and long tenant notes wrap in report tables (screen + PDF).
- Prevent clipped/overflowed text in exported summary report layout.

30. [x] Allow receipt replacement when editing payments
- In payment edit flow, support replacing/removing current receipt.
- Update stored receipt metadata and clean up old file when replaced.

31. [x] Allow receipt replacement when editing expenses
- In expense edit flow, support replacing/removing current receipt.
- Update stored receipt metadata and clean up old file when replaced.

32. [x] Exclude inactive-tenant balances from active monthly obligations
- For moved-out/inactive tenants with remaining balances, exclude from:
- `Rent expected this month`
- `Unpaid rent this month`
- `Total expected next month`
- `Outstanding total balance` in summary reports
- `Outstanding Arrears` on dashboard

33. [x] Introduce `Inactive Tenant Arrears` aggregate
- Compute and show cumulative arrears for tenants who moved out/inactive with unpaid balances.
- Surface as a separate KPI/widget from active arrears.

34. [x] Add dedicated `Inactive Tenant Arrears` report
- Add report view/export that explains each tenant contribution:
- Tenant, move-in date, move-out date, total paid, balance left.
- Include cumulative total and date range context.

35. [x] Add downloadable old-records import template
- Provide template download in old records/migration area.
- Include required columns and simple guidance.

36. [x] End-to-end QA for Phase 9
- Validate calculations and exports after inactive-arrears split.
- Validate receipt edit/replacement and permissions by role.

## Phase 10: SaaS Onboarding, Billing, and Plan-Based Access (Next)

37. [ ] Introduce platform tenancy model (workspace/account per customer)
- Add a top-level `workspace` model so each signup gets isolated data.
- Scope all houses, tenants, payments, expenses, reports, and users to `workspaceId`.
- Prevent cross-workspace access by query filters + backend checks.

38. [ ] Add public landing page and marketing site flow
- New public route for product overview, pricing, FAQs, and CTA buttons.
- Keep app routes protected behind authentication.
- Add clear `Start free trial` and `Login` entry points.

39. [ ] Build self-service signup + workspace bootstrap
- On signup, create:
- Appwrite user
- Workspace record
- Default team membership as `admin` for that workspace owner.
- Set initial subscription state to `trialing` with start/end dates.

40. [ ] Add subscription domain models
- Add collections/tables for:
- `plans`
- `subscriptions`
- `subscription_events`
- `invoices`
- `payments_billing`
- `feature_entitlements` (or plan JSON entitlements)
- Track trial, active, past_due, canceled, expired states.

41. [ ] Implement billing integration + webhook processing
- Integrate payment provider (Stripe recommended; Flutterwave/Pesapal optional).
- Create checkout session for plan purchase/upgrade.
- Process provider webhooks to activate/suspend subscriptions.
- Make webhook handler idempotent and audit-logged.

42. [ ] Implement trial period and lifecycle rules
- Configure trial duration (for example 14 days).
- During trial, selected features are enabled.
- After trial expiry without payment, lock premium features and show upgrade prompts.
- Add grace period and retry/dunning behavior for failed renewals.

43. [ ] Build feature gating and entitlement enforcement layer
- Centralize checks like `canAccessFeature(user, workspace, featureKey)`.
- Gate both frontend UI and backend function actions.
- Return clear messages when a feature is locked by plan.

44. [ ] Refactor RBAC to workspace-aware memberships
- Keep roles (`admin`, `clerk`, `viewer`) but make them workspace-scoped.
- Allow an admin to invite/manage users only inside their workspace.
- Ensure role checks always include workspace context.

45. [ ] Enforce plan limits (quota controls)
- Add limits by plan (examples: max houses, max active tenants, max team members, exports/month).
- Block create actions at limit with upgrade CTA.
- Add usage counters and a usage dashboard card.

46. [ ] Add locked-state UX and upgrade/paywall screens
- Show locked badges and disabled buttons for unavailable features.
- Add upgrade modal/page with current plan, limits, and comparison table.
- Add billing status banner (trial days left, subscription expiry, past due).

47. [ ] Add billing/settings management for workspace admin
- Billing tab in Settings:
- current plan
- renewal date
- invoice history
- payment method management
- upgrade/downgrade/cancel/reactivate actions.

48. [ ] Add team invitations and acceptance flow
- Admin sends invite by email with target role.
- Invite acceptance creates membership in the correct workspace and role.
- Prevent duplicate conflicting memberships.

49. [ ] Security and audit hardening for monetized flows
- Audit-log plan changes, renewals, cancellations, and failed billing actions.
- Protect billing endpoints/functions with signature verification and strict auth.
- Add anti-abuse checks (rate limiting for signup/invites/checkout initiation).

50. [ ] Data migration strategy from current single-tenant app
- Backfill existing records with a default `workspaceId`.
- Create owner workspace/team from current admin account.
- Migrate existing users into workspace memberships.

51. [ ] QA, UAT, and release readiness for SaaS transition
- Test matrix:
- trial -> paid
- paid -> expired/past_due
- plan upgrades/downgrades
- role + plan combined permissions
- workspace data isolation.
- Add rollback plan and billing reconciliation checks.

### Suggested Subscription Plans (Initial Proposal)

P1. [ ] Trial Plan (14 days)
- Full access with light caps for evaluation.
- Example caps: 10 houses, 50 tenants, 2 team members.

P2. [ ] Starter (Small landlord)
- Suggested price: USD 19/month (or UGX equivalent).
- Limits: up to 50 houses, 300 tenants, 3 team members.
- Includes: payments, expenses, basic reports, exports.

P3. [ ] Growth (Property manager)
- Suggested price: USD 49/month.
- Limits: up to 200 houses, 1,500 tenants, 10 team members.
- Includes: all reports, receipt uploads, migration tools, advanced exports.

P4. [ ] Business (Agency scale)
- Suggested price: USD 99/month.
- Limits: up to 1,000 houses, 10,000 tenants, 30 team members.
- Includes: priority support, audit enhancements, extended retention.

P5. [ ] Enterprise (Custom)
- Custom pricing and SLAs.
- Unlimited/custom limits, dedicated onboarding, custom integrations.

## Phase 11: Core Rental Policy and Deposit Enhancements (Immediate Next)

> Priority note: Execute this phase before starting Phase 10 SaaS changes.

52. [x] Implement prorated rent for partial occupancy months
- Add policy-driven rent proration when tenant move-in/move-out is mid-month.
- Recommended default: `Actual-day prorate` (`monthlyRent * occupiedDays / daysInMonth`).
- Define rounding rules and whether move-in/move-out day is billable.
- Apply proration to first and last occupancy month in allocation, arrears, dashboard, and reports.

53. [x] Add occupied/vacant filter on Houses list
- Add house status quick filters (`All`, `Occupied`, `Vacant`, `Inactive`) on Houses page.
- Ensure counts and list update consistently with filter state.

54. [x] Restrict Tenant house assignment to vacant houses only
- In tenant create/edit form, show only `vacant` houses in House Assignment selection.
- Keep currently assigned house visible when editing an existing tenant record.
- Show clear validation/error if no vacant houses are available.

55. [x] Add Security Deposits tab/page
- Create a dedicated tab/page to list tenant security deposit records.
- Include: required deposit, paid amount, balance, refund status, and related deductions.
- Add filters and totals (e.g., total held, total deducted, total refundable).

56. [x] Add maintenance expense checkbox: "Affects security deposit"
- Under Expenses when category is `maintenance`, add a checkbox field:
- `Affects tenant security deposit`.
- Store this flag on the expense record with optional deduction note.

57. [x] Link maintenance deductions to tenant deposit ledger
- When maintenance expense is marked as affecting deposit, associate it to:
- the occupying tenant of that house at the expense date.
- Record deduction details in tenant deposit ledger:
- date, item fixed, amount, notes, expense reference.

58. [x] Add tenant-facing "Deposit Deductions" history tab
- In tenant detail, add a tab/section showing all deposit deductions tied to that tenant.
- Include clear running balance after each deduction entry.

59. [x] Add Security Deposit Deductions report
- Add report/export showing deduction history by tenant/house/date range.
- Include totals and opening/closing deposit balances per tenant.

60. [x] Add type-ahead house selector in maintenance expense form
- When category is `maintenance`, replace plain house dropdown with type-ahead/autosuggest.
- Search by house code and house name to reduce scrolling.

61. [x] QA and policy validation for Phase 11
- Test proration edge cases (end/start month dates, February, leap years).
- Test house availability rules during tenant create/edit.
- Test deposit deduction flow from expenses -> tenant ledger -> reports.
- Validate RBAC visibility/actions for new deposit tabs/reports.


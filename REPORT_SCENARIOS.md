# Report Accuracy Scenarios (Task 26)

This file defines targeted scenarios for validating report accuracy updates.

## Scope

These scenarios verify:
- Overpayment carry-forward handling.
- Expense source impact on landlord transfer.
- Legacy payments without `allocationJson`.
- Reversal impact in the same report month.

## Scenario Month

Default month seeded by script: `2026-06`  
Override with env var: `REPORT_SCENARIO_MONTH=YYYY-MM`

## Commands

Seed scenarios:

```bash
node scripts/seed-report-scenarios.mjs
```

Reset scenarios:

```bash
node scripts/reset-report-scenarios.mjs
```

## Data Created

- Houses: `SCN26-A`, `SCN26-C`, `SCN26-D`
- Tenants: `SCN26 Tenant A`, `SCN26 Tenant C`, `SCN26 Tenant D`
- Payments:
- `SCN26-A-OVERPAY` (allocation includes arrears, report month, and future months)
- `SCN26-C-LEGACY` (no `allocationJson`)
- `SCN26-D-ORIG` + `SCN26-D-REV` (same-month reversal pair)
- Expenses:
- `SCN26 Rent Cash Repair` (`source = rent_cash`, amount `40`)
- `SCN26 External Plumbing` (`source = external`, amount `60`)

## Expected Results (Scenario Contribution Only)

When viewing **Summary Report** for the seeded month:

1. Scenario A (overpayment carry-forward)
- `SCN26 Tenant A` shows rent paid for report month = `100`.
- Overpayment portions for future months do not inflate report-month rent collected.

2. Scenario B (expense source rules)
- `Total cash to transfer to Landlord` deducts only rent-cash expense `40`.
- External expense `60` should not reduce landlord transfer.

3. Scenario C (legacy payment fallback)
- `SCN26 Tenant C` payment is counted for report month even without `allocationJson`.

4. Scenario D (same-month reversal)
- Original and reversal net to `0` for report-month collected amount.

Aggregate scenario-only deltas:
- Total Rent Collected contribution: `220`
- Rent-cash disbursement contribution: `40`
- External expense contribution (non-deducted): `60`
- Total cash to transfer to Landlord contribution: `180`

## Verification Notes

- If your database has other records in the same month, report totals include both existing data and scenario deltas.
- For isolated verification, reset demo/other seeded data first, then run only the scenario seed script.

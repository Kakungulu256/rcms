# Single-Tenant to Workspace Migration

This migration handles Task 52:
- Backfill legacy records with a default `workspaceId`
- Create/reuse the owner workspace from the current admin account
- Migrate existing Appwrite users into `workspace_memberships`

## Script

Run:

```bash
npm run appwrite:migrate:workspace
```

## Required env vars

- `APPWRITE_ENDPOINT`
- `APPWRITE_PROJECT_ID`
- `APPWRITE_API_KEY`
- `APPWRITE_DATABASE_ID` (optional, default: `rcms`)

## Owner selection

Set one of:
- `RCMS_MIGRATION_OWNER_USER_ID`
- `RCMS_MIGRATION_OWNER_EMAIL`

If both are missing, the script falls back to `RCMS_ADMIN_EMAIL`.

## Optional env vars

- `RCMS_MIGRATION_WORKSPACE_ID` (default: `default`)
- `RCMS_MIGRATION_WORKSPACE_NAME` (default: `Default Workspace`)
- `RCMS_MIGRATION_DRY_RUN` (`true`/`false`, default: `false`)
- `RCMS_MIGRATION_INCLUDE_INACTIVE_USERS` (`true`/`false`, default: `true`)
- `RCMS_MIGRATION_FORCE_OWNER` (`true`/`false`, default: `false`)
- `RCMS_MIGRATION_FORCE_WORKSPACE_PREFS` (`true`/`false`, default: `true`)

Role inference helpers:
- `APPWRITE_TEAM_ADMIN_ID`
- `APPWRITE_TEAM_CLERK_ID`
- `APPWRITE_TEAM_VIEWER_ID`
- `RCMS_ADMIN_EMAIL`
- `RCMS_CLERK_EMAIL`
- `RCMS_VIEWER_EMAIL`

## Recommended run order

1. Dry run first:
```bash
RCMS_MIGRATION_DRY_RUN=true npm run appwrite:migrate:workspace
```
2. Review the summary output.
3. Run actual migration:
```bash
npm run appwrite:migrate:workspace
```

## Collections backfilled

- `houses`
- `tenants`
- `payments`
- `expenses`
- `security_deposit_deductions`
- `audit_logs`
- `workspace_memberships`
- `workspace_invitations`
- `subscriptions`
- `subscription_events`
- `invoices`
- `payments_billing`
- `coupon_redemptions`


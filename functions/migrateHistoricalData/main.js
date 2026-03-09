import { Account, Client, Databases, ID, Query } from "node-appwrite";

function getEnv(...keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (value !== undefined && String(value).trim().length > 0) {
      return String(value).trim();
    }
  }
  return null;
}

function parseJson(body) {
  if (!body) return null;
  if (typeof body === "object") return body;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function normalize(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function normalizeWorkspaceId(value) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function resolveWorkspaceId(body) {
  return (
    normalizeWorkspaceId(body?.workspaceId) ||
    normalizeWorkspaceId(getEnv("RCMS_DEFAULT_WORKSPACE_ID")) ||
    "default"
  );
}

function assertWorkspaceAccess(document, workspaceId, label) {
  const documentWorkspaceId = normalizeWorkspaceId(document?.workspaceId);
  if (documentWorkspaceId && documentWorkspaceId !== workspaceId) {
    const error = new Error(`${label} does not belong to this workspace.`);
    error.code = 403;
    throw error;
  }
}

function parseNumber(value) {
  if (typeof value === "number") return value;
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function parseDateSafe(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isBillingLocked({ workspace, subscription }) {
  const now = new Date();
  const rawState = subscription?.state || workspace?.subscriptionState || "trialing";

  if (rawState === "active") return false;
  if (rawState === "trialing") {
    const trialEnd = parseDateSafe(subscription?.trialEndDate || workspace?.trialEndDate);
    return trialEnd ? trialEnd.getTime() <= now.getTime() : false;
  }
  if (rawState === "past_due") {
    const graceEndsAt = parseDateSafe(subscription?.graceEndsAt);
    return !graceEndsAt || graceEndsAt.getTime() <= now.getTime();
  }
  if (rawState === "canceled") {
    const periodEnd = parseDateSafe(subscription?.currentPeriodEnd);
    return !periodEnd || periodEnd.getTime() <= now.getTime();
  }

  return true;
}

function parseEntitlementsJson(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.features && typeof parsed.features === "object") {
      return parsed.features;
    }
    return parsed;
  } catch {
    return null;
  }
}

function resolvePlanFeatureRule(plan, featureKey) {
  const entitlements = parseEntitlementsJson(plan?.entitlementsJson);
  if (!entitlements || typeof entitlements !== "object") {
    return null;
  }
  const raw = entitlements[featureKey];
  if (typeof raw === "boolean") {
    return { enabled: raw };
  }
  if (raw && typeof raw === "object") {
    const enabled = typeof raw.enabled === "boolean" ? raw.enabled : true;
    return { enabled };
  }
  return null;
}

async function getLatestSubscription(databases, databaseId, workspaceId) {
  const page = await databases.listDocuments(databaseId, "subscriptions", [
    Query.equal("workspaceId", [workspaceId]),
    Query.orderDesc("$updatedAt"),
    Query.limit(1),
  ]);
  return page.documents?.[0] ?? null;
}

async function getPlanByCode(databases, databaseId, planCode) {
  if (!planCode) return null;
  const page = await databases.listDocuments(databaseId, "plans", [
    Query.equal("code", [planCode]),
    Query.limit(1),
  ]);
  return page.documents?.[0] ?? null;
}

async function getFeatureEntitlement(databases, databaseId, planCode, featureKey) {
  if (!planCode) return null;
  try {
    const page = await databases.listDocuments(databaseId, "feature_entitlements", [
      Query.equal("planCode", [planCode]),
      Query.equal("featureKey", [featureKey]),
      Query.limit(1),
    ]);
    return page.documents?.[0] ?? null;
  } catch {
    return null;
  }
}

async function assertFeatureEnabled({
  databases,
  databaseId,
  workspaceId,
  featureKey,
}) {
  const workspace = await databases.getDocument(databaseId, "workspaces", workspaceId);
  const subscription = await getLatestSubscription(databases, databaseId, workspaceId);

  if (isBillingLocked({ workspace, subscription })) {
    const error = new Error(
      "Billing is inactive for this workspace. Upgrade or renew to continue."
    );
    error.code = 402;
    throw error;
  }

  const plan = await getPlanByCode(databases, databaseId, subscription?.planCode ?? null);
  const row = await getFeatureEntitlement(
    databases,
    databaseId,
    subscription?.planCode ?? null,
    featureKey
  );

  const fromPlan = resolvePlanFeatureRule(plan, featureKey);
  const enabled =
    typeof row?.enabled === "boolean"
      ? Boolean(row.enabled)
      : fromPlan?.enabled ?? true;

  if (!enabled) {
    const error = new Error(
      `Feature "${featureKey}" is locked by your current plan. Upgrade in Settings to continue.`
    );
    error.code = 402;
    throw error;
  }
}

function startOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function monthKey(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function addMonths(date, count) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + count, 1));
}

function buildMonthSeries(moveInDate, endDate, extraMonths = 0) {
  const moveIn = parseDateSafe(moveInDate);
  const end = parseDateSafe(endDate);
  if (!moveIn || !end) return [];
  const start = startOfMonth(moveIn);
  const finish = startOfMonth(end);
  const months = [];
  let cursor = start;
  while (cursor <= finish) {
    months.push(monthKey(cursor));
    cursor = addMonths(cursor, 1);
  }
  for (let index = 0; index < extraMonths; index += 1) {
    months.push(monthKey(addMonths(finish, index + 1)));
  }
  return months;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function roundProratedRent(value) {
  const normalized = Number(value) || 0;
  if (normalized <= 0) return 0;
  return Math.round(normalized / 1000) * 1000;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseDateOnlyUtc(value) {
  if (!value) return null;
  const normalized = String(value).slice(0, 10);
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseMonthStartUtc(month) {
  const parsed = new Date(`${month}-01T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function endOfMonthUtc(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

function diffDaysInclusive(start, end) {
  return Math.floor((end.getTime() - start.getTime()) / MS_PER_DAY) + 1;
}

function prorateMonthlyRent({
  baseRent,
  month,
  occupancyStartDate,
  occupancyEndDate,
}) {
  const normalizedRent = Number(baseRent) || 0;
  if (normalizedRent <= 0) return 0;

  const monthStart = parseMonthStartUtc(month);
  if (!monthStart) return roundMoney(normalizedRent);
  const monthEnd = endOfMonthUtc(monthStart);
  const occupancyStart = parseDateOnlyUtc(occupancyStartDate);
  const occupancyEnd = parseDateOnlyUtc(occupancyEndDate);

  const effectiveStart =
    occupancyStart && occupancyStart > monthStart ? occupancyStart : monthStart;
  const effectiveEnd = occupancyEnd && occupancyEnd < monthEnd ? occupancyEnd : monthEnd;
  if (effectiveEnd < effectiveStart) return 0;

  const occupiedDays = diffDaysInclusive(effectiveStart, effectiveEnd);
  const totalDaysInMonth = diffDaysInclusive(monthStart, monthEnd);
  if (occupiedDays >= totalDaysInMonth) {
    return roundMoney(normalizedRent);
  }
  return roundProratedRent((normalizedRent * occupiedDays) / totalDaysInMonth);
}

function buildPaidByMonth(payments) {
  const totals = {};
  const seenReversalTargets = new Set();
  payments.forEach((payment) => {
    if (payment.isReversal && payment.reversedPaymentId) {
      if (seenReversalTargets.has(payment.reversedPaymentId)) return;
      seenReversalTargets.add(payment.reversedPaymentId);
    }

    const multiplier = payment.isReversal ? -1 : 1;
    if (!payment.allocationJson) {
      const month = String(payment.paymentDate ?? "").slice(0, 7);
      const amount = roundMoney(Math.abs(Number(payment.amount) || 0) * multiplier);
      if (!month || !Number.isFinite(amount) || amount === 0) return;
      totals[month] = roundMoney((totals[month] ?? 0) + amount);
      return;
    }

    try {
      const allocation = JSON.parse(payment.allocationJson);
      Object.entries(allocation).forEach(([month, amount]) => {
        const value = roundMoney(Number(amount) * multiplier);
        if (!Number.isFinite(value) || value === 0) return;
        totals[month] = roundMoney((totals[month] ?? 0) + value);
      });
    } catch {
      // ignore malformed allocation payloads
    }
  });
  return totals;
}

function parseHistory(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item) =>
          item &&
          typeof item.effectiveDate === "string" &&
          typeof item.amount === "number"
      )
      .sort((a, b) => String(a.effectiveDate).localeCompare(String(b.effectiveDate)));
  } catch {
    return [];
  }
}

function entryPriority(entry) {
  return entry?.source === "house" ? 0 : 1;
}

function buildEffectiveHistory(tenantHistory, houseHistory) {
  const tenantSpecificHistory = tenantHistory.filter((entry) => entry?.source !== "house");
  const baseHistory =
    tenantSpecificHistory.length > 0
      ? [...houseHistory, ...tenantSpecificHistory]
      : houseHistory.length > 0
        ? houseHistory
        : tenantHistory;

  return baseHistory.sort((a, b) => {
    const dateOrder = String(a.effectiveDate).localeCompare(String(b.effectiveDate));
    if (dateOrder !== 0) return dateOrder;
    return entryPriority(a) - entryPriority(b);
  });
}

function buildRentByMonth({
  months,
  tenantHistoryJson,
  houseHistoryJson,
  fallbackRent,
  occupancyStartDate = null,
  occupancyEndDate = null,
}) {
  const tenantHistory = parseHistory(tenantHistoryJson);
  const houseHistory = parseHistory(houseHistoryJson);
  const history = buildEffectiveHistory(tenantHistory, houseHistory);
  const rentByMonth = {};
  months.forEach((month) => {
    const monthStart = `${month}-01`;
    const entry = history.filter((item) => item.effectiveDate <= monthStart).at(-1);
    const baseRent = entry?.amount ?? fallbackRent;
    rentByMonth[month] = prorateMonthlyRent({
      baseRent,
      month,
      occupancyStartDate,
      occupancyEndDate,
    });
  });
  return rentByMonth;
}

function appendRentHistory(existing, entry) {
  const history = parseHistory(existing);
  const filtered = history.filter((item) => item.effectiveDate !== entry.effectiveDate);
  filtered.push(entry);
  filtered.sort((a, b) => String(a.effectiveDate).localeCompare(String(b.effectiveDate)));
  return JSON.stringify(filtered);
}

function previewAllocation({ amount, months, paidByMonth, rentByMonth }) {
  let remainingPayment = roundMoney(amount);
  const lines = months.map((month) => {
    const paid = paidByMonth[month] ?? 0;
    const rent = rentByMonth[month] ?? 0;
    const remaining = roundMoney(Math.max(rent - paid, 0));
    const applied = roundMoney(Math.min(remaining, remainingPayment));
    remainingPayment = roundMoney(remainingPayment - applied);
    return {
      month,
      applied,
    };
  });

  return {
    lines,
  };
}

function buildTenantKey(tenant) {
  const houseId =
    typeof tenant.house === "string" ? tenant.house : tenant.house?.$id ?? "";
  return `${String(tenant.fullName ?? "").toLowerCase()}|${houseId}`;
}

function normalizeMethod(value) {
  const method = normalize(value).toLowerCase();
  if (method === "cash" || method === "bank") return method;
  return "cash";
}

function normalizeStatus(value, fallback) {
  const normalized = normalize(value).toLowerCase();
  return normalized || fallback;
}

function parseBooleanLike(value) {
  const normalized = normalize(value).toLowerCase();
  return ["true", "yes", "y", "1"].includes(normalized);
}

function resolveTenantHouseId(tenant) {
  if (!tenant) return "";
  if (typeof tenant.house === "string") return tenant.house;
  return tenant.house?.$id ?? "";
}

function getTenantUpdatedAt(tenant) {
  return parseDateSafe(tenant?.$updatedAt);
}

function getTenantEffectiveEndDate(tenant, referenceDate) {
  const moveOut = parseDateSafe(tenant?.moveOutDate);
  const deactivatedAt =
    tenant?.status === "inactive" && !moveOut ? getTenantUpdatedAt(tenant) : null;
  const candidates = [referenceDate, moveOut, deactivatedAt].filter(Boolean);
  if (candidates.length === 0) return referenceDate;
  return candidates.reduce((earliest, current) =>
    current.getTime() < earliest.getTime() ? current : earliest
  );
}

function findOccupyingTenantForHouse(tenants, houseId, expenseDate) {
  const expenseDateValue = parseDateSafe(expenseDate);
  if (!expenseDateValue) return null;
  return (
    tenants.find((tenant) => {
      const tenantHouseId = resolveTenantHouseId(tenant);
      if (tenantHouseId !== houseId) return false;
      const moveInDate = parseDateSafe(tenant?.moveInDate);
      if (!moveInDate || moveInDate.getTime() > expenseDateValue.getTime()) return false;
      const effectiveEndDate = getTenantEffectiveEndDate(tenant, expenseDateValue);
      return effectiveEndDate.getTime() >= expenseDateValue.getTime();
    }) ?? null
  );
}

async function listAllDocuments(
  databases,
  databaseId,
  collectionId,
  baseQueries = [],
  workspaceId = null
) {
  const fetchWithQueries = async (queriesWithoutLimit) => {
    const documents = [];
    let cursor = null;
    while (true) {
      const queries = [...queriesWithoutLimit, Query.limit(100)];
      if (cursor) queries.push(Query.cursorAfter(cursor));
      const page = await databases.listDocuments(databaseId, collectionId, queries);
      documents.push(...page.documents);
      if (page.documents.length < 100) break;
      cursor = page.documents[page.documents.length - 1].$id;
    }
    return documents;
  };

  const scopedQueries = workspaceId
    ? [Query.equal("workspaceId", [workspaceId]), ...baseQueries]
    : [...baseQueries];
  const scopedDocuments = await fetchWithQueries(scopedQueries);
  if (scopedDocuments.length > 0 || !workspaceId) {
    return scopedDocuments;
  }

  // Transitional fallback for legacy records missing workspaceId.
  const legacyDocuments = await fetchWithQueries(baseQueries);
  return legacyDocuments.filter((document) => {
    const documentWorkspaceId = normalizeWorkspaceId(document?.workspaceId);
    return !documentWorkspaceId || documentWorkspaceId === workspaceId;
  });
}

function isMigrationDataShape(data) {
  return (
    data &&
    typeof data === "object" &&
    Array.isArray(data.houses) &&
    Array.isArray(data.tenants) &&
    Array.isArray(data.payments) &&
    Array.isArray(data.expenses)
  );
}

async function ensureCallerCanMigrate({
  endpoint,
  projectId,
  jwt,
  databases,
  databaseId,
  workspaceId,
}) {
  if (!jwt) {
    throw Object.assign(new Error("Missing caller JWT."), { code: 401 });
  }
  const callerClient = new Client().setEndpoint(endpoint).setProject(projectId).setJWT(jwt);
  const account = new Account(callerClient);
  const caller = await account.get();
  const callerWorkspaceId = normalizeWorkspaceId(caller?.prefs?.workspaceId);
  if (callerWorkspaceId && callerWorkspaceId !== workspaceId) {
    throw Object.assign(new Error("Caller is not allowed to use another workspace."), {
      code: 403,
    });
  }

  const workspace = await databases.getDocument(databaseId, "workspaces", workspaceId);
  if (workspace?.ownerUserId === caller.$id) {
    return;
  }

  const membershipPage = await databases.listDocuments(databaseId, "workspace_memberships", [
    Query.equal("workspaceId", [workspaceId]),
    Query.equal("userId", [caller.$id]),
    Query.equal("status", ["active"]),
    Query.limit(1),
  ]);
  const membership = membershipPage.documents?.[0] ?? null;
  const role = String(membership?.role ?? "").trim().toLowerCase();
  if (role !== "admin" && role !== "clerk") {
    throw Object.assign(new Error("Only admin or clerk can run old-record import."), {
      code: 403,
    });
  }
}

export default async (context) => {
  const { req, res, log, error: logError } = context;
  const body = parseJson(req.body);
  if (!body) {
    return res.json({ ok: false, error: "Invalid JSON body." }, 400);
  }

  const endpoint = getEnv(
    "RCMS_APPWRITE_ENDPOINT",
    "APPWRITE_ENDPOINT",
    "APPWRITE_FUNCTION_API_ENDPOINT"
  );
  const projectId = getEnv(
    "RCMS_APPWRITE_PROJECT_ID",
    "APPWRITE_PROJECT_ID",
    "APPWRITE_FUNCTION_PROJECT_ID"
  );
  const apiKey = getEnv(
    "RCMS_APPWRITE_API_KEY",
    "APPWRITE_API_KEY",
    "APPWRITE_FUNCTION_API_KEY"
  );
  const databaseId = getEnv("RCMS_APPWRITE_DATABASE_ID", "APPWRITE_DATABASE_ID") || "rcms";

  if (!endpoint || !projectId || !apiKey) {
    return res.json(
      {
        ok: false,
        error:
          "Missing function credentials. Set RCMS_APPWRITE_ENDPOINT, RCMS_APPWRITE_PROJECT_ID, RCMS_APPWRITE_API_KEY.",
      },
      500
    );
  }

  const jwt = normalize(body.jwt);
  const workspaceId = resolveWorkspaceId(body);
  const data = body.data;
  if (!isMigrationDataShape(data)) {
    return res.json(
      {
        ok: false,
        error: "Invalid data payload. Expected houses, tenants, payments, expenses arrays.",
      },
      400
    );
  }

  try {
    const adminClient = new Client()
      .setEndpoint(endpoint)
      .setProject(projectId)
      .setKey(apiKey);
    const databases = new Databases(adminClient);

    await ensureCallerCanMigrate({
      endpoint,
      projectId,
      jwt,
      databases,
      databaseId,
      workspaceId,
    });

    await assertFeatureEnabled({
      databases,
      databaseId,
      workspaceId,
      featureKey: "migration.use",
    });

    const warnings = [];
    const counters = {
      housesCreated: 0,
      tenantsCreated: 0,
      paymentsCreated: 0,
      expensesCreated: 0,
      depositDeductionsUpserted: 0,
      housesUpdated: 0,
    };

    const existingHouses = await listAllDocuments(
      databases,
      databaseId,
      "houses",
      [Query.orderAsc("code")],
      workspaceId
    );
    const houseByCode = new Map(existingHouses.map((house) => [house.code, house]));
    const houseById = new Map(existingHouses.map((house) => [house.$id, house]));

    for (const row of data.houses) {
      const code = normalize(row.HouseCode);
      if (!code) {
        warnings.push("HouseCode is required for Houses.");
        continue;
      }
      if (houseByCode.has(code)) continue;
      const monthlyRent = parseNumber(row.MonthlyRent);
      const effectiveDate = normalize(row.RentEffectiveDate) || new Date().toISOString().slice(0, 10);
      const created = await databases.createDocument(databaseId, "houses", ID.unique(), {
        workspaceId,
        code,
        name: normalize(row.HouseName) || null,
        monthlyRent,
        status: normalizeStatus(row.Status, "vacant"),
        notes: normalize(row.Notes) || null,
        rentHistoryJson: appendRentHistory(null, {
          effectiveDate,
          amount: monthlyRent,
          source: "house",
        }),
      });
      houseByCode.set(code, created);
      houseById.set(created.$id, created);
      counters.housesCreated += 1;
    }

    const existingTenants = await listAllDocuments(
      databases,
      databaseId,
      "tenants",
      [Query.orderAsc("fullName")],
      workspaceId
    );
    const tenantByKey = new Map(existingTenants.map((tenant) => [buildTenantKey(tenant), tenant]));

    for (const row of data.tenants) {
      const fullName = normalize(row.FullName);
      const houseCode = normalize(row.HouseCode);
      if (!fullName || !houseCode) {
        warnings.push("FullName and HouseCode are required for Tenants.");
        continue;
      }
      const house = houseByCode.get(houseCode);
      if (!house) {
        warnings.push(`HouseCode not found for tenant ${fullName}.`);
        continue;
      }
      const key = `${fullName.toLowerCase()}|${house.$id}`;
      if (tenantByKey.has(key)) continue;

      const moveOutDate = normalize(row.MoveOutDate) || null;
      const status = moveOutDate ? "inactive" : normalizeStatus(row.Status, "active");
      const created = await databases.createDocument(databaseId, "tenants", ID.unique(), {
        workspaceId,
        fullName,
        phone: normalize(row.Phone) || null,
        house: house.$id,
        moveInDate: normalize(row.MoveInDate),
        moveOutDate,
        status,
        tenantType: normalize(row.TenantType).toLowerCase() === "new" ? "new" : "old",
        securityDepositRequired: false,
        securityDepositAmount: 0,
        securityDepositPaid: 0,
        securityDepositBalance: 0,
        securityDepositRefunded: false,
        rentOverride: parseNumber(row.RentOverride) || null,
        notes: normalize(row.Notes) || null,
      });
      tenantByKey.set(key, created);
      counters.tenantsCreated += 1;
    }

    for (const [houseCode, house] of houseByCode.entries()) {
      const tenantsForHouse = await listAllDocuments(
        databases,
        databaseId,
        "tenants",
        [Query.equal("house", [house.$id]), Query.orderAsc("fullName")],
        workspaceId
      );
      const occupant =
        tenantsForHouse.find((tenant) => tenant.status === "active" && !tenant.moveOutDate) ??
        null;
      const nextStatus = occupant ? "occupied" : house.status === "inactive" ? "inactive" : "vacant";
      const nextCurrentTenantId = occupant?.$id ?? null;
      if (
        house.status === nextStatus &&
        (house.currentTenantId ?? null) === nextCurrentTenantId
      ) {
        continue;
      }
      const updatedHouse = await databases.updateDocument(databaseId, "houses", house.$id, {
        status: nextStatus,
        currentTenantId: nextCurrentTenantId,
      });
      houseByCode.set(houseCode, updatedHouse);
      houseById.set(updatedHouse.$id, updatedHouse);
      counters.housesUpdated += 1;
    }

    const tenantById = new Map();
    const tenantByName = new Map();
    tenantByKey.forEach((tenant) => {
      tenantById.set(tenant.$id, tenant);
      tenantByName.set(String(tenant.fullName ?? "").toLowerCase(), tenant);
    });

    const paymentsByTenant = new Map();
    for (const tenant of tenantByKey.values()) {
      const existingPayments = await listAllDocuments(
        databases,
        databaseId,
        "payments",
        [Query.equal("tenant", [tenant.$id]), Query.orderAsc("paymentDate")],
        workspaceId
      );
      paymentsByTenant.set(tenant.$id, existingPayments);
    }

    const sortedPayments = [...data.payments].sort((a, b) =>
      normalize(a.PaymentDate).localeCompare(normalize(b.PaymentDate))
    );

    for (const row of sortedPayments) {
      const tenantId = normalize(row.TenantId);
      const tenantName = normalize(row.TenantFullName).toLowerCase();
      const tenant = tenantId ? tenantById.get(tenantId) : tenantByName.get(tenantName);
      if (!tenant) {
        warnings.push(`Tenant not found for payment: ${normalize(row.TenantFullName) || "Unknown"}`);
        continue;
      }

      const houseId =
        typeof tenant.house === "string" ? tenant.house : tenant.house?.$id ?? "";
      const houseFromRow = houseByCode.get(normalize(row.HouseCode));
      const house = houseFromRow ?? houseById.get(houseId);
      const rent = tenant.rentOverride ?? house?.monthlyRent ?? 0;

      const existingPayments = paymentsByTenant.get(tenant.$id) ?? [];
      const paidByMonth = buildPaidByMonth(existingPayments);
      const paymentDate = normalize(row.PaymentDate);
      const months = buildMonthSeries(tenant.moveInDate, paymentDate, 24);
      const rentByMonth = buildRentByMonth({
        months,
        tenantHistoryJson: tenant.rentHistoryJson ?? null,
        houseHistoryJson: house?.rentHistoryJson ?? null,
        fallbackRent: rent,
        occupancyStartDate: tenant.moveInDate,
        occupancyEndDate: tenant.moveOutDate ?? null,
      });
      const allocation = previewAllocation({
        amount: parseNumber(row.Amount),
        months,
        paidByMonth,
        rentByMonth,
      });
      const allocationJson = JSON.stringify(
        Object.fromEntries(
          allocation.lines
            .filter((line) => line.applied > 0)
            .map((line) => [line.month, line.applied])
        )
      );

      const created = await databases.createDocument(databaseId, "payments", ID.unique(), {
        workspaceId,
        tenant: tenant.$id,
        amount: parseNumber(row.Amount),
        method: normalizeMethod(row.Method),
        paymentDate,
        reference: normalize(row.Reference) || null,
        notes: normalize(row.Notes) || null,
        allocationJson,
      });
      paymentsByTenant.set(tenant.$id, [created, ...existingPayments]);
      counters.paymentsCreated += 1;
    }

    for (const row of data.expenses) {
      const category = normalize(row.Category).toLowerCase();
      if (!category) {
        warnings.push("Category is required for Expenses.");
        continue;
      }
      const houseId =
        category === "maintenance"
          ? houseByCode.get(normalize(row.HouseCode))?.$id ?? null
          : null;
      if (category === "maintenance" && !houseId) {
        warnings.push("HouseCode is required for maintenance expenses.");
        continue;
      }
      const affectsSecurityDeposit =
        category === "maintenance" && parseBooleanLike(row.AffectsSecurityDeposit);
      const createdExpense = await databases.createDocument(databaseId, "expenses", ID.unique(), {
        workspaceId,
        category,
        description: normalize(row.Description),
        amount: parseNumber(row.Amount),
        source: normalizeStatus(row.Source, "rent_cash"),
        expenseDate: normalize(row.ExpenseDate),
        house: houseId,
        maintenanceType: normalize(row.MaintenanceType) || null,
        affectsSecurityDeposit,
        securityDepositDeductionNote: affectsSecurityDeposit
          ? normalize(row.SecurityDepositDeductionNote) || null
          : null,
        notes: normalize(row.Notes) || null,
      });
      if (affectsSecurityDeposit && houseId) {
        const occupyingTenant = findOccupyingTenantForHouse(
          Array.from(tenantByKey.values()),
          houseId,
          normalize(row.ExpenseDate)
        );
        if (!occupyingTenant) {
          warnings.push(
            `No occupying tenant found for security deposit deduction: ${normalize(
              row.Description
            ) || "Maintenance"} (${normalize(row.ExpenseDate)})`
          );
        } else {
          await databases.createDocument(
            databaseId,
            "security_deposit_deductions",
            ID.unique(),
            {
              workspaceId,
              tenantId: occupyingTenant.$id,
              expenseId: createdExpense.$id,
              houseId,
              deductionDate: normalize(row.ExpenseDate),
              itemFixed: normalize(row.Description) || normalize(row.MaintenanceType) || "Maintenance",
              amount: parseNumber(row.Amount),
              deductionNote:
                normalize(row.SecurityDepositDeductionNote) ||
                normalize(row.Notes) ||
                null,
              expenseReference: createdExpense.$id,
            }
          );
          counters.depositDeductionsUpserted += 1;
        }
      }
      counters.expensesCreated += 1;
    }

    return res.json({
      ok: true,
      warnings,
      counters,
      message:
        warnings.length === 0
          ? "Upload complete."
          : "Upload completed with warnings.",
    });
  } catch (error) {
    const status = Number(error?.code) || 500;
    const message =
      error?.response?.message ?? error?.message ?? "Upload failed.";
    logError?.(`migrateHistoricalData failed: ${message}`);
    log?.(error?.stack ?? "No stack");
    return res.json({ ok: false, error: message }, status);
  }
};

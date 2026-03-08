import { Account, Client, Databases, ID, Query, Teams } from "node-appwrite";

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

function parseBoolean(value) {
  if (typeof value === "boolean") return value;
  if (!value) return false;
  return ["true", "yes", "1"].includes(String(value).toLowerCase());
}

function parseBooleanDefaultTrue(value) {
  if (value === undefined || value === null || value === "") return true;
  return parseBoolean(value);
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

function buildRentByMonth({ months, tenantHistoryJson, houseHistoryJson, fallbackRent }) {
  const tenantHistory = parseHistory(tenantHistoryJson);
  const houseHistory = parseHistory(houseHistoryJson);
  const history = buildEffectiveHistory(tenantHistory, houseHistory);
  const rentByMonth = {};
  months.forEach((month) => {
    const monthStart = `${month}-01`;
    const entry = history.filter((item) => item.effectiveDate <= monthStart).at(-1);
    rentByMonth[month] = entry?.amount ?? fallbackRent;
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

async function listAllDocuments(databases, databaseId, collectionId, baseQueries = []) {
  const documents = [];
  let cursor = null;
  while (true) {
    const queries = [...baseQueries, Query.limit(100)];
    if (cursor) queries.push(Query.cursorAfter(cursor));
    const page = await databases.listDocuments(databaseId, collectionId, queries);
    documents.push(...page.documents);
    if (page.documents.length < 100) break;
    cursor = page.documents[page.documents.length - 1].$id;
  }
  return documents;
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
  adminTeamId,
  clerkTeamId,
}) {
  if (!jwt) {
    throw Object.assign(new Error("Missing caller JWT."), { code: 401 });
  }
  const callerClient = new Client().setEndpoint(endpoint).setProject(projectId).setJWT(jwt);
  const account = new Account(callerClient);
  const teams = new Teams(callerClient);
  await account.get();
  const teamList = await teams.list();
  const hasAllowedTeam = (teamList.teams ?? []).some((team) => {
    const name = String(team.name ?? "").trim().toLowerCase();
    const byName = name === "admin" || name === "clerk";
    const byId =
      (adminTeamId && team.$id === adminTeamId) ||
      (clerkTeamId && team.$id === clerkTeamId);
    return Boolean(byName || byId);
  });
  if (!hasAllowedTeam) {
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
  const adminTeamId = getEnv("RCMS_APPWRITE_TEAM_ADMIN_ID", "APPWRITE_TEAM_ADMIN_ID");
  const clerkTeamId = getEnv("RCMS_APPWRITE_TEAM_CLERK_ID", "APPWRITE_TEAM_CLERK_ID");

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
    await ensureCallerCanMigrate({
      endpoint,
      projectId,
      jwt,
      adminTeamId,
      clerkTeamId,
    });

    const adminClient = new Client()
      .setEndpoint(endpoint)
      .setProject(projectId)
      .setKey(apiKey);
    const databases = new Databases(adminClient);
    const warnings = [];
    const counters = {
      housesCreated: 0,
      tenantsCreated: 0,
      paymentsCreated: 0,
      expensesCreated: 0,
      housesUpdated: 0,
    };

    const existingHouses = await listAllDocuments(databases, databaseId, "houses", [
      Query.orderAsc("code"),
    ]);
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
        isMigrated: true,
      });
      houseByCode.set(code, created);
      houseById.set(created.$id, created);
      counters.housesCreated += 1;
    }

    const existingTenants = await listAllDocuments(databases, databaseId, "tenants", [
      Query.orderAsc("fullName"),
    ]);
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
        isMigrated: parseBooleanDefaultTrue(row.IsMigrated),
      });
      tenantByKey.set(key, created);
      counters.tenantsCreated += 1;
    }

    for (const [houseCode, house] of houseByCode.entries()) {
      const tenantsForHouse = await listAllDocuments(databases, databaseId, "tenants", [
        Query.equal("house", [house.$id]),
        Query.orderAsc("fullName"),
      ]);
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
      const existingPayments = await listAllDocuments(databases, databaseId, "payments", [
        Query.equal("tenant", [tenant.$id]),
        Query.orderAsc("paymentDate"),
      ]);
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
        tenant: tenant.$id,
        amount: parseNumber(row.Amount),
        method: normalizeMethod(row.Method),
        paymentDate,
        reference: normalize(row.Reference) || null,
        notes: normalize(row.Notes) || null,
        allocationJson,
        isMigrated: parseBooleanDefaultTrue(row.IsMigrated),
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
      await databases.createDocument(databaseId, "expenses", ID.unique(), {
        category,
        description: normalize(row.Description),
        amount: parseNumber(row.Amount),
        source: normalizeStatus(row.Source, "rent_cash"),
        expenseDate: normalize(row.ExpenseDate),
        house: houseId,
        maintenanceType: normalize(row.MaintenanceType) || null,
        notes: normalize(row.Notes) || null,
        isMigrated: parseBooleanDefaultTrue(row.IsMigrated),
      });
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

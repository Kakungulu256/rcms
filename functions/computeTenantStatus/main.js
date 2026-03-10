import { Client, Databases, Query } from "node-appwrite";

function getEnv(name, fallback) {
  return process.env[name] ?? fallback;
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

function parseJson(body) {
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function monthKey(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
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
const FIXED_PRORATION_DAYS = 30;

function normalizeProrationMode(value) {
  return value === "fixed_30" ? "fixed_30" : "actual_days";
}

function parseDateSafe(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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

function isSameMonthUtc(left, right) {
  return (
    left.getUTCFullYear() === right.getUTCFullYear() &&
    left.getUTCMonth() === right.getUTCMonth()
  );
}

function prorateMonthlyRent({
  baseRent,
  month,
  occupancyStartDate,
  occupancyEndDate,
  prorationMode,
}) {
  const normalizedRent = Number(baseRent) || 0;
  if (normalizedRent <= 0) return 0;

  const monthStart = parseMonthStartUtc(month);
  if (!monthStart) return roundMoney(normalizedRent);
  const monthEnd = endOfMonthUtc(monthStart);
  const occupancyStart = parseDateOnlyUtc(occupancyStartDate);
  const occupancyEnd = parseDateOnlyUtc(occupancyEndDate);

  if (!occupancyStart) return roundMoney(normalizedRent);

  const isMoveInMonth = isSameMonthUtc(occupancyStart, monthStart);
  if (!isMoveInMonth) {
    return roundMoney(normalizedRent);
  }

  if (occupancyEnd && isSameMonthUtc(occupancyEnd, monthStart)) {
    return roundMoney(normalizedRent);
  }

  const effectiveStart =
    occupancyStart && occupancyStart > monthStart ? occupancyStart : monthStart;
  const effectiveEnd = monthEnd;
  if (effectiveEnd < effectiveStart) return 0;

  const occupiedDays = diffDaysInclusive(effectiveStart, effectiveEnd);
  const totalDaysInMonth = diffDaysInclusive(monthStart, monthEnd);
  const mode = normalizeProrationMode(prorationMode);
  const denominator = mode === "fixed_30" ? FIXED_PRORATION_DAYS : totalDaysInMonth;
  if (occupiedDays >= denominator) {
    return roundMoney(normalizedRent);
  }
  return roundProratedRent((normalizedRent * occupiedDays) / denominator);
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
      // ignore malformed allocations
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
      .filter((item) => item && item.effectiveDate && typeof item.amount === "number")
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

function resolveRentForMonth(
  month,
  tenantHistoryJson,
  houseHistoryJson,
  fallbackRent,
  occupancyStartDate = null,
  occupancyEndDate = null,
  prorationMode = "actual_days"
) {
  const tenantHistory = parseHistory(tenantHistoryJson);
  const houseHistory = parseHistory(houseHistoryJson);
  const history = buildEffectiveHistory(tenantHistory, houseHistory);
  const monthStart = `${month}-01`;
  const entry = history.filter((item) => item.effectiveDate <= monthStart).at(-1);
  const baseRent = entry?.amount ?? fallbackRent;
  return prorateMonthlyRent({
    baseRent,
    month,
    occupancyStartDate,
    occupancyEndDate,
    prorationMode,
  });
}

async function listAllTenantPayments(databases, databaseId, tenantId, workspaceId) {
  const listWithQueries = async (baseQueries) => {
    const documents = [];
    let cursor = null;
    const pageSize = 100;

    while (true) {
      const queries = [...baseQueries, Query.limit(pageSize)];
      if (cursor) {
        queries.push(Query.cursorAfter(cursor));
      }
      const page = await databases.listDocuments(databaseId, "payments", queries);
      documents.push(...page.documents);
      if (page.documents.length < pageSize) break;
      cursor = page.documents[page.documents.length - 1].$id;
    }

    return documents;
  };

  const scoped = await listWithQueries([
    Query.equal("tenant", [tenantId]),
    Query.equal("workspaceId", [workspaceId]),
    Query.orderAsc("paymentDate"),
  ]);
  if (scoped.length > 0) {
    return scoped;
  }

  // Transitional fallback for legacy records missing workspaceId.
  const legacy = await listWithQueries([
    Query.equal("tenant", [tenantId]),
    Query.orderAsc("paymentDate"),
  ]);
  return legacy.filter((payment) => {
    const paymentWorkspaceId = normalizeWorkspaceId(payment?.workspaceId);
    return !paymentWorkspaceId || paymentWorkspaceId === workspaceId;
  });
}

export default async (context) => {
  const { req, res, log, error: logError } = context;
  const body = parseJson(req.body);
  if (!body || !body.tenantId) {
    log?.("Missing tenantId in request.");
    return res.json({ ok: false, error: "tenantId is required." }, 400);
  }
  const workspaceId = resolveWorkspaceId(body);

  const endpoint =
    getEnv("RCMS_APPWRITE_ENDPOINT") ||
    getEnv("APPWRITE_ENDPOINT") ||
    getEnv("APPWRITE_FUNCTION_API_ENDPOINT");
  const projectId =
    getEnv("RCMS_APPWRITE_PROJECT_ID") ||
    getEnv("APPWRITE_PROJECT_ID") ||
    getEnv("APPWRITE_FUNCTION_PROJECT_ID");
  const apiKey =
    getEnv("RCMS_APPWRITE_API_KEY") ||
    getEnv("APPWRITE_API_KEY") ||
    getEnv("APPWRITE_FUNCTION_API_KEY");
  const databaseId = getEnv("RCMS_APPWRITE_DATABASE_ID") || "rcms";

  if (!endpoint || !projectId || !apiKey) {
    log?.("Missing Appwrite credentials in function env.");
    return res.json(
      {
        ok: false,
        error:
          "Missing Appwrite credentials. Set RCMS_APPWRITE_ENDPOINT, RCMS_APPWRITE_PROJECT_ID, RCMS_APPWRITE_API_KEY.",
      },
      500
    );
  }

  const client = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
  const databases = new Databases(client);

  try {
    const tenant = await databases.getDocument(databaseId, "tenants", body.tenantId);
    assertWorkspaceAccess(tenant, workspaceId, "Tenant");
    const workspace = await databases.getDocument(databaseId, "workspaces", workspaceId);
    const houseId =
      typeof tenant.house === "string" ? tenant.house : tenant.house?.$id ?? null;
    const house = houseId
      ? await databases.getDocument(databaseId, "houses", houseId)
      : null;
    if (house) {
      assertWorkspaceAccess(house, workspaceId, "House");
    }
    const rent = tenant.rentOverride ?? house?.monthlyRent ?? 0;

    const paymentList = await listAllTenantPayments(
      databases,
      databaseId,
      body.tenantId,
      workspaceId
    );
    const paidByMonth = buildPaidByMonth(paymentList);
    const currentMonth = monthKey(new Date());
    const today = new Date();
    const effectiveEndDate = getTenantEffectiveEndDate(tenant, today);
    const occupancyEndDate = tenant.moveOutDate
      ? String(tenant.moveOutDate).slice(0, 10)
      : tenant.status === "inactive"
        ? effectiveEndDate.toISOString().slice(0, 10)
        : null;
    const rentForMonth = resolveRentForMonth(
      currentMonth,
      tenant.rentHistoryJson ?? null,
      house?.rentHistoryJson ?? null,
      rent,
      tenant.moveInDate,
      occupancyEndDate,
      normalizeProrationMode(workspace?.prorationMode)
    );
    const paidThisMonth = paidByMonth[currentMonth] ?? 0;

    let status = "red";
    if (paidThisMonth >= rentForMonth && rentForMonth > 0) {
      status = "green";
    } else if (paidThisMonth > 0) {
      status = "orange";
    }

    return res.json({
      ok: true,
      tenantId: body.tenantId,
      currentMonth,
      paidThisMonth,
      rent: rentForMonth,
      status,
    });
  } catch (error) {
    logError?.(`Status computation failed: ${error?.message ?? "Unknown error"}`);
    return res.json({ ok: false, error: "Failed to compute tenant status." }, 500);
  }
};

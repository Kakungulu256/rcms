import { Client, Databases, ID, Query, Teams } from "node-appwrite";

const REQUIRED_FIELDS = ["tenantId", "amount", "method", "paymentDate"];

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

async function callerHasAdminRole({ endpoint, projectId, jwt, adminTeamId }) {
  if (!jwt) return true;
  const callerClient = new Client().setEndpoint(endpoint).setProject(projectId).setJWT(jwt);
  const teams = new Teams(callerClient);
  const teamList = await teams.list();
  return (teamList.teams ?? []).some((team) => {
    const byId = adminTeamId && team.$id === adminTeamId;
    const byName = String(team.name ?? "").trim().toLowerCase() === "admin";
    return Boolean(byId || byName);
  });
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

function monthKey(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function startOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addMonths(date, count) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + count, 1));
}

function buildMonthSeries(moveInDate, endDate, extraMonths = 0) {
  const start = startOfMonth(new Date(moveInDate));
  const end = startOfMonth(new Date(endDate));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return [];
  }
  const months = [];
  let cursor = start;
  while (cursor <= end) {
    months.push(monthKey(cursor));
    cursor = addMonths(cursor, 1);
  }
  for (let i = 0; i < extraMonths; i += 1) {
    months.push(monthKey(addMonths(end, i + 1)));
  }
  return months;
}

function parseDateSafe(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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
  return roundMoney((normalizedRent * occupiedDays) / totalDaysInMonth);
}

function getTenantUpdatedAt(tenant) {
  return parseDateSafe(tenant?.$updatedAt);
}

function getTenantEffectiveEndDate(tenant, paymentDateValue) {
  const moveOut = parseDateSafe(tenant?.moveOutDate);
  const deactivatedAt =
    tenant?.status === "inactive" && !moveOut ? getTenantUpdatedAt(tenant) : null;
  const candidates = [paymentDateValue, moveOut, deactivatedAt].filter(Boolean);
  if (candidates.length === 0) return paymentDateValue;
  return candidates.reduce((earliest, current) =>
    current.getTime() < earliest.getTime() ? current : earliest
  );
}

function getCarryForwardMonths({ tenant, paymentDateValue, allocatableAmount, rent }) {
  const moveOut = parseDateSafe(tenant?.moveOutDate);
  const movedOutBeforePaymentMonth =
    Boolean(moveOut) &&
    startOfMonth(moveOut).getTime() < startOfMonth(paymentDateValue).getTime();
  const canCarryForward =
    tenant?.status === "active" && !movedOutBeforePaymentMonth;
  if (!canCarryForward || rent <= 0 || allocatableAmount <= 0) {
    return 0;
  }
  return Math.max(24, Math.ceil(allocatableAmount / rent) + 12);
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

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function normalizeNote(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeOptionalString(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeOptionalNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getReversedOriginalIds(payments) {
  const reversed = new Set();
  payments.forEach((payment) => {
    if (payment.isReversal && payment.reversedPaymentId) {
      reversed.add(payment.reversedPaymentId);
    }
  });
  return reversed;
}

function getActiveRentPayments(payments) {
  const reversedOriginalIds = getReversedOriginalIds(payments);
  return payments.filter(
    (payment) => !payment.isReversal && !reversedOriginalIds.has(payment.$id)
  );
}

function resolveDepositState(tenant, rent) {
  const tenantType = tenant.tenantType === "new" ? "new" : "old";
  const securityDepositRequired =
    tenantType === "new" && (tenant.securityDepositRequired ?? true);
  const baseAmount = roundMoney(Math.max(Number(tenant.securityDepositAmount) || 0, 0));
  const monthlyRent = roundMoney(Math.max(Number(rent) || 0, 0));
  const securityDepositAmount =
    securityDepositRequired && baseAmount <= 0 ? monthlyRent : baseAmount;
  const securityDepositPaid = roundMoney(
    Math.max(Number(tenant.securityDepositPaid) || 0, 0)
  );
  const securityDepositBalance = roundMoney(
    Math.max(securityDepositAmount - securityDepositPaid, 0)
  );
  return {
    tenantType,
    securityDepositRequired,
    securityDepositAmount,
    securityDepositPaid,
    securityDepositBalance,
  };
}

function allocateReversal({ amount, paidByMonth }) {
  let remaining = roundMoney(Math.max(Number(amount) || 0, 0));
  const allocation = {};
  const months = Object.entries(paidByMonth)
    .filter(([, paid]) => Number(paid) > 0)
    .map(([month]) => month)
    .sort((a, b) => b.localeCompare(a));

  months.forEach((month) => {
    if (remaining <= 0) return;
    const paid = roundMoney(Math.max(Number(paidByMonth[month] ?? 0), 0));
    if (paid <= 0) return;
    const applied = roundMoney(Math.min(paid, remaining));
    if (applied <= 0) return;
    allocation[month] = applied;
    remaining = roundMoney(remaining - applied);
  });

  return { allocation, remaining };
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

function buildRentByMonth(
  months,
  tenantHistoryJson,
  houseHistoryJson,
  fallbackRent,
  occupancyStartDate = null,
  occupancyEndDate = null
) {
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

function allocatePayment({ amount, months, paidByMonth, rentByMonth }) {
  let remaining = roundMoney(Math.max(Number(amount) || 0, 0));
  const allocation = {};
  months.forEach((month) => {
    if (remaining <= 0) return;
    const paid = paidByMonth[month] ?? 0;
    const rent = rentByMonth[month] ?? 0;
    const due = roundMoney(Math.max(rent - paid, 0));
    if (due <= 0) return;
    const applied = roundMoney(Math.min(due, remaining));
    if (applied <= 0) return;
    allocation[month] = applied;
    remaining = roundMoney(remaining - applied);
  });
  return { allocation, remaining };
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
  if (!body) {
    log?.("Invalid JSON body.");
    return res.json({ ok: false, error: "Invalid JSON body." }, 400);
  }

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
  const adminTeamId =
    getEnv("RCMS_APPWRITE_TEAM_ADMIN_ID") || getEnv("APPWRITE_TEAM_ADMIN_ID");

  if (!endpoint || !projectId) {
    log?.("Missing Appwrite endpoint or project in function env.");
    return res.json(
      {
        ok: false,
        error:
          "Missing Appwrite credentials. Set RCMS_APPWRITE_ENDPOINT and RCMS_APPWRITE_PROJECT_ID.",
      },
      500
    );
  }
  log?.(
    `Env presence: endpoint=${Boolean(endpoint)} project=${Boolean(projectId)} apiKey=${Boolean(apiKey)} db=${Boolean(databaseId)}`
  );
  log?.(`Endpoint: ${endpoint}`);
  log?.(`Project: ${projectId}`);
  log?.(`Database: ${databaseId}`);

  const {
    jwt,
    workspaceId: payloadWorkspaceId,
    tenantId,
    amount,
    method,
    paymentDate,
    reference,
    notes,
    receiptFileId,
    receiptBucketId,
    receiptFileName,
    receiptFileMimeType,
    receiptFileSize,
    reversePaymentId,
  } = body;
  const workspaceId = resolveWorkspaceId({ workspaceId: payloadWorkspaceId });
  const normalizedNotes = normalizeNote(notes);
  const normalizedReceiptFileId = normalizeOptionalString(receiptFileId);
  const normalizedReceiptBucketId = normalizeOptionalString(receiptBucketId);
  const normalizedReceiptFileName = normalizeOptionalString(receiptFileName);
  const normalizedReceiptFileMimeType = normalizeOptionalString(receiptFileMimeType);
  const normalizedReceiptFileSize = normalizeOptionalNumber(receiptFileSize);

  const client = new Client().setEndpoint(endpoint).setProject(projectId);
  if (jwt) {
    client.setJWT(jwt);
    log?.("Using caller JWT credentials.");
  } else if (apiKey) {
    client.setKey(apiKey);
    log?.("Using function API key credentials.");
  } else {
    return res.json(
      {
        ok: false,
        error: "Missing credentials. Provide JWT or RCMS_APPWRITE_API_KEY.",
      },
      500
    );
  }
  const databases = new Databases(client);

  if (reversePaymentId) {
    try {
      const isAdmin = await callerHasAdminRole({
        endpoint,
        projectId,
        jwt,
        adminTeamId,
      });
      if (!isAdmin) {
        return res.json(
          { ok: false, error: "Only admins can reverse payments." },
          403
        );
      }
      log?.(`Reversing payment ${reversePaymentId}`);
      log?.("Fetching original payment...");
      const original = await databases.getDocument(databaseId, "payments", reversePaymentId);
      assertWorkspaceAccess(original, workspaceId, "Payment");
      if (original.isReversal) {
        return res.json({ ok: false, error: "Reversal entries cannot be reversed." }, 400);
      }
      const existingReversals = await databases.listDocuments(databaseId, "payments", [
        Query.equal("reversedPaymentId", [original.$id]),
        Query.equal("workspaceId", [workspaceId]),
        Query.limit(1),
      ]);
      if (existingReversals.total > 0) {
        return res.json(
          { ok: false, error: "This payment has already been reversed." },
          409
        );
      }
      const originalTenantId =
        typeof original.tenant === "string" ? original.tenant : original.tenant?.$id;
      if (!originalTenantId) {
        return res.json({ ok: false, error: "Original payment has no tenant." }, 400);
      }
      const tenant = await databases.getDocument(databaseId, "tenants", originalTenantId);
      assertWorkspaceAccess(tenant, workspaceId, "Tenant");
      const tenantPayments = await listAllTenantPayments(
        databases,
        databaseId,
        originalTenantId,
        workspaceId
      );
      const paidByMonth = buildPaidByMonth(tenantPayments);
      const originalDepositApplied = roundMoney(
        Math.max(Number(original.securityDepositApplied) || 0, 0)
      );
      const reversalAmount = roundMoney(
        Math.max(Math.abs(Number(original.amount) || 0) - originalDepositApplied, 0)
      );
      const { allocation, remaining } = allocateReversal({
        amount: reversalAmount,
        paidByMonth,
      });
      const appliedTotal = roundMoney(
        Object.values(allocation).reduce((sum, value) => sum + Number(value || 0), 0)
      );
      const currentDepositPaid = roundMoney(
        Math.max(Number(tenant.securityDepositPaid) || 0, 0)
      );
      const depositToReverse = roundMoney(
        Math.min(originalDepositApplied, currentDepositPaid)
      );
      if (appliedTotal <= 0 && depositToReverse <= 0) {
        return res.json(
          {
            ok: false,
            error: "No paid month balance or deposit amount is available to reverse.",
          },
          400
        );
      }
      if (remaining > 0) {
        log?.(
          `Reversal allocation exhausted paid balances before full amount. remaining=${remaining}`
        );
      }
      const totalReversalAmount = roundMoney(appliedTotal + depositToReverse);
      const recordedBy = req.headers["x-appwrite-user-id"] ?? null;
      log?.("Creating reversal document...");
      const reversal = await databases.createDocument(databaseId, "payments", ID.unique(), {
        workspaceId,
        tenant: originalTenantId,
        amount: -totalReversalAmount,
        securityDepositApplied: depositToReverse > 0 ? -depositToReverse : 0,
        method: original.method,
        paymentDate: paymentDate ?? original.paymentDate,
        reference,
        notes: normalizedNotes ?? "Reversal",
        isReversal: true,
        reversedPaymentId: original.$id,
        allocationJson: JSON.stringify(allocation),
        recordedBy,
      });
      if (depositToReverse > 0) {
        const currentDepositAmount = roundMoney(
          Math.max(Number(tenant.securityDepositAmount) || 0, 0)
        );
        const nextDepositPaid = roundMoney(Math.max(currentDepositPaid - depositToReverse, 0));
        const nextDepositBalance = roundMoney(
          Math.max(currentDepositAmount - nextDepositPaid, 0)
        );
        await databases.updateDocument(databaseId, "tenants", originalTenantId, {
          securityDepositPaid: nextDepositPaid,
          securityDepositBalance: nextDepositBalance,
          securityDepositRefunded: false,
        });
      }
      log?.("Reversal created.");
      return res.json({ ok: true, reversal });
    } catch (error) {
      const reason =
        error?.response?.message ?? error?.message ?? "Failed to reverse payment.";
      logError?.(`Failed to reverse payment: ${error?.message ?? "Unknown error"}`);
      if (error?.response) {
        logError?.(`Response: ${JSON.stringify(error.response)}`);
      }
      if (error?.code) {
        logError?.(`Code: ${error.code}`);
      }
      return res.json({ ok: false, error: reason }, error?.code ?? 500);
    }
  }

  const missing = REQUIRED_FIELDS.filter((key) => body[key] === undefined);
  if (missing.length > 0) {
    log?.(`Missing fields: ${missing.join(", ")}`);
    return res.json({ ok: false, error: `Missing fields: ${missing.join(", ")}` }, 400);
  }
  if (!normalizedNotes) {
    return res.json({ ok: false, error: "Payment status note is required." }, 400);
  }

  try {
    log?.(`Allocating payment for tenant ${tenantId}`);
    const paymentDateValue = parseDateSafe(paymentDate);
    if (!paymentDateValue) {
      return res.json({ ok: false, error: "Invalid payment date." }, 400);
    }
    const tenant = await databases.getDocument(databaseId, "tenants", tenantId);
    assertWorkspaceAccess(tenant, workspaceId, "Tenant");
    const houseId =
      typeof tenant.house === "string" ? tenant.house : tenant.house?.$id ?? null;
    const house = houseId
      ? await databases.getDocument(databaseId, "houses", houseId)
      : null;
    if (house) {
      assertWorkspaceAccess(house, workspaceId, "House");
    }
    const rent = roundMoney(tenant.rentOverride ?? house?.monthlyRent ?? 0);
    const amountValue = roundMoney(Math.max(Number(amount) || 0, 0));
    if (amountValue <= 0) {
      return res.json({ ok: false, error: "Amount must be greater than zero." }, 400);
    }

    const paymentList = await listAllTenantPayments(
      databases,
      databaseId,
      tenantId,
      workspaceId
    );
    const activeRentPayments = getActiveRentPayments(paymentList);
    const isInitialActivePayment = activeRentPayments.length === 0;
    const depositState = resolveDepositState(tenant, rent);
    const depositEligible =
      depositState.securityDepositRequired &&
      depositState.securityDepositBalance > 0 &&
      isInitialActivePayment;
    const securityDepositApplied = depositEligible
      ? roundMoney(Math.min(amountValue, depositState.securityDepositBalance))
      : 0;
    const allocatableAmount = roundMoney(amountValue - securityDepositApplied);
    const paidByMonth = buildPaidByMonth(paymentList);
    const effectiveEndDate = getTenantEffectiveEndDate(tenant, paymentDateValue);
    const extraMonths = getCarryForwardMonths({
      tenant,
      paymentDateValue,
      allocatableAmount,
      rent,
    });
    const months = buildMonthSeries(tenant.moveInDate, effectiveEndDate, extraMonths);
    if (months.length === 0) {
      return res.json(
        { ok: false, error: "No payable months found for this tenant and date." },
        400
      );
    }
    const occupancyEndDate = tenant.moveOutDate
      ? String(tenant.moveOutDate).slice(0, 10)
      : tenant.status === "inactive"
        ? effectiveEndDate.toISOString().slice(0, 10)
        : null;
    const rentByMonth = buildRentByMonth(
      months,
      tenant.rentHistoryJson ?? null,
      house?.rentHistoryJson ?? null,
      rent,
      tenant.moveInDate,
      occupancyEndDate
    );
    const { allocation, remaining } = allocatePayment({
      amount: allocatableAmount,
      months,
      paidByMonth,
      rentByMonth,
    });
    if (remaining > 0.01) {
      log?.(
        `Payment retained unallocated balance: ${remaining}. Tenant may be inactive or monthly rent is zero.`
      );
    }

    const allocationJson = JSON.stringify(allocation);
    const recordedBy = req.headers["x-appwrite-user-id"] ?? null;

    const payment = await databases.createDocument(
      databaseId,
      "payments",
      ID.unique(),
      {
        workspaceId,
        tenant: tenantId,
        amount: amountValue,
        securityDepositApplied,
        method,
        paymentDate,
        reference,
        notes: normalizedNotes,
        allocationJson,
        receiptFileId: normalizedReceiptFileId,
        receiptBucketId: normalizedReceiptBucketId,
        receiptFileName: normalizedReceiptFileName,
        receiptFileMimeType: normalizedReceiptFileMimeType,
        receiptFileSize: normalizedReceiptFileSize,
        recordedBy,
      }
    );

    if (securityDepositApplied > 0) {
      const nextDepositPaid = roundMoney(
        Math.min(
          depositState.securityDepositPaid + securityDepositApplied,
          depositState.securityDepositAmount
        )
      );
      const nextDepositBalance = roundMoney(
        Math.max(depositState.securityDepositAmount - nextDepositPaid, 0)
      );
      await databases.updateDocument(databaseId, "tenants", tenantId, {
        securityDepositRequired: true,
        securityDepositAmount: depositState.securityDepositAmount,
        securityDepositPaid: nextDepositPaid,
        securityDepositBalance: nextDepositBalance,
        securityDepositRefunded: false,
      });
    }

    return res.json({
      ok: true,
      payment,
      allocation,
      remaining,
      securityDepositApplied,
    });
  } catch (error) {
    const reason =
      error?.response?.message ?? error?.message ?? "Failed to allocate payment.";
    logError?.(`Allocation failed: ${error?.message ?? "Unknown error"}`);
    return res.json({ ok: false, error: reason }, error?.code ?? 500);
  }
};

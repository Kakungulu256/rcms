import { createHash, timingSafeEqual } from "node:crypto";
import { Client, Databases, ID, Query } from "node-appwrite";

const COLLECTIONS = {
  workspaces: "workspaces",
  subscriptions: "subscriptions",
  subscriptionEvents: "subscription_events",
  invoices: "invoices",
  billingPayments: "payments_billing",
  coupons: "coupons",
  couponRedemptions: "coupon_redemptions",
  auditLogs: "audit_logs",
};

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

function normalizeString(value) {
  if (value === undefined || value === null) return null;
  const next = String(value).trim();
  return next.length > 0 ? next : null;
}

function normalizeWorkspaceId(value) {
  return normalizeString(value);
}

function normalizeCouponCode(value) {
  return normalizeString(value)?.toUpperCase() ?? null;
}

function safeJsonString(value, maxLength = 20000) {
  const json = JSON.stringify(value ?? null);
  if (json.length <= maxLength) return json;
  return json.slice(0, maxLength);
}

function clampNumber(value, min, max) {
  const next = Number(value);
  if (!Number.isFinite(next)) return min;
  if (next < min) return min;
  if (next > max) return max;
  return next;
}

function addDaysIso(base, days) {
  return new Date(base.getTime() + Math.max(0, days) * 24 * 60 * 60 * 1000).toISOString();
}

function addHoursIso(base, hours) {
  return new Date(base.getTime() + Math.max(0, hours) * 60 * 60 * 1000).toISOString();
}

function getHeader(headers, name) {
  const target = String(name).toLowerCase();
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (String(key).toLowerCase() !== target) continue;
    if (Array.isArray(value)) return String(value[0] ?? "");
    return String(value ?? "");
  }
  return "";
}

function signaturesMatch(received, expected) {
  const receivedValue = String(received ?? "");
  const expectedValue = String(expected ?? "");
  if (!receivedValue || !expectedValue) return false;
  const left = Buffer.from(receivedValue);
  const right = Buffer.from(expectedValue);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function parseTxRef(txRef) {
  const normalized = normalizeString(txRef);
  if (!normalized) return {};
  const parts = normalized.split(":");
  if (parts.length < 5 || parts[0] !== "rcms") return {};
  return {
    workspaceId: normalizeWorkspaceId(parts[1]),
    subscriptionId: normalizeString(parts[2]),
    invoiceId: normalizeString(parts[3]),
    paymentId: normalizeString(parts[4]),
  };
}

function deriveWebhookStatus(eventName, statusValue) {
  const event = String(eventName ?? "").toLowerCase();
  const status = String(statusValue ?? "").toLowerCase();

  if (status.includes("refund") || event.includes("refund")) return "refunded";
  if (status === "cancelled" || status === "canceled" || event.includes("cancel")) return "canceled";
  if (status === "successful" || status === "success" || status === "completed") return "succeeded";
  if (status === "failed" || status === "error" || event.includes("failed")) return "failed";
  return "pending";
}

function mapEventType(status) {
  if (status === "succeeded") return "payment_succeeded";
  if (status === "failed") return "payment_failed";
  if (status === "canceled") return "payment_canceled";
  if (status === "refunded") return "payment_refunded";
  return "payment_webhook_received";
}

function mapSubscriptionState(status) {
  if (status === "succeeded") return "active";
  if (status === "failed") return "past_due";
  if (status === "canceled") return "canceled";
  if (status === "refunded") return "past_due";
  return null;
}

function resolveDunningPolicy() {
  return {
    graceDays: clampNumber(getEnv("RCMS_BILLING_GRACE_DAYS"), 1, 30),
    maxRetries: clampNumber(getEnv("RCMS_BILLING_MAX_RETRIES"), 1, 10),
    retryIntervalHours: clampNumber(getEnv("RCMS_BILLING_RETRY_INTERVAL_HOURS"), 1, 168),
  };
}

function parseDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function didPeriodAdvance(previousPeriodEnd, nextPeriodEnd) {
  const previous = parseDate(previousPeriodEnd);
  const next = parseDate(nextPeriodEnd);
  if (!previous || !next) return false;
  return next.getTime() > previous.getTime();
}

function deriveLifecycleUpdate(params) {
  const { subscription, normalizedStatus, now, billingPeriodDays, dunningPolicy } = params;
  const nowIso = now.toISOString();
  const currentState = normalizeString(subscription.state) || "trialing";

  if (normalizedStatus === "succeeded") {
    return {
      state: "active",
      currentPeriodStart: nowIso,
      currentPeriodEnd: addDaysIso(now, billingPeriodDays),
      pastDueSince: null,
      graceEndsAt: null,
      retryCount: 0,
      nextRetryAt: null,
      lastRetryAt: nowIso,
      dunningStage: null,
      lastFailureReason: null,
      canceledAt: null,
      endedAt: null,
      cancelAtPeriodEnd: false,
    };
  }

  if (normalizedStatus === "canceled") {
    return {
      state: "canceled",
      currentPeriodStart: subscription.currentPeriodStart || null,
      currentPeriodEnd: subscription.currentPeriodEnd || null,
      pastDueSince: subscription.pastDueSince || nowIso,
      graceEndsAt: subscription.graceEndsAt || addDaysIso(now, dunningPolicy.graceDays),
      retryCount: Number(subscription.retryCount ?? 0),
      nextRetryAt: null,
      lastRetryAt: nowIso,
      dunningStage: "canceled",
      lastFailureReason: normalizeString(subscription.lastFailureReason) || "Subscription canceled.",
      canceledAt: nowIso,
      endedAt: nowIso,
      cancelAtPeriodEnd: true,
    };
  }

  if (normalizedStatus === "failed" || normalizedStatus === "refunded") {
    const previousRetryCount = Number(subscription.retryCount ?? 0);
    const nextRetryCount = previousRetryCount + 1;
    const pastDueSince = parseDate(subscription.pastDueSince) || now;
    const graceEndsAt =
      parseDate(subscription.graceEndsAt) ||
      parseDate(addDaysIso(pastDueSince, dunningPolicy.graceDays));
    const isGraceExpired = Boolean(graceEndsAt && now.getTime() > graceEndsAt.getTime());
    const exceedsRetryCap = nextRetryCount > dunningPolicy.maxRetries;
    const willExpire = isGraceExpired || exceedsRetryCap;
    const nextState = willExpire ? "expired" : "past_due";

    return {
      state: nextState,
      currentPeriodStart: subscription.currentPeriodStart || null,
      currentPeriodEnd: subscription.currentPeriodEnd || null,
      pastDueSince: pastDueSince.toISOString(),
      graceEndsAt: graceEndsAt ? graceEndsAt.toISOString() : null,
      retryCount: nextRetryCount,
      nextRetryAt: willExpire ? null : addHoursIso(now, dunningPolicy.retryIntervalHours),
      lastRetryAt: nowIso,
      dunningStage: willExpire ? "final_notice" : `retry_${nextRetryCount}`,
      lastFailureReason:
        normalizeString(subscription.lastFailureReason) ||
        "Last payment attempt failed. Retry scheduled.",
      canceledAt: subscription.canceledAt || null,
      endedAt: willExpire ? nowIso : subscription.endedAt || null,
      cancelAtPeriodEnd: Boolean(subscription.cancelAtPeriodEnd),
    };
  }

  return {
    state: mapSubscriptionState(normalizedStatus) || currentState,
    currentPeriodStart: subscription.currentPeriodStart || null,
    currentPeriodEnd: subscription.currentPeriodEnd || null,
    pastDueSince: subscription.pastDueSince || null,
    graceEndsAt: subscription.graceEndsAt || null,
    retryCount: Number(subscription.retryCount ?? 0),
    nextRetryAt: subscription.nextRetryAt || null,
    lastRetryAt: subscription.lastRetryAt || null,
    dunningStage: subscription.dunningStage || null,
    lastFailureReason: subscription.lastFailureReason || null,
    canceledAt: subscription.canceledAt || null,
    endedAt: subscription.endedAt || null,
    cancelAtPeriodEnd: Boolean(subscription.cancelAtPeriodEnd),
  };
}

function resolveBillingProvider() {
  return (
    normalizeString(
      getEnv(
        "RCMS_BILLING_PROVIDER",
        "RCMS_PAYMENT_GATEWAY_PROVIDER",
        "RCMS_BILLING_GATEWAY_PROVIDER"
      )
    )?.toLowerCase() ?? "flutterwave"
  );
}

function buildGatewayAdapter(provider) {
  if (provider !== "flutterwave") {
    throw Object.assign(new Error(`Unsupported billing provider: ${provider}`), {
      code: 400,
    });
  }

  const expectedSignature =
    getEnv("RCMS_FLUTTERWAVE_WEBHOOK_SECRET_HASH", "RCMS_BILLING_WEBHOOK_SECRET") || "";

  return {
    provider: "flutterwave",
    verifySignature(headers) {
      if (!expectedSignature) {
        throw Object.assign(
          new Error("Missing webhook secret. Set RCMS_FLUTTERWAVE_WEBHOOK_SECRET_HASH."),
          { code: 500 }
        );
      }
      const signature =
        getHeader(headers, "verif-hash") ||
        getHeader(headers, "flutterwave-signature") ||
        getHeader(headers, "x-flutterwave-signature");
      return signaturesMatch(signature, expectedSignature);
    },
    normalizeWebhook(payload, rawBody) {
      const event = normalizeString(payload?.event) || "unknown";
      const data = payload?.data && typeof payload.data === "object" ? payload.data : {};
      const providerReference =
        normalizeString(data.tx_ref) ||
        normalizeString(data.txRef) ||
        normalizeString(data.flw_ref);
      const providerPaymentId = normalizeString(data.id);
      const status = deriveWebhookStatus(event, data.status ?? payload?.status);
      const eventType = mapEventType(status);
      const amount = Number(data.amount ?? payload?.amount ?? 0);
      const currency = normalizeString(data.currency ?? payload?.currency);
      const meta = data.meta && typeof data.meta === "object" ? data.meta : {};
      const hash = createHash("sha256").update(String(rawBody ?? "")).digest("hex").slice(0, 40);
      const idempotencyKey =
        normalizeString(meta.idempotencyKey) ||
        normalizeString(payload?.id) ||
        [this.provider, eventType, providerPaymentId || providerReference || hash].join(":");

      return {
        event,
        status,
        eventType,
        providerReference,
        providerPaymentId,
        amount: Number.isFinite(amount) ? amount : 0,
        currency,
        occurredAt:
          normalizeString(data.created_at) ||
          normalizeString(data.createdAt) ||
          new Date().toISOString(),
        meta,
        raw: payload,
        idempotencyKey,
      };
    },
  };
}

async function findOne(databases, databaseId, collectionId, queries) {
  const result = await databases.listDocuments(databaseId, collectionId, [
    ...queries,
    Query.limit(1),
  ]);
  return result.documents?.[0] ?? null;
}

async function writeAuditLog(databases, databaseId, payload) {
  await databases.createDocument(databaseId, COLLECTIONS.auditLogs, ID.unique(), {
    workspaceId: payload.workspaceId,
    entityType: payload.entityType,
    entityId: payload.entityId,
    action: payload.action,
    actorId: payload.actorId,
    timestamp: new Date().toISOString(),
    detailsJson: safeJsonString(payload.details ?? null),
  });
}

async function writeSubscriptionEvent(databases, databaseId, payload) {
  await databases.createDocument(databaseId, COLLECTIONS.subscriptionEvents, ID.unique(), {
    workspaceId: payload.workspaceId,
    subscriptionId: payload.subscriptionId,
    eventType: payload.eventType,
    eventSource: payload.eventSource,
    eventTime: payload.eventTime || new Date().toISOString(),
    stateFrom: payload.stateFrom || null,
    stateTo: payload.stateTo || null,
    idempotencyKey: payload.idempotencyKey || null,
    payloadJson: safeJsonString(payload.payload ?? null),
    actorUserId: payload.actorUserId || null,
    reference: payload.reference || null,
  });
}

async function updateCouponUsageOnSuccess({
  databases,
  databaseId,
  workspaceId,
  couponCode,
  subscriptionId,
  invoiceId,
  discountPercent,
  discountAmount,
}) {
  const normalizedCouponCode = normalizeCouponCode(couponCode);
  if (!normalizedCouponCode) return null;

  const coupon = await findOne(databases, databaseId, COLLECTIONS.coupons, [
    Query.equal("code", [normalizedCouponCode]),
  ]);
  if (!coupon) return null;

  const currentCount = Number(coupon.redemptionCount ?? 0);
  const nextCount = Number.isFinite(currentCount) ? currentCount + 1 : 1;
  await databases.updateDocument(databaseId, COLLECTIONS.coupons, coupon.$id, {
    redemptionCount: nextCount,
  });

  return databases.createDocument(databaseId, COLLECTIONS.couponRedemptions, ID.unique(), {
    workspaceId,
    couponCode: normalizedCouponCode,
    subscriptionId: subscriptionId || null,
    invoiceId: invoiceId || null,
    redeemedAt: new Date().toISOString(),
    discountPercent: clampNumber(discountPercent, 0, 100),
    discountAmount: Number.isFinite(Number(discountAmount)) ? Number(discountAmount) : null,
    status: "applied",
    redemptionReference: invoiceId || subscriptionId || null,
  });
}

export default async (context) => {
  const { req, res, error: logError } = context;
  const requestMethod = String(req?.method ?? "POST").toUpperCase();
  if (requestMethod !== "POST") {
    return res.json({ ok: false, error: "Method not allowed." }, 405);
  }
  const payload = parseJson(req.body);
  if (!payload) {
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
      { ok: false, error: "Missing Appwrite credentials in function env vars." },
      500
    );
  }

  const auditContext = {
    workspaceId: null,
    subscriptionId: null,
    idempotencyKey: null,
    status: null,
    actorId: "billing_webhook",
  };

  try {
    const provider = resolveBillingProvider();
    const adapter = buildGatewayAdapter(provider);
    const validSignature = adapter.verifySignature(req.headers ?? {});
    if (!validSignature) {
      return res.json({ ok: false, error: "Invalid webhook signature." }, 401);
    }

    const normalized = adapter.normalizeWebhook(payload, req.body);
    auditContext.idempotencyKey = normalized.idempotencyKey || null;
    auditContext.status = normalized.status || null;
    const parsedTx = parseTxRef(normalized.providerReference);
    let workspaceId = normalizeWorkspaceId(normalized.meta?.workspaceId) || parsedTx.workspaceId || null;
    let subscriptionId = normalizeString(normalized.meta?.subscriptionId) || parsedTx.subscriptionId || null;
    let invoiceId = normalizeString(normalized.meta?.invoiceId) || parsedTx.invoiceId || null;
    let paymentId = normalizeString(normalized.meta?.paymentId) || parsedTx.paymentId || null;

    const adminClient = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
    const databases = new Databases(adminClient);

    let billingPayment = null;
    if (paymentId) {
      try {
        billingPayment = await databases.getDocument(
          databaseId,
          COLLECTIONS.billingPayments,
          paymentId
        );
      } catch {
        billingPayment = null;
      }
    }
    if (!billingPayment && normalized.providerReference) {
      billingPayment = await findOne(databases, databaseId, COLLECTIONS.billingPayments, [
        Query.equal("providerReference", [normalized.providerReference]),
      ]);
    }

    if (billingPayment) {
      workspaceId = workspaceId || normalizeWorkspaceId(billingPayment.workspaceId);
      subscriptionId = subscriptionId || normalizeString(billingPayment.subscriptionId);
      invoiceId = invoiceId || normalizeString(billingPayment.invoiceId);
      paymentId = paymentId || billingPayment.$id;
    }
    auditContext.workspaceId = workspaceId || null;
    auditContext.subscriptionId = subscriptionId || null;

    if (!workspaceId) {
      return res.json(
        {
          ok: false,
          error: "Unable to resolve workspace for webhook payload.",
        },
        202
      );
    }

    if (!subscriptionId) {
      const workspaceSubscription = await findOne(
        databases,
        databaseId,
        COLLECTIONS.subscriptions,
        [Query.equal("workspaceId", [workspaceId]), Query.orderDesc("$updatedAt")]
      );
      subscriptionId = workspaceSubscription?.$id ?? null;
    }

    if (!subscriptionId) {
      return res.json(
        {
          ok: false,
          error: "Unable to resolve subscription for webhook payload.",
        },
        202
      );
    }

    const duplicateEvent = await findOne(databases, databaseId, COLLECTIONS.subscriptionEvents, [
      Query.equal("workspaceId", [workspaceId]),
      Query.equal("idempotencyKey", [normalized.idempotencyKey]),
    ]);
    if (duplicateEvent) {
      return res.json({
        ok: true,
        duplicate: true,
        eventId: duplicateEvent.$id,
      });
    }

    if (billingPayment) {
      await databases.updateDocument(
        databaseId,
        COLLECTIONS.billingPayments,
        billingPayment.$id,
        {
          status: normalized.status,
          providerReference: normalized.providerReference || billingPayment.providerReference || null,
          providerPaymentId: normalized.providerPaymentId || billingPayment.providerPaymentId || null,
          paidAt: normalized.status === "succeeded" ? new Date().toISOString() : null,
          failureReason:
            normalized.status === "failed"
              ? normalizeString(normalized.raw?.data?.processor_response) ||
                normalizeString(normalized.raw?.message) ||
                "Payment failed."
              : null,
          rawPayloadJson: safeJsonString(normalized.raw),
          idempotencyKey: normalized.idempotencyKey,
        }
      );
    }

    let invoice = null;
    if (invoiceId) {
      try {
        invoice = await databases.getDocument(databaseId, COLLECTIONS.invoices, invoiceId);
      } catch {
        invoice = null;
      }
    }
    if (!invoice && billingPayment?.invoiceId) {
      try {
        invoice = await databases.getDocument(
          databaseId,
          COLLECTIONS.invoices,
          billingPayment.invoiceId
        );
        invoiceId = invoice.$id;
      } catch {
        invoice = null;
      }
    }

    const subscription = await databases.getDocument(
      databaseId,
      COLLECTIONS.subscriptions,
      subscriptionId
    );
    auditContext.subscriptionId = subscription.$id;
    const previousSubscriptionState = normalizeString(subscription.state);
    const previousPlanCode = normalizeString(subscription.planCode);
    const now = new Date();
    const billingPeriodDays = clampNumber(getEnv("RCMS_BILLING_PERIOD_DAYS"), 1, 365);
    const dunningPolicy = resolveDunningPolicy();

    if (invoice) {
      const nextInvoiceStatus =
        normalized.status === "succeeded"
          ? "paid"
          : normalized.status === "canceled"
            ? "void"
            : normalized.status === "refunded"
              ? "uncollectible"
              : "open";

      await databases.updateDocument(databaseId, COLLECTIONS.invoices, invoice.$id, {
        status: nextInvoiceStatus,
        amountPaid:
          normalized.status === "succeeded"
            ? Number.isFinite(normalized.amount)
              ? normalized.amount
              : Number(invoice.totalAmount ?? 0)
            : Number(invoice.amountPaid ?? 0),
        amountDue:
          normalized.status === "succeeded"
            ? 0
            : Number(invoice.amountDue ?? invoice.totalAmount ?? 0),
        paidAt: normalized.status === "succeeded" ? now.toISOString() : null,
        metadataJson: safeJsonString({
          ...(parseJson(invoice.metadataJson) || {}),
          lastWebhookEvent: normalized.eventType,
          lastWebhookStatus: normalized.status,
          providerReference: normalized.providerReference || null,
          providerPaymentId: normalized.providerPaymentId || null,
        }),
      });
    }

    const invoiceMetadata =
      invoice && typeof invoice.metadataJson === "string"
        ? parseJson(invoice.metadataJson) || {}
        : {};
    const targetPlanCode =
      normalizeString(normalized.meta?.planCode) ||
      normalizeString(invoiceMetadata?.planCode) ||
      normalizeString(subscription.planCode);
    const inferredFailureReason =
      normalized.status === "failed"
        ? normalizeString(normalized.raw?.data?.processor_response) ||
          normalizeString(normalized.raw?.message) ||
          "Payment attempt failed."
        : normalized.status === "refunded"
          ? "Payment was refunded by provider."
          : null;

    const lifecycleUpdate = deriveLifecycleUpdate({
      subscription: {
        ...subscription,
        lastFailureReason: inferredFailureReason || subscription.lastFailureReason,
      },
      normalizedStatus: normalized.status,
      now,
      billingPeriodDays,
      dunningPolicy,
    });
    const nextSubscriptionState = lifecycleUpdate.state || previousSubscriptionState;
    const planChanged =
      Boolean(previousPlanCode) &&
      Boolean(targetPlanCode) &&
      previousPlanCode !== targetPlanCode;
    const renewalCandidates = new Set(["active", "past_due"]);
    const isRenewal =
      normalized.status === "succeeded" &&
      renewalCandidates.has(previousSubscriptionState || "") &&
      didPeriodAdvance(subscription.currentPeriodEnd, lifecycleUpdate.currentPeriodEnd);
    const isCancellation =
      normalized.status === "canceled" || nextSubscriptionState === "canceled";
    const isBillingFailure =
      normalized.status === "failed" ||
      normalized.status === "refunded" ||
      nextSubscriptionState === "past_due" ||
      nextSubscriptionState === "expired";

    await databases.updateDocument(databaseId, COLLECTIONS.subscriptions, subscription.$id, {
      state: nextSubscriptionState,
      planCode: targetPlanCode,
      currentPeriodStart: lifecycleUpdate.currentPeriodStart,
      currentPeriodEnd: lifecycleUpdate.currentPeriodEnd,
      pastDueSince: lifecycleUpdate.pastDueSince,
      graceEndsAt: lifecycleUpdate.graceEndsAt,
      retryCount: lifecycleUpdate.retryCount,
      nextRetryAt: lifecycleUpdate.nextRetryAt,
      lastRetryAt: lifecycleUpdate.lastRetryAt,
      dunningStage: lifecycleUpdate.dunningStage,
      lastFailureReason: lifecycleUpdate.lastFailureReason,
      canceledAt: lifecycleUpdate.canceledAt,
      endedAt: lifecycleUpdate.endedAt,
      cancelAtPeriodEnd: lifecycleUpdate.cancelAtPeriodEnd,
      couponCode:
        normalizeCouponCode(normalized.meta?.couponCode) ||
        normalizeCouponCode(invoice?.couponCode) ||
        normalizeCouponCode(subscription.couponCode),
      discountPercent: Number.isFinite(Number(normalized.meta?.discountPercent))
        ? Number(normalized.meta.discountPercent)
        : Number(subscription.discountPercent ?? 0),
      gatewayProvider: provider,
      gatewaySubscriptionRef:
        normalizeString(normalized.raw?.data?.subscription_id) ||
        normalizeString(subscription.gatewaySubscriptionRef),
      notes: normalizeString(subscription.notes) || null,
    });

    try {
      const workspace = await databases.getDocument(databaseId, COLLECTIONS.workspaces, workspaceId);
      await databases.updateDocument(databaseId, COLLECTIONS.workspaces, workspace.$id, {
        subscriptionState: nextSubscriptionState,
      });
    } catch {
      // Continue if workspace update fails so webhook remains resilient.
    }

    await writeSubscriptionEvent(databases, databaseId, {
      workspaceId,
      subscriptionId: subscription.$id,
      eventType: normalized.eventType,
      eventSource: "webhook",
      eventTime: now.toISOString(),
      stateFrom: previousSubscriptionState,
      stateTo: nextSubscriptionState,
      idempotencyKey: normalized.idempotencyKey,
      payload: normalized.raw,
      actorUserId: "billing_webhook",
      reference: invoiceId || paymentId || normalized.providerReference,
    });

    if (planChanged) {
      await writeSubscriptionEvent(databases, databaseId, {
        workspaceId,
        subscriptionId: subscription.$id,
        eventType: "plan_changed",
        eventSource: "webhook",
        eventTime: now.toISOString(),
        stateFrom: previousSubscriptionState,
        stateTo: nextSubscriptionState,
        idempotencyKey: `${normalized.idempotencyKey}:plan_changed`,
        payload: {
          fromPlanCode: previousPlanCode,
          toPlanCode: targetPlanCode,
          providerReference: normalized.providerReference,
        },
        actorUserId: "billing_webhook",
        reference: invoiceId || paymentId || normalized.providerReference,
      });
    }

    if (isRenewal) {
      await writeSubscriptionEvent(databases, databaseId, {
        workspaceId,
        subscriptionId: subscription.$id,
        eventType: "subscription_renewed",
        eventSource: "webhook",
        eventTime: now.toISOString(),
        stateFrom: previousSubscriptionState,
        stateTo: nextSubscriptionState,
        idempotencyKey: `${normalized.idempotencyKey}:renewal`,
        payload: {
          providerReference: normalized.providerReference,
          periodStart: lifecycleUpdate.currentPeriodStart,
          periodEnd: lifecycleUpdate.currentPeriodEnd,
        },
        actorUserId: "billing_webhook",
        reference: invoiceId || paymentId || normalized.providerReference,
      });
    }

    if (isCancellation) {
      await writeSubscriptionEvent(databases, databaseId, {
        workspaceId,
        subscriptionId: subscription.$id,
        eventType: "subscription_canceled",
        eventSource: "webhook",
        eventTime: now.toISOString(),
        stateFrom: previousSubscriptionState,
        stateTo: nextSubscriptionState,
        idempotencyKey: `${normalized.idempotencyKey}:canceled`,
        payload: {
          providerReference: normalized.providerReference,
          canceledAt: lifecycleUpdate.canceledAt,
        },
        actorUserId: "billing_webhook",
        reference: invoiceId || paymentId || normalized.providerReference,
      });
    }

    if (isBillingFailure) {
      await writeSubscriptionEvent(databases, databaseId, {
        workspaceId,
        subscriptionId: subscription.$id,
        eventType: "billing_action_failed",
        eventSource: "webhook",
        eventTime: now.toISOString(),
        stateFrom: previousSubscriptionState,
        stateTo: nextSubscriptionState,
        idempotencyKey: `${normalized.idempotencyKey}:billing_failed`,
        payload: {
          status: normalized.status,
          failureReason: lifecycleUpdate.lastFailureReason,
          retryCount: lifecycleUpdate.retryCount,
          nextRetryAt: lifecycleUpdate.nextRetryAt,
        },
        actorUserId: "billing_webhook",
        reference: invoiceId || paymentId || normalized.providerReference,
      });
    }

    if (normalized.status === "succeeded") {
      await updateCouponUsageOnSuccess({
        databases,
        databaseId,
        workspaceId,
        couponCode:
          normalized.meta?.couponCode || invoice?.couponCode || subscription.couponCode || null,
        subscriptionId: subscription.$id,
        invoiceId,
        discountPercent:
          normalized.meta?.discountPercent || subscription.discountPercent || 0,
        discountAmount:
          normalized.meta?.discountAmount || invoice?.discountAmount || 0,
      });
    }

    await writeAuditLog(databases, databaseId, {
      workspaceId,
      entityType: "subscription",
      entityId: subscription.$id,
      action: "update",
      actorId: "billing_webhook",
      details: {
        provider,
        eventType: normalized.eventType,
        status: normalized.status,
        previousState: previousSubscriptionState,
        nextState: nextSubscriptionState,
        dunningStage: lifecycleUpdate.dunningStage,
        retryCount: lifecycleUpdate.retryCount,
        nextRetryAt: lifecycleUpdate.nextRetryAt,
        graceEndsAt: lifecycleUpdate.graceEndsAt,
        providerReference: normalized.providerReference,
        providerPaymentId: normalized.providerPaymentId,
      },
    });

    if (planChanged) {
      await writeAuditLog(databases, databaseId, {
        workspaceId,
        entityType: "subscription_plan_change",
        entityId: subscription.$id,
        action: "update",
        actorId: "billing_webhook",
        details: {
          previousPlanCode,
          nextPlanCode: targetPlanCode,
          providerReference: normalized.providerReference,
          invoiceId,
        },
      });
    }

    if (isRenewal) {
      await writeAuditLog(databases, databaseId, {
        workspaceId,
        entityType: "subscription_renewal",
        entityId: subscription.$id,
        action: "update",
        actorId: "billing_webhook",
        details: {
          periodStart: lifecycleUpdate.currentPeriodStart,
          periodEnd: lifecycleUpdate.currentPeriodEnd,
          providerReference: normalized.providerReference,
          invoiceId,
          paymentId,
        },
      });
    }

    if (isCancellation) {
      await writeAuditLog(databases, databaseId, {
        workspaceId,
        entityType: "subscription_cancellation",
        entityId: subscription.$id,
        action: "update",
        actorId: "billing_webhook",
        details: {
          status: normalized.status,
          canceledAt: lifecycleUpdate.canceledAt,
          endedAt: lifecycleUpdate.endedAt,
          providerReference: normalized.providerReference,
        },
      });
    }

    if (isBillingFailure) {
      await writeAuditLog(databases, databaseId, {
        workspaceId,
        entityType: "billing_failure",
        entityId: subscription.$id,
        action: "update",
        actorId: "billing_webhook",
        details: {
          status: normalized.status,
          reason: lifecycleUpdate.lastFailureReason,
          retryCount: lifecycleUpdate.retryCount,
          nextRetryAt: lifecycleUpdate.nextRetryAt,
          graceEndsAt: lifecycleUpdate.graceEndsAt,
          providerReference: normalized.providerReference,
          providerPaymentId: normalized.providerPaymentId,
        },
      });
    }

    return res.json({
      ok: true,
      provider,
      eventType: normalized.eventType,
      status: normalized.status,
      workspaceId,
      subscriptionId: subscription.$id,
      invoiceId,
      paymentId,
      idempotencyKey: normalized.idempotencyKey,
    });
  } catch (error) {
    const status = Number(error?.code) || 500;
    const message =
      error?.response?.message || error?.message || "Failed to process billing webhook.";
    try {
      if (auditContext.workspaceId) {
        const adminClient = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
        const databases = new Databases(adminClient);
        await writeAuditLog(databases, databaseId, {
          workspaceId: auditContext.workspaceId,
          entityType: "billing_webhook",
          entityId: auditContext.subscriptionId || auditContext.workspaceId,
          action: "update",
          actorId: auditContext.actorId,
          details: {
            status: "failed",
            code: status,
            error: message,
            webhookStatus: auditContext.status,
            idempotencyKey: auditContext.idempotencyKey,
          },
        });
      }
    } catch {
      // Ignore audit failures in error path.
    }
    logError?.(`billingWebhook failed: ${message}`);
    return res.json({ ok: false, error: message }, status);
  }
};

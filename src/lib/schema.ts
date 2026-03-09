export const COLLECTIONS = {
  workspaces: "workspaces",
  workspaceMemberships: "workspace_memberships",
  houses: "houses",
  tenants: "tenants",
  payments: "payments",
  expenses: "expenses",
  securityDepositDeductions: "security_deposit_deductions",
  auditLogs: "audit_logs",
  plans: "plans",
  subscriptions: "subscriptions",
  subscriptionEvents: "subscription_events",
  invoices: "invoices",
  paymentsBilling: "payments_billing",
  featureEntitlements: "feature_entitlements",
  coupons: "coupons",
  couponRedemptions: "coupon_redemptions",
} as const;

export const HOUSE_STATUS = ["occupied", "vacant", "inactive"] as const;
export const TENANT_STATUS = ["active", "inactive"] as const;
export const TENANT_TYPES = ["new", "old"] as const;
export const PAYMENT_METHODS = ["cash", "bank"] as const;
export const EXPENSE_CATEGORIES = ["general", "maintenance"] as const;
export const EXPENSE_SOURCES = ["rent_cash", "external"] as const;
export const AUDIT_ACTIONS = ["create", "update", "reverse", "delete"] as const;
export const SUBSCRIPTION_STATES = [
  "trialing",
  "active",
  "past_due",
  "canceled",
  "expired",
] as const;
export const INVOICE_STATUSES = ["draft", "open", "paid", "void", "uncollectible"] as const;
export const BILLING_PAYMENT_STATUSES = [
  "pending",
  "succeeded",
  "failed",
  "refunded",
  "canceled",
] as const;
export const COUPON_REDEMPTION_STATUSES = [
  "applied",
  "reverted",
  "expired",
  "invalid",
] as const;

export type HouseStatus = (typeof HOUSE_STATUS)[number];
export type TenantStatus = (typeof TENANT_STATUS)[number];
export type TenantType = (typeof TENANT_TYPES)[number];
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export type ExpenseSource = (typeof EXPENSE_SOURCES)[number];
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
export type SubscriptionState = (typeof SUBSCRIPTION_STATES)[number];
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export type BillingPaymentStatus = (typeof BILLING_PAYMENT_STATUSES)[number];
export type CouponRedemptionStatus = (typeof COUPON_REDEMPTION_STATUSES)[number];

export type House = {
  $id: string;
  workspaceId?: string;
  code: string;
  name?: string;
  monthlyRent: number;
  status: HouseStatus;
  currentTenantId?: string;
  rentHistoryJson?: string;
  notes?: string;
};

export type HouseForm = {
  code: string;
  name?: string;
  monthlyRent: number;
  status: HouseStatus;
  notes?: string;
};

export type Tenant = {
  $id: string;
  workspaceId?: string;
  fullName: string;
  phone?: string;
  house: string | { $id: string; code?: string; name?: string };
  moveInDate: string;
  moveOutDate?: string;
  status: TenantStatus;
  tenantType?: TenantType;
  securityDepositRequired?: boolean;
  securityDepositAmount?: number;
  securityDepositPaid?: number;
  securityDepositBalance?: number;
  securityDepositRefunded?: boolean;
  rentOverride?: number;
  rentHistoryJson?: string;
  isMigrated?: boolean;
  notes?: string;
};

export type TenantForm = {
  fullName: string;
  phone?: string;
  house: string;
  moveInDate: string;
  moveOutDate?: string;
  status: TenantStatus;
  tenantType: TenantType;
  rentOverride?: number;
  notes?: string;
};

export type PaymentAllocation = Record<string, number>;

export type Payment = {
  $id: string;
  workspaceId?: string;
  tenant: string | { $id?: string; fullName?: string };
  amount: number;
  securityDepositApplied?: number;
  method: PaymentMethod;
  paymentDate: string;
  recordedBy?: string;
  isMigrated?: boolean;
  isReversal?: boolean;
  reversedPaymentId?: string;
  reference?: string;
  notes?: string;
  allocationJson?: string;
  receiptFileId?: string;
  receiptBucketId?: string;
  receiptFileName?: string;
  receiptFileMimeType?: string;
  receiptFileSize?: number;
};

export type PaymentForm = {
  tenant: string;
  amount: number;
  method: PaymentMethod;
  paymentDate: string;
  applySecurityDeposit?: boolean;
  reference?: string;
  notes?: string;
  receiptFile?: FileList;
};

export type Expense = {
  $id: string;
  workspaceId?: string;
  category: ExpenseCategory;
  description: string;
  amount: number;
  source: ExpenseSource;
  expenseDate: string;
  house?: string | { $id?: string; code?: string; name?: string };
  maintenanceType?: string;
  affectsSecurityDeposit?: boolean;
  securityDepositDeductionNote?: string;
  isMigrated?: boolean;
  notes?: string;
  receiptFileId?: string;
  receiptBucketId?: string;
  receiptFileName?: string;
  receiptFileMimeType?: string;
  receiptFileSize?: number;
};

export type ExpenseForm = {
  category: ExpenseCategory;
  description: string;
  amount: number;
  source: ExpenseSource;
  expenseDate: string;
  house?: string;
  maintenanceType?: string;
  affectsSecurityDeposit?: boolean;
  securityDepositDeductionNote?: string;
  notes?: string;
  receiptFile?: FileList;
  removeReceipt?: boolean;
};

export type SecurityDepositDeduction = {
  $id: string;
  workspaceId?: string;
  tenantId: string;
  expenseId: string;
  houseId: string;
  deductionDate: string;
  itemFixed: string;
  amount: number;
  deductionNote?: string;
  expenseReference?: string;
};

export type AuditLog = {
  $id: string;
  workspaceId?: string;
  entityType: string;
  entityId: string;
  action: AuditAction;
  actorId: string;
  timestamp: string;
  detailsJson?: string;
};

export type Workspace = {
  $id: string;
  name: string;
  ownerUserId?: string;
  status: "active" | "inactive";
  subscriptionState?: SubscriptionState;
  trialStartDate?: string;
  trialEndDate?: string;
  logoFileId?: string;
  logoBucketId?: string;
  logoFileName?: string;
  wmEnabled?: boolean;
  wmPosition?: "center" | "top_left" | "top_right" | "bottom_left" | "bottom_right";
  wmOpacity?: number;
  wmScale?: number;
  notes?: string;
};

export type WorkspaceMembership = {
  $id: string;
  workspaceId?: string;
  userId: string;
  email?: string;
  role: "admin" | "clerk" | "viewer";
  status: "active" | "inactive";
  invitedByUserId?: string;
  notes?: string;
};

export type Plan = {
  $id: string;
  code: string;
  name: string;
  description?: string;
  currency: string;
  priceAmount: number;
  trialDays?: number;
  isActive: boolean;
  sortOrder?: number;
  entitlementsJson?: string;
  limitsJson?: string;
  metadataJson?: string;
};

export type Subscription = {
  $id: string;
  workspaceId?: string;
  planCode: string;
  state: SubscriptionState;
  trialStartDate?: string;
  trialEndDate?: string;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  pastDueSince?: string;
  graceEndsAt?: string;
  retryCount?: number;
  nextRetryAt?: string;
  lastRetryAt?: string;
  dunningStage?: string;
  lastFailureReason?: string;
  cancelAtPeriodEnd?: boolean;
  canceledAt?: string;
  endedAt?: string;
  couponCode?: string;
  discountPercent?: number;
  gatewayProvider?: string;
  gatewayCustomerRef?: string;
  gatewaySubscriptionRef?: string;
  notes?: string;
};

export type SubscriptionEvent = {
  $id: string;
  workspaceId?: string;
  subscriptionId: string;
  eventType: string;
  eventSource?: string;
  eventTime: string;
  stateFrom?: SubscriptionState;
  stateTo?: SubscriptionState;
  idempotencyKey?: string;
  payloadJson?: string;
  actorUserId?: string;
  reference?: string;
};

export type Invoice = {
  $id: string;
  workspaceId?: string;
  subscriptionId: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  currency: string;
  subtotal: number;
  discountAmount?: number;
  taxAmount?: number;
  totalAmount: number;
  amountDue: number;
  amountPaid?: number;
  dueDate?: string;
  issuedAt?: string;
  paidAt?: string;
  periodStart?: string;
  periodEnd?: string;
  couponCode?: string;
  metadataJson?: string;
};

export type BillingPayment = {
  $id: string;
  workspaceId?: string;
  subscriptionId?: string;
  invoiceId?: string;
  status: BillingPaymentStatus;
  provider: string;
  providerReference?: string;
  providerPaymentId?: string;
  amount: number;
  currency: string;
  paidAt?: string;
  failureReason?: string;
  rawPayloadJson?: string;
  idempotencyKey?: string;
};

export type FeatureEntitlement = {
  $id: string;
  planCode: string;
  featureKey: string;
  enabled: boolean;
  limitValue?: number;
  limitUnit?: string;
  notes?: string;
};

export type Coupon = {
  $id: string;
  code: string;
  name?: string;
  description?: string;
  discountPercent: number;
  appliesToPlanCodesJson?: string;
  validFrom?: string;
  validUntil?: string;
  maxRedemptions?: number;
  maxRedemptionsPerWorkspace?: number;
  redemptionCount?: number;
  minPlanAmount?: number;
  isActive: boolean;
  metadataJson?: string;
};

export type CouponRedemption = {
  $id: string;
  workspaceId?: string;
  couponCode: string;
  subscriptionId?: string;
  invoiceId?: string;
  redeemedAt: string;
  discountPercent: number;
  discountAmount?: number;
  status: CouponRedemptionStatus;
  redemptionReference?: string;
};

export function encodeJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function decodeJson<T>(value?: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

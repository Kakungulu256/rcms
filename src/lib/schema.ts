export const COLLECTIONS = {
  workspaces: "workspaces",
  houses: "houses",
  tenants: "tenants",
  payments: "payments",
  expenses: "expenses",
  securityDepositDeductions: "security_deposit_deductions",
  auditLogs: "audit_logs",
} as const;

export const HOUSE_STATUS = ["occupied", "vacant", "inactive"] as const;
export const TENANT_STATUS = ["active", "inactive"] as const;
export const TENANT_TYPES = ["new", "old"] as const;
export const PAYMENT_METHODS = ["cash", "bank"] as const;
export const EXPENSE_CATEGORIES = ["general", "maintenance"] as const;
export const EXPENSE_SOURCES = ["rent_cash", "external"] as const;
export const AUDIT_ACTIONS = ["create", "update", "reverse", "delete"] as const;

export type HouseStatus = (typeof HOUSE_STATUS)[number];
export type TenantStatus = (typeof TENANT_STATUS)[number];
export type TenantType = (typeof TENANT_TYPES)[number];
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export type ExpenseSource = (typeof EXPENSE_SOURCES)[number];
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

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
  subscriptionState?: "trialing" | "active" | "past_due" | "canceled" | "expired";
  trialStartDate?: string;
  trialEndDate?: string;
  notes?: string;
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

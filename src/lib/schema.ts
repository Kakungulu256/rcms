export const COLLECTIONS = {
  houses: "houses",
  tenants: "tenants",
  payments: "payments",
  expenses: "expenses",
  auditLogs: "audit_logs",
} as const;

export const HOUSE_STATUS = ["occupied", "vacant", "inactive"] as const;
export const TENANT_STATUS = ["active", "inactive"] as const;
export const PAYMENT_METHODS = ["cash", "bank"] as const;
export const EXPENSE_CATEGORIES = ["general", "maintenance"] as const;
export const EXPENSE_SOURCES = ["rent_cash", "external"] as const;
export const AUDIT_ACTIONS = ["create", "update", "reverse", "delete"] as const;

export type HouseStatus = (typeof HOUSE_STATUS)[number];
export type TenantStatus = (typeof TENANT_STATUS)[number];
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export type ExpenseSource = (typeof EXPENSE_SOURCES)[number];
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type House = {
  $id: string;
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
  fullName: string;
  phone?: string;
  house: string | { $id: string; code?: string; name?: string };
  moveInDate: string;
  moveOutDate?: string;
  status: TenantStatus;
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
  rentOverride?: number;
  notes?: string;
};

export type PaymentAllocation = Record<string, number>;

export type Payment = {
  $id: string;
  tenant: string | { $id?: string; fullName?: string };
  amount: number;
  method: PaymentMethod;
  paymentDate: string;
  recordedBy?: string;
  isMigrated?: boolean;
  isReversal?: boolean;
  reversedPaymentId?: string;
  reference?: string;
  notes?: string;
  allocationJson?: string;
};

export type PaymentForm = {
  tenant: string;
  amount: number;
  method: PaymentMethod;
  paymentDate: string;
  reference?: string;
  notes?: string;
};

export type Expense = {
  $id: string;
  category: ExpenseCategory;
  description: string;
  amount: number;
  source: ExpenseSource;
  expenseDate: string;
  house?: string | { $id?: string; code?: string; name?: string };
  maintenanceType?: string;
  isMigrated?: boolean;
  notes?: string;
};

export type ExpenseForm = {
  category: ExpenseCategory;
  description: string;
  amount: number;
  source: ExpenseSource;
  expenseDate: string;
  house?: string;
  maintenanceType?: string;
  notes?: string;
};

export type AuditLog = {
  $id: string;
  entityType: string;
  entityId: string;
  action: AuditAction;
  actorId: string;
  timestamp: string;
  detailsJson?: string;
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

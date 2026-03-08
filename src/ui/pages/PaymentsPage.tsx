import { useEffect, useMemo, useState } from "react";
import { ID, Query } from "appwrite";
import { format, startOfMonth } from "date-fns";
import {
  account,
  databases,
  functions,
  listAllDocuments,
  rcmsDatabaseId,
  rcmsReceiptsBucketId,
  storage,
} from "../../lib/appwrite";
import { COLLECTIONS, decodeJson, PAYMENT_METHODS } from "../../lib/schema";
import type {
  House,
  Payment,
  PaymentForm as PaymentFormValues,
  Tenant,
} from "../../lib/schema";
import AllocationPreviewPanel from "../payments/AllocationPreview";
import ConfirmModal from "../payments/ConfirmModal";
import PaymentForm from "../payments/PaymentForm";
import Modal from "../Modal";
import {
  buildMonthSeries,
  buildPaidByMonth,
  previewAllocation,
} from "../payments/allocation";
import { logAudit } from "../../lib/audit";
import { useAuth } from "../../auth/AuthContext";
import { useToast } from "../ToastContext";
import { buildRentByMonth } from "../../lib/rentHistory";
import { normalizePaymentNote } from "../../lib/paymentNotes";
import { formatDisplayDate, formatShortMonth } from "../../lib/dateDisplay";
import { getTenantEffectiveEndDate } from "../../lib/tenancyDates";
import { formatAmount } from "../../lib/numberFormat";

type PreviewState = {
  form: PaymentFormValues;
  allocationJson: string;
  securityDepositApplied: number;
  totalAmount: number;
};

type PaymentEditValues = {
  amount: number;
  method: "cash" | "bank";
  paymentDate: string;
  reference: string;
  notes: string;
  receiptFile: File | null;
  removeReceipt: boolean;
};

type FunctionResult =
  | { ok: true; payment?: Payment; reversal?: Payment }
  | { ok: false; error?: string };

type UploadedReceipt = {
  fileId: string;
  bucketId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
};

function resolveDepositBalance(tenant: Tenant) {
  const amount =
    typeof tenant.securityDepositAmount === "number" &&
    Number.isFinite(tenant.securityDepositAmount)
      ? tenant.securityDepositAmount
      : 0;
  const paid =
    typeof tenant.securityDepositPaid === "number" &&
    Number.isFinite(tenant.securityDepositPaid)
      ? tenant.securityDepositPaid
      : 0;
  const balance =
    typeof tenant.securityDepositBalance === "number" &&
    Number.isFinite(tenant.securityDepositBalance)
      ? tenant.securityDepositBalance
      : amount - paid;
  return Math.max(balance, 0);
}

function formatFileSize(bytes?: number) {
  const size = Number(bytes ?? 0);
  if (!Number.isFinite(size) || size <= 0) return "--";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function parseDateInput(value?: string) {
  const parsed = value ? new Date(`${value.slice(0, 10)}T00:00:00`) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function parseOptionalDate(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function buildAllocationMonths(params: {
  tenant: Tenant;
  paymentDate: string;
  allocatableAmount: number;
  rent: number;
}) {
  const { tenant, paymentDate, allocatableAmount, rent } = params;
  const paymentDateValue = parseDateInput(paymentDate);
  const effectiveEndDate = getTenantEffectiveEndDate(tenant, paymentDateValue);
  const moveOutDate = parseOptionalDate(tenant.moveOutDate);
  const movedOutBeforePaymentMonth =
    moveOutDate != null
      ? startOfMonth(moveOutDate).getTime() < startOfMonth(paymentDateValue).getTime()
      : false;
  const canCarryForward = tenant.status === "active" && !movedOutBeforePaymentMonth;
  const extraMonths =
    canCarryForward && rent > 0 && allocatableAmount > 0
      ? Math.max(24, Math.ceil(allocatableAmount / rent) + 12)
      : 0;
  return buildMonthSeries(tenant.moveInDate, effectiveEndDate, extraMonths);
}

export default function PaymentsPage() {
  const { user, permissions } = useAuth();
  const canRecordPayments = permissions.canRecordPayments;
  const canReversePayments = permissions.canReversePayments;
  const toast = useToast();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [houses, setHouses] = useState<House[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [expandedPaymentId, setExpandedPaymentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ReturnType<typeof previewAllocation> | null>(
    null
  );
  const [previewState, setPreviewState] = useState<PreviewState | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reverseTarget, setReverseTarget] = useState<Payment | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingPayment, setEditingPayment] = useState<Payment | null>(null);
  const [editValues, setEditValues] = useState<PaymentEditValues | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [reverseLoadingId, setReverseLoadingId] = useState<string | null>(null);
  const allocateFunctionId = import.meta.env.VITE_ALLOCATE_RENT_PAYMENT_FUNCTION_ID as
    | string
    | undefined;

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [tenantResult, houseResult, paymentResult] = await Promise.all([
        listAllDocuments<Tenant>({
          databaseId: rcmsDatabaseId,
          collectionId: COLLECTIONS.tenants,
          queries: [Query.orderAsc("fullName")],
        }),
        listAllDocuments<House>({
          databaseId: rcmsDatabaseId,
          collectionId: COLLECTIONS.houses,
          queries: [Query.orderAsc("code")],
        }),
        listAllDocuments<Payment>({
          databaseId: rcmsDatabaseId,
          collectionId: COLLECTIONS.payments,
          queries: [Query.orderDesc("paymentDate")],
        }),
      ]);
      setTenants(tenantResult);
      setHouses(houseResult);
      setPayments(paymentResult);
    } catch (err) {
      setError("Failed to load payments.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const tenantLookup = useMemo(
    () => new Map(tenants.map((tenant) => [tenant.$id, tenant])),
    [tenants]
  );
  const houseLookup = useMemo(
    () => new Map(houses.map((house) => [house.$id, house])),
    [houses]
  );
  const reversedPaymentIds = useMemo(() => {
    const ids = new Set<string>();
    payments.forEach((payment) => {
      if (payment.isReversal && payment.reversedPaymentId) {
        ids.add(payment.reversedPaymentId);
      }
    });
    return ids;
  }, [payments]);
  const reversalByOriginalId = useMemo(() => {
    const map = new Map<string, Payment>();
    payments.forEach((payment) => {
      if (!payment.isReversal || !payment.reversedPaymentId) return;
      const existing = map.get(payment.reversedPaymentId);
      if (!existing || payment.paymentDate > existing.paymentDate) {
        map.set(payment.reversedPaymentId, payment);
      }
    });
    return map;
  }, [payments]);
  const visiblePayments = useMemo(() => {
    return payments.filter((payment) => !payment.isReversal);
  }, [payments]);
  const currentMonthKey = format(new Date(), "yyyy-MM");

  const getPaymentTenantId = (payment: Payment) =>
    typeof payment.tenant === "string" ? payment.tenant : payment.tenant?.$id ?? "";

  const hasPriorValidPaymentForTenant = (tenantId: string) =>
    payments.some((payment) => {
      if (payment.isReversal) return false;
      if (reversedPaymentIds.has(payment.$id)) return false;
      return getPaymentTenantId(payment) === tenantId;
    });

  const getDepositHandling = (tenant: Tenant, amount: number) => {
    const isNewTenant = (tenant.tenantType ?? "old") === "new";
    const depositRequired = isNewTenant && (tenant.securityDepositRequired ?? true);
    const depositBalance = resolveDepositBalance(tenant);
    const eligible =
      depositRequired &&
      depositBalance > 0 &&
      !hasPriorValidPaymentForTenant(tenant.$id);
    const suggestedAmount = Math.min(Math.max(Number(amount) || 0, 0), depositBalance);
    return {
      eligible,
      suggestedAmount,
    };
  };

  const canEditPaymentRow = (payment: Payment) => {
    if (!canRecordPayments) return false;
    if (payment.isReversal) return false;
    if (Math.abs(Number(payment.securityDepositApplied) || 0) > 0) return false;
    if (reversedPaymentIds.has(payment.$id)) return false;
    if (payment.paymentDate?.slice(0, 7) !== currentMonthKey) return false;
    const tenantId = getPaymentTenantId(payment);
    if (!tenantId) return false;
    const hasLaterPayment = payments.some((candidate) => {
      if (candidate.$id === payment.$id) return false;
      if (candidate.isReversal) return false;
      return (
        getPaymentTenantId(candidate) === tenantId &&
        candidate.paymentDate > payment.paymentDate
      );
    });
    return !hasLaterPayment;
  };

  const openEditPayment = (payment: Payment) => {
    if (!canEditPaymentRow(payment)) {
      toast.push(
        "warning",
        "Only latest non-reversed payments in the current month can be edited."
      );
      return;
    }
    setEditingPayment(payment);
    setEditValues({
      amount: Number(payment.amount) || 0,
      method: payment.method,
      paymentDate: payment.paymentDate?.slice(0, 10) ?? "",
      reference: payment.reference ?? "",
      notes: payment.notes ?? "",
      receiptFile: null,
      removeReceipt: false,
    });
    setEditOpen(true);
  };

  const handlePreview = (values: PaymentFormValues) => {
    if (!canRecordPayments) {
      toast.push("warning", "You do not have permission to record payments.");
      return;
    }
    const tenant = tenantLookup.get(values.tenant);
    if (!tenant) {
      setError("Select a tenant to preview allocation.");
      return;
    }
    const normalizedNote = normalizePaymentNote(values.notes);
    if (!normalizedNote) {
      setError("Payment status note is required.");
      return;
    }
    const depositHandling = getDepositHandling(tenant, values.amount);
    const securityDepositApplied = depositHandling.eligible
      ? depositHandling.suggestedAmount
      : 0;
    const normalizedValues: PaymentFormValues = {
      ...values,
      notes: normalizedNote,
      applySecurityDeposit: depositHandling.eligible,
    };
    const houseId =
      typeof tenant.house === "string" ? tenant.house : tenant.house?.$id ?? "";
    const house = houseLookup.get(houseId);
    const rent = tenant.rentOverride ?? house?.monthlyRent ?? 0;
    const tenantPayments = payments.filter((payment) => {
      const paymentTenantId =
        typeof payment.tenant === "string" ? payment.tenant : payment.tenant?.$id;
      return paymentTenantId === tenant.$id;
    });
    const paidByMonth = buildPaidByMonth(tenantPayments);
    const allocatableAmount = Math.max(normalizedValues.amount - securityDepositApplied, 0);
    const months = buildAllocationMonths({
      tenant,
      paymentDate: normalizedValues.paymentDate,
      allocatableAmount,
      rent,
    });
    const rentByMonth = buildRentByMonth({
      months,
      tenantHistoryJson: tenant.rentHistoryJson ?? null,
      houseHistoryJson: house?.rentHistoryJson ?? null,
      fallbackRent: rent,
    });
    const allocation = previewAllocation({
      amount: allocatableAmount,
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
    setPreview(allocation);
      setPreviewState({
      form: normalizedValues,
      allocationJson,
      securityDepositApplied,
      totalAmount: Math.max(Number(normalizedValues.amount) || 0, 0),
      });
    if (allocation.totalApplied + 0.01 < allocatableAmount) {
      toast.push(
        "warning",
        "Part of this payment stays unallocated. Tenant may be inactive or has no billable future months."
      );
    }
    setConfirmOpen(true);
  };

  const parseExecutionBody = (response?: string) => {
    try {
      return response ? JSON.parse(response) : null;
    } catch {
      return null;
    }
  };

  const executeAllocationFunction = async (payload: Record<string, unknown>) => {
    if (!allocateFunctionId) {
      throw new Error("Allocate payment function ID is missing.");
    }

    const execution = await functions.createExecution(
      allocateFunctionId,
      JSON.stringify(payload),
      false
    );

    const readBody = (value: any) =>
      (value?.responseBody as string | undefined) ??
      (value?.response as string | undefined) ??
      "";

    let latest: any = execution;
    let body = readBody(latest);
    let attempts = 0;

    while (
      attempts < 8 &&
      (!body || latest?.status === "waiting" || latest?.status === "processing")
    ) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      latest = await functions.getExecution(allocateFunctionId, latest.$id);
      body = readBody(latest);
      attempts += 1;
    }

    const parsed = parseExecutionBody(body) as FunctionResult | null;
    return { parsed, latest, body };
  };

  const uploadReceipt = async (receipt: File): Promise<UploadedReceipt> => {
    const file = await storage.createFile(rcmsReceiptsBucketId, ID.unique(), receipt);
    return {
      fileId: file.$id,
      bucketId: rcmsReceiptsBucketId,
      fileName: file.name ?? receipt.name,
      mimeType: file.mimeType ?? receipt.type ?? "application/octet-stream",
      fileSize: Number(file.sizeOriginal ?? receipt.size ?? 0),
    };
  };

  const handleConfirm = async () => {
    if (!previewState) return;
    if (!canRecordPayments) {
      toast.push("warning", "You do not have permission to record payments.");
      return;
    }
    setConfirmLoading(true);
    setLoading(true);
    setError(null);
    let uploadedReceipt: UploadedReceipt | null = null;
    let paymentCreated = false;
    try {
      const selectedReceipt = previewState.form.receiptFile?.item(0) ?? null;
      if (selectedReceipt) {
        if (selectedReceipt.size > 10 * 1024 * 1024) {
          throw new Error("Receipt file must be 10MB or smaller.");
        }
        uploadedReceipt = await uploadReceipt(selectedReceipt);
      }
      const jwt = await account.createJWT();
      const { parsed, latest, body } = await executeAllocationFunction({
        jwt: jwt.jwt,
        tenantId: previewState.form.tenant,
        amount: previewState.form.amount,
        method: previewState.form.method,
        paymentDate: previewState.form.paymentDate,
        applySecurityDeposit: previewState.form.applySecurityDeposit ?? false,
        reference: previewState.form.reference,
        notes: previewState.form.notes,
        receiptFileId: uploadedReceipt?.fileId ?? null,
        receiptBucketId: uploadedReceipt?.bucketId ?? null,
        receiptFileName: uploadedReceipt?.fileName ?? null,
        receiptFileMimeType: uploadedReceipt?.mimeType ?? null,
        receiptFileSize: uploadedReceipt?.fileSize ?? null,
      });
      if (!parsed || !parsed.ok || !parsed.payment) {
        console.error("Allocate function returned error:", {
          parsed,
          status: latest?.status,
          responseStatusCode: latest?.responseStatusCode,
          errors: latest?.errors,
          body,
        });
        throw new Error(
          (parsed && !parsed.ok && parsed.error) ||
            latest?.errors ||
            "Allocation failed."
        );
      }
      paymentCreated = true;
      setConfirmOpen(false);
      setModalOpen(false);
      await loadData();
      toast.push("success", "Payment recorded.");
      if (user) {
        void logAudit({
          entityType: "payment",
          entityId: (parsed.payment as Payment).$id,
          action: "create",
          actorId: user.id,
          details: {
            tenant: previewState.form.tenant,
            amount: previewState.form.amount,
            method: previewState.form.method,
            paymentDate: previewState.form.paymentDate,
            reference: previewState.form.reference ?? null,
            notes: previewState.form.notes ?? null,
            receiptFileId: uploadedReceipt?.fileId ?? null,
          },
        });
      }
    } catch (err) {
      if (uploadedReceipt && !paymentCreated) {
        try {
          await storage.deleteFile(uploadedReceipt.bucketId, uploadedReceipt.fileId);
        } catch (cleanupError) {
          console.error("Failed to clean up uploaded receipt:", cleanupError);
        }
      }
      console.error("Payment recording failed:", err);
      const message =
        err instanceof Error && err.message
          ? err.message
          : "Failed to record payment.";
      setError(message);
      toast.push("error", message);
    } finally {
      setConfirmLoading(false);
      setLoading(false);
    }
  };

  const handleReverse = async () => {
    if (!reverseTarget) return;
    if (!canReversePayments) {
      toast.push("warning", "You do not have permission to reverse payments.");
      return;
    }
    if (reversedPaymentIds.has(reverseTarget.$id)) {
      toast.push("warning", "This payment has already been reversed.");
      setReverseTarget(null);
      return;
    }
    const targetId = reverseTarget.$id;
    setReverseLoadingId(reverseTarget.$id);
    setLoading(true);
    setError(null);
    try {
      const jwt = await account.createJWT();
      const { parsed, latest, body } = await executeAllocationFunction({
        jwt: jwt.jwt,
        reversePaymentId: reverseTarget.$id,
        paymentDate: new Date().toISOString().slice(0, 10),
        notes: `Reversal of ${reverseTarget.$id}`,
      });
      if (!parsed || !parsed.ok || !parsed.reversal) {
        console.error("Reversal function returned error:", {
          parsed,
          status: latest?.status,
          responseStatusCode: latest?.responseStatusCode,
          errors: latest?.errors,
          body,
        });
        throw new Error(
          (parsed && !parsed.ok && parsed.error) ||
            latest?.errors ||
            "Reversal failed."
        );
      }
      setReverseTarget(null);
      await loadData();
      toast.push("success", "Payment reversed.");
      if (user) {
        void logAudit({
          entityType: "payment",
          entityId: (parsed.reversal as Payment).$id,
          action: "reverse",
          actorId: user.id,
          details: { reversedPaymentId: targetId },
        });
      }
    } catch (err) {
      console.error("Payment reversal failed:", err);
      const message =
        err instanceof Error && err.message
          ? err.message
          : "Failed to reverse payment.";
      setError(message);
      toast.push("error", message);
    } finally {
      setReverseLoadingId(null);
      setLoading(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editingPayment || !editValues) return;
    if (!canRecordPayments) {
      toast.push("warning", "You do not have permission to edit payments.");
      return;
    }
    const normalizedAmount = Number(editValues.amount);
    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
      toast.push("warning", "Amount must be greater than zero.");
      return;
    }
    const normalizedNote = normalizePaymentNote(editValues.notes);
    if (!normalizedNote) {
      toast.push("warning", "Payment status note is required.");
      return;
    }
    const tenantId = getPaymentTenantId(editingPayment);
    const tenant = tenantLookup.get(tenantId);
    if (!tenant) {
      toast.push("error", "Tenant not found for this payment.");
      return;
    }
    if (!canEditPaymentRow(editingPayment)) {
      toast.push(
        "warning",
        "Only latest non-reversed payments in the current month can be edited."
      );
      setEditOpen(false);
      setEditingPayment(null);
      setEditValues(null);
      return;
    }
    setEditSaving(true);
    setLoading(true);
    setError(null);
    let uploadedReceipt: UploadedReceipt | null = null;
    let shouldDeleteOldReceipt = false;
    let receiptAction: "unchanged" | "replaced" | "removed" = "unchanged";
    const existingReceiptFileId = editingPayment.receiptFileId?.trim() ?? "";
    const existingReceiptBucketId =
      editingPayment.receiptBucketId?.trim() || rcmsReceiptsBucketId;
    try {
      const houseId =
        typeof tenant.house === "string" ? tenant.house : tenant.house?.$id ?? "";
      const house = houseLookup.get(houseId);
      const rent = tenant.rentOverride ?? house?.monthlyRent ?? 0;
      const tenantPayments = payments.filter((payment) => {
        const paymentTenantId = getPaymentTenantId(payment);
        return paymentTenantId === tenant.$id && payment.$id !== editingPayment.$id;
      });
      const paidByMonth = buildPaidByMonth(tenantPayments);
      const months = buildAllocationMonths({
        tenant,
        paymentDate: editValues.paymentDate,
        allocatableAmount: Math.max(editValues.amount, 0),
        rent,
      });
      const rentByMonth = buildRentByMonth({
        months,
        tenantHistoryJson: tenant.rentHistoryJson ?? null,
        houseHistoryJson: house?.rentHistoryJson ?? null,
        fallbackRent: rent,
      });
      const allocation = previewAllocation({
        amount: normalizedAmount,
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

      const selectedEditReceipt = editValues.receiptFile;
      if (selectedEditReceipt) {
        if (selectedEditReceipt.size > 10 * 1024 * 1024) {
          throw new Error("Receipt file must be 10MB or smaller.");
        }
        uploadedReceipt = await uploadReceipt(selectedEditReceipt);
      }

      const shouldRemoveExistingReceipt = Boolean(
        editValues.removeReceipt && !uploadedReceipt
      );
      if (uploadedReceipt) {
        receiptAction = "replaced";
        shouldDeleteOldReceipt = Boolean(existingReceiptFileId);
      } else if (shouldRemoveExistingReceipt) {
        receiptAction = "removed";
        shouldDeleteOldReceipt = Boolean(existingReceiptFileId);
      }

      const paymentUpdatePayload: Record<string, unknown> = {
        amount: normalizedAmount,
        method: editValues.method,
        paymentDate: editValues.paymentDate,
        reference: editValues.reference?.trim() ? editValues.reference.trim() : null,
        notes: normalizedNote,
        allocationJson,
      };

      if (uploadedReceipt) {
        paymentUpdatePayload.receiptFileId = uploadedReceipt.fileId;
        paymentUpdatePayload.receiptBucketId = uploadedReceipt.bucketId;
        paymentUpdatePayload.receiptFileName = uploadedReceipt.fileName;
        paymentUpdatePayload.receiptFileMimeType = uploadedReceipt.mimeType;
        paymentUpdatePayload.receiptFileSize = uploadedReceipt.fileSize;
      } else if (shouldRemoveExistingReceipt) {
        paymentUpdatePayload.receiptFileId = null;
        paymentUpdatePayload.receiptBucketId = null;
        paymentUpdatePayload.receiptFileName = null;
        paymentUpdatePayload.receiptFileMimeType = null;
        paymentUpdatePayload.receiptFileSize = null;
      }

      await databases.updateDocument(
        rcmsDatabaseId,
        COLLECTIONS.payments,
        editingPayment.$id,
        paymentUpdatePayload
      );

      if (shouldDeleteOldReceipt && existingReceiptFileId) {
        try {
          await storage.deleteFile(existingReceiptBucketId, existingReceiptFileId);
        } catch (receiptDeleteError) {
          console.error("Failed to delete replaced payment receipt:", receiptDeleteError);
        }
      }

      if (user) {
        void logAudit({
          entityType: "payment",
          entityId: editingPayment.$id,
          action: "update",
          actorId: user.id,
          details: {
            amount: normalizedAmount,
            method: editValues.method,
            paymentDate: editValues.paymentDate,
            receiptAction,
            receiptFileId: uploadedReceipt?.fileId ?? null,
          },
        });
      }
      setEditOpen(false);
      setEditingPayment(null);
      setEditValues(null);
      await loadData();
      toast.push("success", "Payment updated.");
    } catch (err) {
      if (uploadedReceipt) {
        try {
          await storage.deleteFile(uploadedReceipt.bucketId, uploadedReceipt.fileId);
        } catch (cleanupError) {
          console.error("Failed to clean up uploaded receipt:", cleanupError);
        }
      }
      console.error("Payment edit failed:", err);
      const message =
        err instanceof Error && err.message ? err.message : "Failed to update payment.";
      setError(message);
      toast.push("error", message);
    } finally {
      setEditSaving(false);
      setLoading(false);
    }
  };

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
        <div className="text-sm text-slate-500">Payments</div>
        <h3 className="mt-2 text-xl font-semibold text-white">Rent Collection</h3>
        <p className="mt-1 text-sm text-slate-500">
          Record rent payments with allocation preview.
        </p>
        </div>
        {canRecordPayments && (
          <button
            onClick={() => setModalOpen(true)}
            className="btn-primary text-sm"
          >
            New Payment
          </button>
        )}
      </header>

      {error && (
        <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <div
            className="rounded-2xl border p-5"
            style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
          >
            <div className="text-sm font-semibold text-slate-100">
              Payment History
            </div>
            <div className="mt-3 space-y-3 text-sm text-slate-300">
              {visiblePayments.slice(0, 6).map((payment) => {
                const tenantLabel =
                  typeof payment.tenant === "string"
                    ? tenantLookup.get(payment.tenant)?.fullName ?? payment.tenant
                    : payment.tenant?.fullName ?? "Tenant";
                const allocation =
                  decodeJson<Record<string, number>>(payment.allocationJson) ?? {};
                const allocationRows = Object.entries(allocation).sort(([a], [b]) =>
                  a.localeCompare(b)
                );
                const securityDepositApplied = Number(payment.securityDepositApplied) || 0;
                const isExpanded = expandedPaymentId === payment.$id;
                const isAlreadyReversed = reversedPaymentIds.has(payment.$id);
                const reversal = reversalByOriginalId.get(payment.$id);
                const receiptBucketId =
                  payment.receiptBucketId?.trim() || rcmsReceiptsBucketId;
                const receiptUrl = payment.receiptFileId
                  ? storage.getFileView(receiptBucketId, payment.receiptFileId)
                  : "";
                return (
                <div
                  key={payment.$id}
                  className="rounded-xl border px-4 py-3"
                  style={{ backgroundColor: "var(--surface-strong)", borderColor: "var(--border)" }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">
                      {tenantLabel}
                    </span>
                    <span>
                      <span className="amount">
                        {formatAmount(payment.amount)}
                      </span>
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {formatDisplayDate(payment.paymentDate)} - {payment.method}
                  </div>
                  <button
                    onClick={() =>
                      setExpandedPaymentId(isExpanded ? null : payment.$id)
                    }
                    className="mt-3 text-xs text-slate-300 underline"
                  >
                    {isExpanded ? "Hide details" : "View details"}
                  </button>
                  {isExpanded && (
                    <div className="mt-3 space-y-2 text-xs text-slate-400">
                      {isAlreadyReversed && reversal && (
                        <div className="text-amber-300">
                          Reversed on {formatDisplayDate(reversal.paymentDate)} (
                          {formatAmount(Math.abs(Number(reversal.amount)))}
                          )
                        </div>
                      )}
                      <div className="overflow-x-auto rounded-lg border border-slate-200/20">
                        <table className="min-w-[360px] w-full text-left text-xs">
                          <thead className="text-slate-300">
                            <tr>
                              <th className="px-3 py-2">Paid for</th>
                              <th className="px-3 py-2">Amount</th>
                              <th className="px-3 py-2">Date paid</th>
                            </tr>
                          </thead>
                          <tbody>
                            {allocationRows.length > 0 ? (
                              <>
                                {allocationRows.map(([month, amount]) => (
                                  <tr
                                    key={`${payment.$id}-${month}`}
                                    className="border-t border-slate-200/10"
                                  >
                                    <td className="px-3 py-2">{formatShortMonth(month)}</td>
                                    <td className="px-3 py-2">
                                      {formatAmount(Number(amount))}
                                    </td>
                                    <td className="px-3 py-2">
                                      {formatDisplayDate(payment.paymentDate)}
                                    </td>
                                  </tr>
                                ))}
                                {Math.abs(securityDepositApplied) > 0 && (
                                  <tr className="border-t border-slate-200/10">
                                    <td className="px-3 py-2">Security Deposit</td>
                                    <td className="px-3 py-2">
                                      {formatAmount(securityDepositApplied)}
                                    </td>
                                    <td className="px-3 py-2">
                                      {formatDisplayDate(payment.paymentDate)}
                                    </td>
                                  </tr>
                                )}
                              </>
                            ) : (
                              <>
                                {Math.abs(securityDepositApplied) > 0 && (
                                  <tr className="border-t border-slate-200/10">
                                    <td className="px-3 py-2">Security Deposit</td>
                                    <td className="px-3 py-2">
                                      {formatAmount(securityDepositApplied)}
                                    </td>
                                    <td className="px-3 py-2">
                                      {formatDisplayDate(payment.paymentDate)}
                                    </td>
                                  </tr>
                                )}
                                {Math.abs(Number(payment.amount) - securityDepositApplied) > 0 && (
                                  <tr className="border-t border-slate-200/10">
                                    <td className="px-3 py-2">Unspecified</td>
                                    <td className="px-3 py-2">
                                      {formatAmount(Number(payment.amount) - securityDepositApplied)}
                                    </td>
                                    <td className="px-3 py-2">
                                      {formatDisplayDate(payment.paymentDate)}
                                    </td>
                                  </tr>
                                )}
                              </>
                            )}
                          </tbody>
                        </table>
                      </div>
                      <div>
                        Status note: {payment.notes?.trim() ? payment.notes : "--"}
                      </div>
                      {receiptUrl && (
                        <div>
                          Receipt:{" "}
                          <a
                            href={receiptUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-sky-300 underline"
                          >
                            {payment.receiptFileName?.trim() || "View receipt"}
                          </a>{" "}
                          <span className="text-slate-500">
                            ({formatFileSize(payment.receiptFileSize)})
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                  <div className="mt-3 flex justify-end">
                    {isAlreadyReversed && !payment.isReversal && (
                      <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs text-amber-300">
                        Reversed
                      </span>
                    )}
                    {canEditPaymentRow(payment) && (
                      <button
                        onClick={() => openEditPayment(payment)}
                        className="btn-secondary mr-2 text-xs"
                      >
                        Edit
                      </button>
                    )}
                    {canReversePayments && !payment.isReversal && !isAlreadyReversed && (
                      <button
                        onClick={() => setReverseTarget(payment)}
                        className="btn-danger text-xs"
                        disabled={reverseLoadingId === payment.$id}
                      >
                        {reverseLoadingId === payment.$id ? "Reversing..." : "Reverse"}
                      </button>
                    )}
                  </div>
                </div>
              )})}
              {visiblePayments.length === 0 && (
                <div className="text-sm text-slate-500">
                  No payments recorded yet.
                </div>
              )}
            </div>
          </div>

          <AllocationPreviewPanel
            preview={preview}
            securityDepositApplied={previewState?.securityDepositApplied ?? 0}
            totalAmount={previewState?.totalAmount ?? 0}
          />
        </div>
      </div>

      <Modal
        open={canRecordPayments && modalOpen}
        title="New Payment"
        description="Preview allocation before confirming."
        onClose={() => setModalOpen(false)}
      >
          <PaymentForm
            tenants={tenants}
            payments={payments}
            onSubmit={handlePreview}
            disabled={loading}
            loading={loading}
          />
        </Modal>

      <ConfirmModal
        open={canRecordPayments && confirmOpen}
        title="Confirm Payment"
        description={
          previewState && previewState.securityDepositApplied > 0
            ? `This payment will first apply ${formatAmount(
                previewState.securityDepositApplied
              )} to security deposit, then apply the rest to arrears. Continue?`
            : "This payment will be saved and applied to arrears first. Continue?"
        }
        onCancel={() => setConfirmOpen(false)}
        onConfirm={handleConfirm}
        confirmLoading={confirmLoading}
      />
      <ConfirmModal
        open={canReversePayments && !!reverseTarget}
        title="Reverse Payment"
        description="This will create a reversal entry. Continue?"
        onCancel={() => setReverseTarget(null)}
        onConfirm={handleReverse}
        confirmLoading={reverseLoadingId === reverseTarget?.$id}
      />
      <Modal
        open={canRecordPayments && editOpen && !!editingPayment && !!editValues}
        title="Edit Payment"
        description="Update latest current-month payment details."
        onClose={() => {
          setEditOpen(false);
          setEditingPayment(null);
          setEditValues(null);
        }}
      >
        {editValues && (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSaveEdit();
            }}
          >
            <label className="block text-sm text-slate-300">
              Amount
              <input
                type="number"
                step="0.01"
                min="0.01"
                className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
                value={editValues.amount}
                onChange={(event) =>
                  setEditValues((prev) =>
                    prev
                      ? { ...prev, amount: Number(event.target.value) || 0 }
                      : prev
                  )
                }
                required
              />
            </label>
            <label className="block text-sm text-slate-300">
              Payment Method
              <select
                className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
                value={editValues.method}
                onChange={(event) =>
                  setEditValues((prev) =>
                    prev
                      ? { ...prev, method: event.target.value as "cash" | "bank" }
                      : prev
                  )
                }
                required
              >
                {PAYMENT_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {method === "cash" ? "Cash" : "Bank Deposit"}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm text-slate-300">
              Payment Date
              <input
                type="date"
                className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
                value={editValues.paymentDate}
                onChange={(event) =>
                  setEditValues((prev) =>
                    prev ? { ...prev, paymentDate: event.target.value } : prev
                  )
                }
                required
              />
            </label>
            <label className="block text-sm text-slate-300">
              Reference
              <input
                className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
                value={editValues.reference}
                onChange={(event) =>
                  setEditValues((prev) =>
                    prev ? { ...prev, reference: event.target.value } : prev
                  )
                }
              />
            </label>
            <label className="block text-sm text-slate-300">
              Payment Status Note
              <textarea
                rows={3}
                className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
                value={editValues.notes}
                onChange={(event) =>
                  setEditValues((prev) =>
                    prev ? { ...prev, notes: event.target.value } : prev
                  )
                }
              />
            </label>
            <div className="space-y-3 rounded-md border border-slate-700/60 bg-slate-950/40 p-3">
              <div className="text-sm text-slate-300">Receipt (optional)</div>
              {editingPayment?.receiptFileId ? (
                <div className="text-xs text-slate-400">
                  Current:{" "}
                  <a
                    href={storage.getFileView(
                      editingPayment.receiptBucketId?.trim() || rcmsReceiptsBucketId,
                      editingPayment.receiptFileId
                    )}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sky-300 underline"
                  >
                    {editingPayment.receiptFileName?.trim() || "View receipt"}
                  </a>{" "}
                  <span className="text-slate-500">
                    ({formatFileSize(editingPayment.receiptFileSize)})
                  </span>
                </div>
              ) : (
                <div className="text-xs text-slate-500">No receipt attached.</div>
              )}
              <label className="block text-xs text-slate-300">
                Replace receipt file
                <input
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp,.pdf,application/pdf,image/*"
                  className="mt-2 block w-full text-xs text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-slate-800 file:px-3 file:py-2 file:text-xs file:text-slate-100"
                  onChange={(event) => {
                    const nextFile = event.target.files?.item(0) ?? null;
                    setEditValues((prev) =>
                      prev
                        ? {
                            ...prev,
                            receiptFile: nextFile,
                            removeReceipt: nextFile ? false : prev.removeReceipt,
                          }
                        : prev
                    );
                  }}
                />
              </label>
              {editValues.receiptFile && (
                <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
                  <span>
                    Selected: {editValues.receiptFile.name} (
                    {formatFileSize(editValues.receiptFile.size)})
                  </span>
                  <button
                    type="button"
                    className="text-slate-300 underline"
                    onClick={() =>
                      setEditValues((prev) =>
                        prev ? { ...prev, receiptFile: null } : prev
                      )
                    }
                  >
                    Clear
                  </button>
                </div>
              )}
              {editingPayment?.receiptFileId && (
                <label className="flex items-center gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-500 bg-slate-900"
                    checked={editValues.removeReceipt}
                    disabled={Boolean(editValues.receiptFile)}
                    onChange={(event) =>
                      setEditValues((prev) =>
                        prev
                          ? {
                              ...prev,
                              removeReceipt: event.target.checked,
                            }
                          : prev
                      )
                    }
                  />
                  Remove current receipt
                </label>
              )}
            </div>
            <button
              type="submit"
              disabled={editSaving}
              className="btn-primary w-full text-sm disabled:opacity-60"
            >
              {editSaving ? "Saving..." : "Save Changes"}
            </button>
          </form>
        )}
      </Modal>
    </section>
  );
}

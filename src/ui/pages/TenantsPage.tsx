import { useEffect, useMemo, useState } from "react";
import { ID, Query } from "appwrite";
import { endOfMonth, subMonths } from "date-fns";
import { Link } from "react-router-dom";
import TenantDetail from "../tenants/TenantDetail";
import TenantForm from "../tenants/TenantForm";
import TenantList from "../tenants/TenantList";
import Modal from "../Modal";
import PaginationControls from "../PaginationControls";
import TypeaheadSearch from "../TypeaheadSearch";
import {
  createWorkspaceDocument,
  listAllDocuments,
  rcmsDatabaseId,
  updateScopedDocument,
} from "../../lib/appwrite";
import { COLLECTIONS } from "../../lib/schema";
import type {
  House,
  Payment,
  SecurityDepositDeduction,
  Tenant,
  TenantForm as TenantFormValues,
} from "../../lib/schema";
import { buildMonthSeries, buildPaidByMonth } from "../payments/allocation";
import { logAudit } from "../../lib/audit";
import { useAuth } from "../../auth/AuthContext";
import { useToast } from "../ToastContext";
import { buildRentByMonth } from "../../lib/rentHistory";
import { assessSecurityDepositRefund } from "../../lib/securityDeposit";
import { formatLimitValue, getLimitStatus } from "../../lib/planLimits";
import { sortHousesNatural } from "../../lib/houseSort";

type PanelMode = "list" | "create" | "edit";

export default function TenantsPage() {
  const { user, permissions, planLimits } = useAuth();
  const canManageTenants = permissions.canManageTenants;
  const toast = useToast();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [houses, setHouses] = useState<House[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [selected, setSelected] = useState<Tenant | null>(null);
  const [mode, setMode] = useState<PanelMode>("list");
  const [statusOpen, setStatusOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [arrearsFilter, setArrearsFilter] = useState<"all" | "with" | "without">("all");
  const [moveOutFilter, setMoveOutFilter] = useState<"all" | "moved" | "current">("all");
  const [tenantSearchQuery, setTenantSearchQuery] = useState("");
  const [tenantPage, setTenantPage] = useState(1);
  const [tenantPageSize, setTenantPageSize] = useState(20);

  const sortedTenants = useMemo(() => {
    const houseLookup = new Map(houses.map((house) => [house.$id, house]));
    const today = new Date();
    const arrearsCutoffDate = endOfMonth(subMonths(today, 1));

    return [...tenants]
      .filter((tenant) => {
        if (statusFilter !== "all" && tenant.status !== statusFilter) return false;
        if (moveOutFilter === "moved" && !tenant.moveOutDate) return false;
        if (moveOutFilter === "current" && tenant.moveOutDate) return false;
        if (arrearsFilter !== "all") {
          if (tenant.status !== "active" || tenant.moveOutDate) {
            return false;
          }
          const houseId =
            typeof tenant.house === "string" ? tenant.house : tenant.house?.$id ?? "";
          const house = houseLookup.get(houseId);
          const tenantPayments = payments.filter((payment) => {
            const paymentTenantId =
              typeof payment.tenant === "string" ? payment.tenant : payment.tenant?.$id;
            return paymentTenantId === tenant.$id;
          });
          const months = buildMonthSeries(tenant.moveInDate, arrearsCutoffDate);
          const paidByMonth = buildPaidByMonth(tenantPayments);
          const rentByMonth = buildRentByMonth({
            months,
            houseHistoryJson: house?.rentHistoryJson ?? null,
            fallbackRent: house?.monthlyRent ?? 0,
            occupancyStartDate: tenant.moveInDate,
            occupancyEndDate: arrearsCutoffDate.toISOString().slice(0, 10),
          });
          const expected = months.reduce(
            (sum, month) => sum + (rentByMonth[month] ?? 0),
            0
          );
          const paid = months.reduce((sum, month) => sum + (paidByMonth[month] ?? 0), 0);
          const hasArrears = paid + 0.01 < expected;
          if (arrearsFilter === "with" && !hasArrears) return false;
          if (arrearsFilter === "without" && hasArrears) return false;
        }
        return true;
      })
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [arrearsFilter, houses, payments, statusFilter, tenants, moveOutFilter]);
  const houseLookup = useMemo(
    () => new Map(houses.map((house) => [house.$id, house])),
    [houses]
  );
  const filteredTenants = useMemo(() => {
    const query = tenantSearchQuery.trim().toLowerCase();
    if (!query) return sortedTenants;
    return sortedTenants.filter((tenant) => {
      const houseId =
        typeof tenant.house === "string" ? tenant.house : tenant.house?.$id ?? "";
      const houseCode =
        houseLookup.get(houseId)?.code?.toLowerCase() ??
        (typeof tenant.house === "object" ? tenant.house?.code?.toLowerCase() ?? "" : "");
      const name = tenant.fullName?.toLowerCase() ?? "";
      const phone = tenant.phone?.toLowerCase() ?? "";
      const moveInDate = tenant.moveInDate?.slice(0, 10) ?? "";
      const moveOutDate = tenant.moveOutDate?.slice(0, 10) ?? "";
      const status = tenant.status?.toLowerCase() ?? "";
      return (
        name.includes(query) ||
        phone.includes(query) ||
        houseCode.includes(query) ||
        moveInDate.includes(query) ||
        moveOutDate.includes(query) ||
        status.includes(query)
      );
    });
  }, [houseLookup, sortedTenants, tenantSearchQuery]);
  const paginatedTenants = useMemo(() => {
    const start = (tenantPage - 1) * tenantPageSize;
    return filteredTenants.slice(start, start + tenantPageSize);
  }, [filteredTenants, tenantPage, tenantPageSize]);
  const tenantSearchSuggestions = useMemo(() => {
    const values = new Set<string>();
    sortedTenants.forEach((tenant) => {
      values.add(tenant.fullName);
      if (tenant.phone?.trim()) values.add(tenant.phone.trim());
      const houseId =
        typeof tenant.house === "string" ? tenant.house : tenant.house?.$id ?? "";
      const houseCode =
        houseLookup.get(houseId)?.code ??
        (typeof tenant.house === "object" ? tenant.house?.code : "");
      if (houseCode?.trim()) values.add(houseCode.trim());
      if (tenant.moveInDate) values.add(tenant.moveInDate.slice(0, 10));
    });
    return Array.from(values);
  }, [houseLookup, sortedTenants]);
  const activeTenantCount = useMemo(
    () => tenants.filter((tenant) => tenant.status === "active" && !tenant.moveOutDate).length,
    [tenants]
  );
  const activeTenantLimitStatus = useMemo(
    () => getLimitStatus(planLimits.maxActiveTenants, activeTenantCount),
    [activeTenantCount, planLimits.maxActiveTenants]
  );

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [tenantResult, houseResult, paymentResult] = await Promise.all([
        listAllDocuments<Tenant>({
          databaseId: rcmsDatabaseId,
          collectionId: COLLECTIONS.tenants,
          queries: [
            Query.orderAsc("fullName"),
          ],
        }),
        listAllDocuments<House>({
          databaseId: rcmsDatabaseId,
          collectionId: COLLECTIONS.houses,
          queries: [
            Query.orderAsc("code"),
          ],
        }),
        listAllDocuments<Payment>({
          databaseId: rcmsDatabaseId,
          collectionId: COLLECTIONS.payments,
          queries: [
            Query.orderDesc("paymentDate"),
          ],
        }),
      ]);
      setTenants(tenantResult);
      setHouses(sortHousesNatural(houseResult));
      setPayments(paymentResult);
    } catch (err) {
      setError("Failed to load tenants.");
    } finally {
      setLoading(false);
    }
  };

  const normalizeTenantPayload = (values: TenantFormValues) => {
    const moveOutInput = values.moveOutDate?.trim() ? values.moveOutDate : null;
    const status = moveOutInput ? "inactive" : values.status;
    const moveOutDate =
      status === "inactive"
        ? moveOutInput ?? new Date().toISOString().slice(0, 10)
        : null;
    return {
      ...values,
      tenantType: values.tenantType === "old" ? "old" : "new",
      status,
      phone: values.phone?.trim() ? values.phone.trim() : null,
      moveOutDate,
      rentOverride:
        typeof values.rentOverride === "number" && Number.isFinite(values.rentOverride)
          ? values.rentOverride
          : null,
      notes: values.notes?.trim() ? values.notes.trim() : null,
    };
  };

  const ensureAssignableHouse = (
    houseId: string,
    existingTenant?: Tenant | null
  ): { ok: true; house: House } | { ok: false; message: string } => {
    const house = houses.find((item) => item.$id === houseId);
    if (!house) {
      return { ok: false, message: "Selected house was not found. Refresh and try again." };
    }
    const existingHouseId =
      existingTenant && existingTenant.house
        ? typeof existingTenant.house === "string"
          ? existingTenant.house
          : existingTenant.house?.$id ?? ""
        : "";
    if (existingHouseId && houseId === existingHouseId) {
      return { ok: true, house };
    }
    if (house.status !== "vacant") {
      return { ok: false, message: "Only vacant houses can be assigned to a tenant." };
    }
    return { ok: true, house };
  };

  const syncHouseOccupancy = async (
    houseId: string,
    options?: { preferredTenantId?: string }
  ) => {
    const house = houses.find((item) => item.$id === houseId);
    if (!house) return;

    const houseTenants = await listAllDocuments<Tenant>({
      databaseId: rcmsDatabaseId,
      collectionId: COLLECTIONS.tenants,
      queries: [Query.equal("house", [houseId]), Query.orderAsc("fullName")],
    });
    const activeCurrentTenants = houseTenants.filter(
      (tenant) => tenant.status === "active" && !tenant.moveOutDate
    );
    const preferredTenant = options?.preferredTenantId
      ? activeCurrentTenants.find((tenant) => tenant.$id === options.preferredTenantId)
      : null;
    const occupant = preferredTenant ?? activeCurrentTenants[0] ?? null;
    const nextStatus = occupant
      ? "occupied"
      : house.status === "inactive"
        ? "inactive"
        : "vacant";
    const nextCurrentTenantId = occupant?.$id ?? null;

    if (
      house.status === nextStatus &&
      (house.currentTenantId ?? null) === nextCurrentTenantId
    ) {
      return;
    }

    const updatedHouse = await updateScopedDocument<
      { status: string; currentTenantId: string | null },
      House
    >({
      databaseId: rcmsDatabaseId,
      collectionId: COLLECTIONS.houses,
      documentId: houseId,
      data: {
        status: nextStatus,
        currentTenantId: nextCurrentTenantId,
      },
    });
    setHouses((prev) =>
      prev.map((item) =>
        item.$id === houseId ? (updatedHouse as unknown as House) : item
      )
    );
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    setTenantPage(1);
  }, [tenantSearchQuery, statusFilter, arrearsFilter, moveOutFilter]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(filteredTenants.length / tenantPageSize));
    if (tenantPage > totalPages) {
      setTenantPage(totalPages);
    }
  }, [filteredTenants.length, tenantPage, tenantPageSize]);

  const handleSelect = (tenant: Tenant) => {
    setSelected(tenant);
    setMode("list");
  };

  const handleView = (tenant: Tenant) => {
    setSelected(tenant);
    setMode("list");
    setStatusOpen(true);
  };

  const handleCreate = async (values: TenantFormValues) => {
    if (!canManageTenants) {
      toast.push("warning", "You do not have permission to create tenants.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const normalized = normalizeTenantPayload(values);
      if (normalized.status === "active" && activeTenantLimitStatus.reached) {
        const message =
          "Active tenant limit reached on your current plan. Open Billing to add more active tenants.";
        setError(message);
        toast.push("warning", message);
        setLoading(false);
        return;
      }
      const houseId = normalized.house;
      const assignable = ensureAssignableHouse(houseId);
      if (!assignable.ok) {
        setError(assignable.message);
        toast.push("warning", assignable.message);
        setLoading(false);
        return;
      }
      const house = assignable.house;
      const rent = house?.monthlyRent ?? 0;
      const securityDepositAmount = normalized.tenantType === "new" ? rent : 0;
      const payload = {
        ...normalized,
        securityDepositRequired: normalized.tenantType === "new",
        securityDepositAmount,
        securityDepositPaid: 0,
        securityDepositBalance: securityDepositAmount,
        securityDepositRefunded: false,
        rentHistoryJson: null,
      };
      const created = await createWorkspaceDocument({
        databaseId: rcmsDatabaseId,
        collectionId: COLLECTIONS.tenants,
        documentId: ID.unique(),
        data: payload,
      });
      const createdTenant = created as unknown as Tenant;
      const createdHouseId =
        typeof createdTenant.house === "string"
          ? createdTenant.house
          : createdTenant.house?.$id ?? normalized.house;
      if (createdHouseId) {
        await syncHouseOccupancy(createdHouseId, {
          preferredTenantId:
            createdTenant.status === "active" && !createdTenant.moveOutDate
              ? createdTenant.$id
              : undefined,
        });
      }
      setTenants((prev) => [...prev, createdTenant]);
      setSelected(createdTenant);
      setMode("list");
      setModalOpen(false);
      toast.push("success", "Tenant created.");
      if (user) {
        void logAudit({
          entityType: "tenant",
          entityId: createdTenant.$id,
          action: "create",
          actorId: user.id,
          details: payload,
        });
      }
    } catch (err) {
      setError("Failed to create tenant.");
      toast.push("error", "Failed to create tenant.");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdate = async (values: TenantFormValues) => {
    if (!selected) return;
    if (!canManageTenants) {
      toast.push("warning", "You do not have permission to edit tenants.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const normalized = normalizeTenantPayload(values);
      const selectedIsActive =
        selected.status === "active" && !selected.moveOutDate;
      const nextIsActive =
        normalized.status === "active" && !normalized.moveOutDate;
      if (!selectedIsActive && nextIsActive && activeTenantLimitStatus.reached) {
        const message =
          "Active tenant limit reached on your current plan. Open Billing to activate more tenants.";
        setError(message);
        toast.push("warning", message);
        setLoading(false);
        return;
      }
      const houseId = normalized.house;
      const assignable = ensureAssignableHouse(houseId, selected);
      if (!assignable.ok) {
        setError(assignable.message);
        toast.push("warning", assignable.message);
        setLoading(false);
        return;
      }
      const house = assignable.house;
      const selectedHouseId =
        typeof selected.house === "string" ? selected.house : selected.house?.$id ?? "";
      const newRent = house?.monthlyRent ?? 0;
      const tenantType = normalized.tenantType ?? selected.tenantType ?? "old";
      const preservedRentOverride =
        typeof normalized.rentOverride === "number" &&
        Number.isFinite(normalized.rentOverride)
          ? normalized.rentOverride
          : selected.rentOverride ?? null;
      const currentDepositAmount =
        typeof selected.securityDepositAmount === "number" &&
        Number.isFinite(selected.securityDepositAmount)
          ? selected.securityDepositAmount
          : 0;
      const currentDepositPaid =
        typeof selected.securityDepositPaid === "number" &&
        Number.isFinite(selected.securityDepositPaid)
          ? selected.securityDepositPaid
          : 0;
      const nextDepositAmount =
        tenantType === "new"
          ? currentDepositAmount > 0
            ? currentDepositAmount
            : newRent
          : 0;
      const nextDepositPaid =
        tenantType === "new"
          ? Math.min(Math.max(currentDepositPaid, 0), nextDepositAmount)
          : 0;
      const nextDepositBalance =
        tenantType === "new"
          ? Math.max(nextDepositAmount - nextDepositPaid, 0)
          : 0;
      const nextRentHistoryJson = selected.rentHistoryJson ?? null;
      let nextSecurityDepositRefunded =
        tenantType === "new" ? Boolean(selected.securityDepositRefunded) : false;
      const moveOutJustSet = Boolean(normalized.moveOutDate) && !selected.moveOutDate;

      if (moveOutJustSet && tenantType === "new" && !nextSecurityDepositRefunded) {
        const tenantPayments = payments.filter((payment) => {
          const paymentTenantId =
            typeof payment.tenant === "string" ? payment.tenant : payment.tenant?.$id;
          return paymentTenantId === selected.$id;
        });
        let deductionRows: SecurityDepositDeduction[] | null = null;
        try {
          deductionRows = await listAllDocuments<SecurityDepositDeduction>({
            databaseId: rcmsDatabaseId,
            collectionId: COLLECTIONS.securityDepositDeductions,
            queries: [Query.equal("tenantId", [selected.$id])],
          });
        } catch {
          deductionRows = null;
        }

        if (!deductionRows) {
          toast.push(
            "warning",
            "Auto refund skipped: unable to load deposit deductions."
          );
        } else {
          const tenantForAssessment: Tenant = {
            ...selected,
            ...normalized,
            moveOutDate: normalized.moveOutDate ?? undefined,
            tenantType,
            securityDepositRequired: tenantType === "new",
            securityDepositAmount: nextDepositAmount,
            securityDepositPaid: nextDepositPaid,
            securityDepositBalance: nextDepositBalance,
            rentHistoryJson: nextRentHistoryJson ?? undefined,
            phone: normalized.phone ?? undefined,
            rentOverride: preservedRentOverride ?? undefined,
            notes: normalized.notes ?? undefined,
          };
          const assessment = assessSecurityDepositRefund({
            tenant: tenantForAssessment,
            house,
            payments: tenantPayments,
            deductions: deductionRows,
            asOfDate: normalized.moveOutDate ?? null,
          });
          if (assessment.canRefund) {
            nextSecurityDepositRefunded = true;
          }
        }
      }

      const payload = {
        ...normalized,
        rentOverride: preservedRentOverride,
        tenantType,
        securityDepositRequired: tenantType === "new",
        securityDepositAmount: nextDepositAmount,
        securityDepositPaid: nextDepositPaid,
        securityDepositBalance: nextDepositBalance,
        securityDepositRefunded: nextSecurityDepositRefunded,
        rentHistoryJson: nextRentHistoryJson,
      };
      const updated = await updateScopedDocument<typeof payload, Tenant>({
        databaseId: rcmsDatabaseId,
        collectionId: COLLECTIONS.tenants,
        documentId: selected.$id,
        data: payload,
      });
      const updatedTenant = updated as unknown as Tenant;
      const updatedHouseId =
        typeof updatedTenant.house === "string"
          ? updatedTenant.house
          : updatedTenant.house?.$id ?? normalized.house;
      const houseIdsToSync = new Set<string>();
      if (selectedHouseId) houseIdsToSync.add(selectedHouseId);
      if (updatedHouseId) houseIdsToSync.add(updatedHouseId);
      await Promise.all(
        Array.from(houseIdsToSync).map((houseId) =>
          syncHouseOccupancy(houseId, {
            preferredTenantId:
              houseId === updatedHouseId &&
              updatedTenant.status === "active" &&
              !updatedTenant.moveOutDate
                ? updatedTenant.$id
                : undefined,
          })
        )
      );
      setTenants((prev) =>
        prev.map((tenant) =>
          tenant.$id === selected.$id ? updatedTenant : tenant
        )
      );
      setSelected(updatedTenant);
      setMode("list");
      setModalOpen(false);
      toast.push("success", "Tenant updated.");
      if (user) {
        void logAudit({
          entityType: "tenant",
          entityId: updatedTenant.$id,
          action: "update",
          actorId: user.id,
          details: payload,
        });
      }
    } catch (err) {
      setError("Failed to update tenant.");
      toast.push("error", "Failed to update tenant.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="space-y-6">
      <header>
        <div className="text-sm text-slate-500">Tenants</div>
        <h3 className="mt-2 text-xl font-semibold text-white">
          Tenant Directory
        </h3>
        <p className="mt-1 text-sm text-slate-500">
          Search and review tenant details.
        </p>
      </header>

      <div className="grid gap-6 xl:grid-cols-[2.2fr_1fr]">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-100">Tenant List</div>
              <div className="text-xs text-slate-500">
                {loading
                  ? "Loading..."
                  : `${filteredTenants.length} of ${tenants.length} tenants`}
              </div>
              {planLimits.maxActiveTenants != null && (
                <div className="mt-1 text-xs text-amber-300">
                  Active tenant usage: {activeTenantLimitStatus.used.toLocaleString()} /{" "}
                  {formatLimitValue(activeTenantLimitStatus.limit)}
                  {activeTenantLimitStatus.reached ? " (limit reached)" : ""}
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {canManageTenants && (
                <button
                  onClick={() => {
                    setMode("create");
                    setModalOpen(true);
                  }}
                  disabled={activeTenantLimitStatus.reached}
                  className="btn-primary text-sm disabled:opacity-60"
                >
                  {activeTenantLimitStatus.reached ? "Add Tenant (Locked)" : "Add Tenant"}
                </button>
              )}
              {canManageTenants && activeTenantLimitStatus.reached ? (
                <Link to="/app/billing" className="btn-secondary text-sm">
                  Open Billing
                </Link>
              ) : null}
              <button
                onClick={loadData}
                className="btn-secondary text-sm"
              >
                Refresh
              </button>
            </div>
          </div>

          <div
            className="flex flex-wrap gap-3 rounded-2xl border p-4 text-sm text-slate-300"
            style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
          >
            <label>
              Status
              <select
                className="input-base ml-3 rounded-md px-3 py-2 text-sm"
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as typeof statusFilter)
                }
              >
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
            <label>
              Arrears
              <select
                className="input-base ml-3 rounded-md px-3 py-2 text-sm"
                value={arrearsFilter}
                onChange={(event) =>
                  setArrearsFilter(event.target.value as typeof arrearsFilter)
                }
              >
                <option value="all">All</option>
                <option value="with">With Arrears</option>
                <option value="without">No Arrears</option>
              </select>
            </label>
            <label>
              Move-out
              <select
                className="input-base ml-3 rounded-md px-3 py-2 text-sm"
                value={moveOutFilter}
                onChange={(event) =>
                  setMoveOutFilter(event.target.value as typeof moveOutFilter)
                }
              >
                <option value="all">All</option>
                <option value="current">Current</option>
                <option value="moved">Moved Out</option>
              </select>
            </label>
          </div>
          <TypeaheadSearch
            label="Find Tenant"
            placeholder="Search by name, phone, house code, date, or status"
            query={tenantSearchQuery}
            suggestions={tenantSearchSuggestions}
            onQueryChange={setTenantSearchQuery}
          />

          {error && (
            <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {error}
            </div>
          )}

          <TenantList
            tenants={paginatedTenants}
            houses={houses}
            selectedId={selected?.$id}
            onSelect={handleSelect}
            onEdit={
              canManageTenants
                ? (tenant) => {
                    setSelected(tenant);
                    setMode("edit");
                    setModalOpen(true);
                  }
                : undefined
            }
            onView={handleView}
            canManage={canManageTenants}
          />
          <PaginationControls
            page={tenantPage}
            pageSize={tenantPageSize}
            totalItems={filteredTenants.length}
            onPageChange={setTenantPage}
            onPageSizeChange={(size) => {
              setTenantPageSize(size);
              setTenantPage(1);
            }}
          />
        </div>

        <div className="space-y-6">
          {mode === "list" && (
            <TenantDetail
              tenant={selected}
              houses={houses}
              payments={payments}
              statusOpen={statusOpen}
              onOpenStatus={() => setStatusOpen(true)}
              onCloseStatus={() => setStatusOpen(false)}
            />
          )}
        </div>
      </div>

      <Modal
        open={canManageTenants && modalOpen}
        title={mode === "edit" ? "Edit Tenant" : "New Tenant"}
        description={
          mode === "edit"
            ? "Update tenant details and assignment."
            : "Capture tenant profile and house assignment."
        }
        onClose={() => {
          setModalOpen(false);
          setMode("list");
        }}
      >
        <TenantForm
          houses={houses}
          initial={mode === "edit" ? selected : null}
          onSubmit={mode === "edit" ? handleUpdate : handleCreate}
          onCancel={() => {
            setModalOpen(false);
            setMode("list");
          }}
          disabled={loading}
          loading={loading}
        />
      </Modal>
    </section>
  );
}

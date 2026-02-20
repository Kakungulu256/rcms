import { useEffect, useMemo, useState } from "react";
import { ID, Query } from "appwrite";
import TenantDetail from "../tenants/TenantDetail";
import TenantForm from "../tenants/TenantForm";
import TenantList from "../tenants/TenantList";
import Modal from "../Modal";
import { databases, listAllDocuments, rcmsDatabaseId } from "../../lib/appwrite";
import { COLLECTIONS } from "../../lib/schema";
import type {
  House,
  Payment,
  Tenant,
  TenantForm as TenantFormValues,
} from "../../lib/schema";
import { buildMonthSeries, buildPaidByMonth } from "../payments/allocation";
import { logAudit } from "../../lib/audit";
import { useAuth } from "../../auth/AuthContext";
import { useToast } from "../ToastContext";
import { appendRentHistory, buildRentByMonth } from "../../lib/rentHistory";

type PanelMode = "list" | "create" | "edit";

type TenantFormWithEffectiveDate = TenantFormValues & {
  rentEffectiveDate?: string;
};

export default function TenantsPage() {
  const { user, permissions } = useAuth();
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

  const sortedTenants = useMemo(() => {
    const houseLookup = new Map(houses.map((house) => [house.$id, house]));
    const today = new Date();

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
          const months = buildMonthSeries(tenant.moveInDate, today);
          const paidByMonth = buildPaidByMonth(tenantPayments);
          const rentByMonth = buildRentByMonth({
            months,
            tenantHistoryJson: tenant.rentHistoryJson ?? null,
            houseHistoryJson: house?.rentHistoryJson ?? null,
            fallbackRent: tenant.rentOverride ?? house?.monthlyRent ?? 0,
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
      setHouses(houseResult);
      setPayments(paymentResult);
    } catch (err) {
      setError("Failed to load tenants.");
    } finally {
      setLoading(false);
    }
  };

  const normalizeTenantPayload = (values: TenantFormValues) => ({
    ...values,
    phone: values.phone?.trim() ? values.phone.trim() : null,
    moveOutDate: values.moveOutDate?.trim() ? values.moveOutDate : null,
    rentOverride:
      typeof values.rentOverride === "number" && Number.isFinite(values.rentOverride)
        ? values.rentOverride
        : null,
    notes: values.notes?.trim() ? values.notes.trim() : null,
  });

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

    const updatedHouse = await databases.updateDocument(
      rcmsDatabaseId,
      COLLECTIONS.houses,
      houseId,
      {
        status: nextStatus,
        currentTenantId: nextCurrentTenantId,
      }
    );
    setHouses((prev) =>
      prev.map((item) =>
        item.$id === houseId ? (updatedHouse as unknown as House) : item
      )
    );
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSelect = (tenant: Tenant) => {
    setSelected(tenant);
    setMode("list");
  };

  const handleView = (tenant: Tenant) => {
    setSelected(tenant);
    setMode("list");
    setStatusOpen(true);
  };

  const handleCreate = async (values: TenantFormWithEffectiveDate) => {
    if (!canManageTenants) {
      toast.push("warning", "You do not have permission to create tenants.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { rentEffectiveDate, ...rest } = values;
      const normalized = normalizeTenantPayload(rest);
      const houseId = normalized.house;
      const house = houses.find((item) => item.$id === houseId);
      const rent = normalized.rentOverride ?? house?.monthlyRent ?? 0;
      const effectiveDate = rentEffectiveDate?.trim() || normalized.moveInDate;
      const payload = {
        ...normalized,
        rentHistoryJson:
          normalized.rentOverride != null
            ? appendRentHistory(null, {
                effectiveDate,
                amount: rent,
                source: "override",
              })
            : null,
      };
      const created = await databases.createDocument(
        rcmsDatabaseId,
        COLLECTIONS.tenants,
        ID.unique(),
        payload
      );
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

  const handleUpdate = async (values: TenantFormWithEffectiveDate) => {
    if (!selected) return;
    if (!canManageTenants) {
      toast.push("warning", "You do not have permission to edit tenants.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { rentEffectiveDate, ...rest } = values;
      const normalized = normalizeTenantPayload(rest);
      const houseId = normalized.house;
      const house = houses.find((item) => item.$id === houseId);
      const selectedHouseId =
        typeof selected.house === "string" ? selected.house : selected.house?.$id ?? "";
      const previousHouse = houses.find((item) => item.$id === selectedHouseId);
      const newRent = normalized.rentOverride ?? house?.monthlyRent ?? 0;
      const previousRent =
        selected.rentOverride ?? previousHouse?.monthlyRent ?? 0;
      const rentChanged = newRent !== previousRent;
      const hasRentEffectiveDate = Boolean(rentEffectiveDate?.trim());
      const effectiveDate =
        rentEffectiveDate?.trim() || new Date().toISOString().slice(0, 10);
      if (rentChanged && !hasRentEffectiveDate) {
        setError("Provide a rent effective date for the new rate.");
        setLoading(false);
        return;
      }
      const payload = {
        ...normalized,
        rentHistoryJson: rentChanged
          ? normalized.rentOverride != null
            ? appendRentHistory(selected.rentHistoryJson ?? null, {
                effectiveDate,
                amount: newRent,
                source: "override",
              })
            : selected.rentHistoryJson ?? null
          : selected.rentHistoryJson ?? null,
      };
      const updated = await databases.updateDocument(
        rcmsDatabaseId,
        COLLECTIONS.tenants,
        selected.$id,
        payload
      );
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

      <div className="grid gap-6 lg:grid-cols-[2.2fr_1fr]">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-100">Tenant List</div>
              <div className="text-xs text-slate-500">
                {loading ? "Loading..." : `${tenants.length} tenants`}
              </div>
            </div>
            <div className="flex gap-2">
              {canManageTenants && (
                <button
                  onClick={() => {
                    setMode("create");
                    setModalOpen(true);
                  }}
                  className="btn-primary text-sm"
                >
                  Add Tenant
                </button>
              )}
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

          {error && (
            <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {error}
            </div>
          )}

          <TenantList
            tenants={sortedTenants}
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

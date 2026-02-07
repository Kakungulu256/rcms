import { useEffect, useMemo, useState } from "react";
import { ID, Query } from "appwrite";
import TenantDetail from "../tenants/TenantDetail";
import TenantForm from "../tenants/TenantForm";
import TenantList from "../tenants/TenantList";
import Modal from "../Modal";
import { databases, rcmsDatabaseId } from "../../lib/appwrite";
import { COLLECTIONS } from "../../lib/schema";
import type {
  House,
  Payment,
  Tenant,
  TenantForm as TenantFormValues,
} from "../../lib/schema";
import { buildPaidByMonth } from "../payments/allocation";
import { logAudit } from "../../lib/audit";
import { useAuth } from "../../auth/AuthContext";
import { useToast } from "../ToastContext";
import { appendRentHistory } from "../../lib/rentHistory";

type PanelMode = "list" | "create" | "edit";

type TenantFormWithEffectiveDate = TenantFormValues & {
  rentEffectiveDate?: string;
};

export default function TenantsPage() {
  const { user } = useAuth();
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
    const paidByTenant = new Map<string, number>();
    const rentByTenant = new Map<string, number>();
    const houseLookup = new Map(houses.map((house) => [house.$id, house]));

    tenants.forEach((tenant) => {
      const houseId =
        typeof tenant.house === "string" ? tenant.house : tenant.house?.$id ?? "";
      const rent = tenant.rentOverride ?? houseLookup.get(houseId)?.monthlyRent ?? 0;
      rentByTenant.set(tenant.$id, rent);

      const tenantPayments = payments.filter((payment) => {
        const paymentTenantId =
          typeof payment.tenant === "string" ? payment.tenant : payment.tenant?.$id;
        return paymentTenantId === tenant.$id;
      });
      const paidByMonth = buildPaidByMonth(tenantPayments);
      const paid = Object.values(paidByMonth).reduce((sum, value) => sum + value, 0);
      paidByTenant.set(tenant.$id, paid);
    });

    return [...tenants]
      .filter((tenant) => {
        if (statusFilter !== "all" && tenant.status !== statusFilter) return false;
        if (moveOutFilter === "moved" && !tenant.moveOutDate) return false;
        if (moveOutFilter === "current" && tenant.moveOutDate) return false;
        if (arrearsFilter !== "all") {
          if (tenant.status !== "active" || tenant.moveOutDate) {
            return false;
          }
          const rent = rentByTenant.get(tenant.$id) ?? 0;
          const paid = paidByTenant.get(tenant.$id) ?? 0;
          const moveIn = tenant.moveInDate ? new Date(tenant.moveInDate) : null;
          const endDate = new Date();
          const months =
            moveIn
              ? Math.max(
                  1,
                  (endDate.getFullYear() - moveIn.getFullYear()) * 12 +
                    (endDate.getMonth() - moveIn.getMonth()) +
                    1
                )
              : 0;
          const expected = rent * months;
          const hasArrears = paid < expected;
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
        databases.listDocuments(rcmsDatabaseId, COLLECTIONS.tenants, [
          Query.orderAsc("fullName"),
        ]),
        databases.listDocuments(rcmsDatabaseId, COLLECTIONS.houses, [
          Query.orderAsc("code"),
        ]),
        databases.listDocuments(rcmsDatabaseId, COLLECTIONS.payments, [
          Query.orderDesc("paymentDate"),
        ]),
      ]);
      setTenants(tenantResult.documents as Tenant[]);
      setHouses(houseResult.documents as House[]);
      setPayments(paymentResult.documents as Payment[]);
    } catch (err) {
      setError("Failed to load tenants.");
    } finally {
      setLoading(false);
    }
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
    setLoading(true);
    setError(null);
    try {
      const { rentEffectiveDate, ...rest } = values;
      const houseId = rest.house;
      const house = houses.find((item) => item.$id === houseId);
      const rent = rest.rentOverride ?? house?.monthlyRent ?? 0;
      const effectiveDate = rentEffectiveDate ?? rest.moveInDate;
      const payload = {
        ...rest,
        rentHistoryJson: appendRentHistory(null, {
          effectiveDate,
          amount: rent,
          source: rest.rentOverride != null ? "override" : "house",
        }),
      };
      const created = await databases.createDocument(
        rcmsDatabaseId,
        COLLECTIONS.tenants,
        ID.unique(),
        payload
      );
      setTenants((prev) => [...prev, created as Tenant]);
      setSelected(created as Tenant);
      setMode("list");
      setModalOpen(false);
      toast.push("success", "Tenant created.");
      if (user) {
        void logAudit({
          entityType: "tenant",
          entityId: (created as Tenant).$id,
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
    setLoading(true);
    setError(null);
    try {
      const { rentEffectiveDate, ...rest } = values;
      const houseId = rest.house;
      const house = houses.find((item) => item.$id === houseId);
      const newRent = rest.rentOverride ?? house?.monthlyRent ?? 0;
      const previousRent =
        selected.rentOverride ?? house?.monthlyRent ?? 0;
      const rentChanged = newRent !== previousRent;
      const effectiveDate =
        rentEffectiveDate ?? new Date().toISOString().slice(0, 10);
      if (rentChanged && !rentEffectiveDate) {
        setError("Provide a rent effective date for the new rate.");
        setLoading(false);
        return;
      }
      const payload = {
        ...rest,
        rentHistoryJson: rentChanged
          ? appendRentHistory(selected.rentHistoryJson ?? null, {
              effectiveDate,
              amount: newRent,
              source: rest.rentOverride != null ? "override" : "house",
            })
          : selected.rentHistoryJson ?? null,
      };
      const updated = await databases.updateDocument(
        rcmsDatabaseId,
        COLLECTIONS.tenants,
        selected.$id,
        payload
      );
      setTenants((prev) =>
        prev.map((tenant) =>
          tenant.$id === selected.$id ? (updated as Tenant) : tenant
        )
      );
      setSelected(updated as Tenant);
      setMode("list");
      setModalOpen(false);
      toast.push("success", "Tenant updated.");
      if (user) {
        void logAudit({
          entityType: "tenant",
          entityId: (updated as Tenant).$id,
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
              <button
                onClick={() => {
                  setMode("create");
                  setModalOpen(true);
                }}
                className="btn-primary text-sm"
              >
                Add Tenant
              </button>
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
            onEdit={(tenant) => {
              setSelected(tenant);
              setMode("edit");
              setModalOpen(true);
            }}
            onView={handleView}
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
        open={modalOpen}
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

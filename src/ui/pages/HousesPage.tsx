import { useEffect, useMemo, useState } from "react";
import { ID, Query } from "appwrite";
import HouseDetail from "../houses/HouseDetail";
import HouseForm from "../houses/HouseForm";
import HouseList from "../houses/HouseList";
import Modal from "../Modal";
import { databases, rcmsDatabaseId } from "../../lib/appwrite";
import { COLLECTIONS } from "../../lib/schema";
import type { House, HouseForm as HouseFormValues, Tenant } from "../../lib/schema";
import { logAudit } from "../../lib/audit";
import { useAuth } from "../../auth/AuthContext";
import { useToast } from "../ToastContext";
import { appendRentHistory } from "../../lib/rentHistory";

type PanelMode = "list" | "create" | "edit";

type HouseFormWithEffectiveDate = HouseFormValues & {
  rentEffectiveDate?: string;
};

export default function HousesPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [houses, setHouses] = useState<House[]>([]);
  const [selected, setSelected] = useState<House | null>(null);
  const [mode, setMode] = useState<PanelMode>("list");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const sortedHouses = useMemo(
    () => [...houses].sort((a, b) => a.code.localeCompare(b.code)),
    [houses]
  );

  const loadHouses = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await databases.listDocuments(
        rcmsDatabaseId,
        COLLECTIONS.houses,
        [Query.orderAsc("code")]
      );
      setHouses(result.documents as House[]);
    } catch (err) {
      setError("Failed to load houses.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadHouses();
  }, []);

  const handleSelect = (house: House) => {
    setSelected(house);
    setMode("list");
  };

  const handleCreate = async (values: HouseFormWithEffectiveDate) => {
    setLoading(true);
    setError(null);
    try {
      const { rentEffectiveDate, ...rest } = values;
      const effectiveDate =
        rentEffectiveDate ?? new Date().toISOString().slice(0, 10);
      const created = await databases.createDocument(
        rcmsDatabaseId,
        COLLECTIONS.houses,
        ID.unique(),
        {
          ...rest,
          rentHistoryJson: appendRentHistory(null, {
            effectiveDate,
            amount: rest.monthlyRent,
            source: "house",
          }),
        }
      );
      setHouses((prev) => [...prev, created as House]);
      setSelected(created as House);
      setMode("list");
      setModalOpen(false);
      toast.push("success", "House created.");
      if (user) {
        void logAudit({
          entityType: "house",
          entityId: (created as House).$id,
          action: "create",
          actorId: user.id,
          details: values,
        });
      }
    } catch (err) {
      setError("Failed to create house.");
      toast.push("error", "Failed to create house.");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdate = async (values: HouseFormWithEffectiveDate) => {
    if (!selected) return;
    setLoading(true);
    setError(null);
    try {
      const { rentEffectiveDate, ...rest } = values;
      const rentChanged = rest.monthlyRent !== selected.monthlyRent;
      const effectiveDate =
        rentEffectiveDate ?? new Date().toISOString().slice(0, 10);
      if (rentChanged && !rentEffectiveDate) {
        setError("Provide a rent effective date for the new rate.");
        setLoading(false);
        return;
      }
      const updatedPayload = {
        ...rest,
        rentHistoryJson: rentChanged
          ? appendRentHistory(selected.rentHistoryJson ?? null, {
              effectiveDate,
              amount: rest.monthlyRent,
              source: "house",
            })
          : selected.rentHistoryJson ?? null,
      };
      const updated = await databases.updateDocument(
        rcmsDatabaseId,
        COLLECTIONS.houses,
        selected.$id,
        updatedPayload
      );
      setHouses((prev) =>
        prev.map((house) => (house.$id === selected.$id ? (updated as House) : house))
      );
      setSelected(updated as House);
      if (rentChanged) {
        const tenantResult = await databases.listDocuments(
          rcmsDatabaseId,
          COLLECTIONS.tenants,
          [Query.equal("house", [selected.$id])]
        );
        const tenantsForHouse = tenantResult.documents as Tenant[];
        const activeTenants = tenantsForHouse.filter(
          (tenant) => tenant.status === "active" && !tenant.moveOutDate
        );
        await Promise.all(
          activeTenants
            .filter((tenant) => tenant.rentOverride == null)
            .map((tenant) =>
              databases.updateDocument(rcmsDatabaseId, COLLECTIONS.tenants, tenant.$id, {
                rentHistoryJson: appendRentHistory(tenant.rentHistoryJson ?? null, {
                  effectiveDate,
                  amount: values.monthlyRent,
                  source: "house",
                }),
              })
            )
        );
      }
      setMode("list");
      setModalOpen(false);
      toast.push("success", "House updated.");
      if (user) {
        void logAudit({
          entityType: "house",
          entityId: (updated as House).$id,
          action: "update",
          actorId: user.id,
          details: updatedPayload,
        });
      }
    } catch (err) {
      setError("Failed to update house.");
      toast.push("error", "Failed to update house.");
    } finally {
      setLoading(false);
    }
  };

  const handleDeactivate = async (house: House) => {
    setLoading(true);
    setError(null);
    try {
      const updated = await databases.updateDocument(
        rcmsDatabaseId,
        COLLECTIONS.houses,
        house.$id,
        { status: "inactive" }
      );
      setHouses((prev) =>
        prev.map((item) => (item.$id === house.$id ? (updated as House) : item))
      );
      if (selected?.$id === house.$id) {
        setSelected(updated as House);
      }
      toast.push("success", "House deactivated.");
      if (user) {
        void logAudit({
          entityType: "house",
          entityId: (updated as House).$id,
          action: "update",
          actorId: user.id,
          details: { status: "inactive" },
        });
      }
    } catch (err) {
      setError("Failed to deactivate house.");
      toast.push("error", "Failed to deactivate house.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="space-y-6">
      <header>
        <div className="text-sm text-slate-500">Houses</div>
        <h3 className="mt-2 text-xl font-semibold text-white">Manage Houses</h3>
        <p className="mt-1 text-sm text-slate-500">
          Create, update, and deactivate rental units.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[2.2fr_1fr]">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-100">House List</div>
              <div className="text-xs text-slate-500">
                {loading ? "Loading..." : `${houses.length} houses`}
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
                Add House
              </button>
              <button
                onClick={loadHouses}
                className="btn-secondary text-sm"
              >
                Refresh
              </button>
            </div>
          </div>

          {error && (
            <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {error}
            </div>
          )}

            <HouseList
            houses={sortedHouses}
            selectedId={selected?.$id}
            onSelect={handleSelect}
            onEdit={(house) => {
              setSelected(house);
              setMode("edit");
              setModalOpen(true);
            }}
            onDeactivate={handleDeactivate}
          />
        </div>

        <div className="space-y-6">{mode === "list" && <HouseDetail house={selected} />}</div>
      </div>

      <Modal
        open={modalOpen}
        title={mode === "edit" ? "Edit House" : "New House"}
        description={
          mode === "edit"
            ? "Update unit details and rent rate."
            : "Capture house details and rent rate."
        }
        onClose={() => {
          setModalOpen(false);
          setMode("list");
        }}
      >
        <HouseForm
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

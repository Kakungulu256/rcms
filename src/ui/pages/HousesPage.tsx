import { useEffect, useMemo, useState } from "react";
import { ID, Query } from "appwrite";
import HouseDetail from "../houses/HouseDetail";
import HouseForm from "../houses/HouseForm";
import HouseList from "../houses/HouseList";
import Modal from "../Modal";
import PaginationControls from "../PaginationControls";
import TypeaheadSearch from "../TypeaheadSearch";
import { databases, listAllDocuments, rcmsDatabaseId } from "../../lib/appwrite";
import { COLLECTIONS } from "../../lib/schema";
import type { House, HouseForm as HouseFormValues, Tenant } from "../../lib/schema";
import { logAudit } from "../../lib/audit";
import { useAuth } from "../../auth/AuthContext";
import { useToast } from "../ToastContext";
import { appendRentHistory } from "../../lib/rentHistory";

type PanelMode = "list" | "create" | "edit";
type HouseStatusFilter = "all" | "occupied" | "vacant" | "inactive";

type HouseFormWithEffectiveDate = HouseFormValues & {
  rentEffectiveDate?: string;
};

export default function HousesPage() {
  const { user, permissions } = useAuth();
  const canManageHouses = permissions.canManageHouses;
  const toast = useToast();
  const [houses, setHouses] = useState<House[]>([]);
  const [selected, setSelected] = useState<House | null>(null);
  const [mode, setMode] = useState<PanelMode>("list");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [houseSearchQuery, setHouseSearchQuery] = useState("");
  const [houseStatusFilter, setHouseStatusFilter] = useState<HouseStatusFilter>("all");
  const [housePage, setHousePage] = useState(1);
  const [housePageSize, setHousePageSize] = useState(20);

  const sortedHouses = useMemo(
    () => [...houses].sort((a, b) => a.code.localeCompare(b.code)),
    [houses]
  );
  const houseSearchSuggestions = useMemo(() => {
    const values = new Set<string>();
    sortedHouses.forEach((house) => {
      values.add(house.code);
      if (house.name?.trim()) values.add(house.name.trim());
      values.add(house.status);
    });
    return Array.from(values);
  }, [sortedHouses]);
  const housesMatchingSearch = useMemo(() => {
    const query = houseSearchQuery.trim().toLowerCase();
    if (!query) return sortedHouses;
    return sortedHouses.filter((house) => {
      const code = house.code?.toLowerCase() ?? "";
      const name = house.name?.toLowerCase() ?? "";
      const status = house.status?.toLowerCase() ?? "";
      const rent = String(house.monthlyRent ?? "");
      return (
        code.includes(query) ||
        name.includes(query) ||
        status.includes(query) ||
        rent.includes(query)
      );
    });
  }, [houseSearchQuery, sortedHouses]);
  const statusCounts = useMemo(() => {
    return housesMatchingSearch.reduce(
      (counts, house) => {
        const status = (house.status ?? "").toLowerCase();
        if (status === "occupied") counts.occupied += 1;
        else if (status === "vacant") counts.vacant += 1;
        else if (status === "inactive") counts.inactive += 1;
        counts.all += 1;
        return counts;
      },
      {
        all: 0,
        occupied: 0,
        vacant: 0,
        inactive: 0,
      }
    );
  }, [housesMatchingSearch]);
  const filteredHouses = useMemo(() => {
    if (houseStatusFilter === "all") return housesMatchingSearch;
    return housesMatchingSearch.filter((house) => house.status === houseStatusFilter);
  }, [houseStatusFilter, housesMatchingSearch]);
  const paginatedHouses = useMemo(() => {
    const start = (housePage - 1) * housePageSize;
    return filteredHouses.slice(start, start + housePageSize);
  }, [filteredHouses, housePage, housePageSize]);

  const loadHouses = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listAllDocuments<House>({
        databaseId: rcmsDatabaseId,
        collectionId: COLLECTIONS.houses,
        queries: [Query.orderAsc("code")],
      });
      setHouses(result);
    } catch (err) {
      setError("Failed to load houses.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadHouses();
  }, []);

  useEffect(() => {
    setHousePage(1);
  }, [houseSearchQuery, houseStatusFilter]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(filteredHouses.length / housePageSize));
    if (housePage > totalPages) {
      setHousePage(totalPages);
    }
  }, [filteredHouses.length, housePage, housePageSize]);

  const handleSelect = (house: House) => {
    setSelected(house);
    setMode("list");
  };

  const handleCreate = async (values: HouseFormWithEffectiveDate) => {
    if (!canManageHouses) {
      toast.push("warning", "You do not have permission to create houses.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { rentEffectiveDate, ...rest } = values;
      const effectiveDate =
        rentEffectiveDate ?? new Date().toISOString().slice(0, 10);
      const manualStatus = rest.status === "inactive" ? "inactive" : "vacant";
      const created = await databases.createDocument(
        rcmsDatabaseId,
        COLLECTIONS.houses,
        ID.unique(),
        {
          ...rest,
          status: manualStatus,
          currentTenantId: null,
          rentHistoryJson: appendRentHistory(null, {
            effectiveDate,
            amount: rest.monthlyRent,
            source: "house",
          }),
        }
      );
      setHouses((prev) => [...prev, created as unknown as House]);
      setSelected(created as unknown as House);
      setMode("list");
      setModalOpen(false);
      toast.push("success", "House created.");
      if (user) {
        void logAudit({
          entityType: "house",
          entityId: (created as unknown as House).$id,
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
    if (!canManageHouses) {
      toast.push("warning", "You do not have permission to edit houses.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { rentEffectiveDate, ...rest } = values;
      const tenantsForHouse = await listAllDocuments<Tenant>({
        databaseId: rcmsDatabaseId,
        collectionId: COLLECTIONS.tenants,
        queries: [Query.equal("house", [selected.$id]), Query.orderAsc("fullName")],
      });
      const occupant =
        tenantsForHouse.find((tenant) => tenant.status === "active" && !tenant.moveOutDate) ??
        null;
      const manualInactiveRequested = rest.status === "inactive";
      const normalizedStatus = occupant
        ? "occupied"
        : manualInactiveRequested
          ? "inactive"
          : "vacant";
      if (occupant && manualInactiveRequested) {
        toast.push("warning", "House has an active tenant. Status kept as occupied.");
      }
      const rentChanged = rest.monthlyRent !== selected.monthlyRent;
      const effectiveDate =
        rentEffectiveDate ?? new Date().toISOString().slice(0, 10);
      if (rentChanged && !rentEffectiveDate) {
        setError("Provide a rent effective date for the new rate.");
        toast.push("warning", "Provide a rent effective date for the new rate.");
        setLoading(false);
        return;
      }
      const updatedPayload = {
        ...rest,
        status: normalizedStatus,
        currentTenantId: occupant?.$id ?? null,
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
        prev.map((house) =>
          house.$id === selected.$id ? (updated as unknown as House) : house
        )
      );
      setSelected(updated as unknown as House);
      setMode("list");
      setModalOpen(false);
      toast.push("success", "House updated.");
      if (user) {
        void logAudit({
          entityType: "house",
          entityId: (updated as unknown as House).$id,
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

  return (
    <section className="space-y-6">
      <header>
        <div className="text-sm text-slate-500">Houses</div>
        <h3 className="mt-2 text-xl font-semibold text-white">Manage Houses</h3>
        <p className="mt-1 text-sm text-slate-500">
          Create and update rental units.
        </p>
      </header>

      <div className="grid gap-6 xl:grid-cols-[2.2fr_1fr]">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-100">House List</div>
              <div className="text-xs text-slate-500">
                {loading
                  ? "Loading..."
                  : `${filteredHouses.length} of ${housesMatchingSearch.length} houses`}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {canManageHouses && (
                <button
                  onClick={() => {
                    setMode("create");
                    setModalOpen(true);
                  }}
                  className="btn-primary text-sm"
                >
                  Add House
                </button>
              )}
              <button
                onClick={loadHouses}
                className="btn-secondary text-sm"
              >
                Refresh
              </button>
            </div>
          </div>
          <TypeaheadSearch
            label="Find House"
            placeholder="Search by code, name, status, or rent"
            query={houseSearchQuery}
            suggestions={houseSearchSuggestions}
            onQueryChange={setHouseSearchQuery}
          />
          <div className="flex flex-wrap gap-2">
            {(
              [
                { value: "all", label: "All", count: statusCounts.all },
                { value: "occupied", label: "Occupied", count: statusCounts.occupied },
                { value: "vacant", label: "Vacant", count: statusCounts.vacant },
                { value: "inactive", label: "Inactive", count: statusCounts.inactive },
              ] satisfies Array<{
                value: HouseStatusFilter;
                label: string;
                count: number;
              }>
            ).map((option) => {
              const active = houseStatusFilter === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setHouseStatusFilter(option.value)}
                  className={`rounded-full border px-3 py-1 text-xs transition ${
                    active
                      ? "border-blue-500 bg-blue-100 text-blue-700"
                      : "text-slate-300 hover:bg-slate-800/60"
                  }`}
                  style={!active ? { borderColor: "var(--border)" } : undefined}
                >
                  {option.label} ({option.count})
                </button>
              );
            })}
          </div>

          {error && (
            <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {error}
            </div>
          )}

          <HouseList
            houses={paginatedHouses}
            selectedId={selected?.$id}
            onSelect={handleSelect}
            onEdit={
              canManageHouses
                ? (house) => {
                    setSelected(house);
                    setMode("edit");
                    setModalOpen(true);
                  }
                : undefined
            }
            canManage={canManageHouses}
          />
          <PaginationControls
            page={housePage}
            pageSize={housePageSize}
            totalItems={filteredHouses.length}
            onPageChange={setHousePage}
            onPageSizeChange={(size) => {
              setHousePageSize(size);
              setHousePage(1);
            }}
          />
        </div>

        <div className="space-y-6">{mode === "list" && <HouseDetail house={selected} />}</div>
      </div>

      <Modal
        open={canManageHouses && modalOpen}
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

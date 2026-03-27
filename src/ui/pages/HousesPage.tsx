import { useEffect, useMemo, useState } from "react";
import { ID, Query } from "appwrite";
import { startOfMonth } from "date-fns";
import { Link } from "react-router-dom";
import HouseDetail from "../houses/HouseDetail";
import HouseForm from "../houses/HouseForm";
import HouseList from "../houses/HouseList";
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
  HouseForm as HouseFormValues,
  Payment,
  Tenant,
} from "../../lib/schema";
import { logAudit } from "../../lib/audit";
import { useAuth } from "../../auth/AuthContext";
import { useToast } from "../ToastContext";
import {
  appendRentHistory,
  appendRentHistoryWithBaseline,
  buildRentByMonth,
  formatEffectiveMonth,
  normalizeEffectiveMonth,
  parseRentHistory,
  removeRentHistoryEntry,
  upsertRentHistoryEntry,
  type RentHistoryEntry,
} from "../../lib/rentHistory";
import { formatLimitValue, getLimitStatus } from "../../lib/planLimits";
import { sortHousesNatural } from "../../lib/houseSort";
import { buildMonthSeries, previewAllocation } from "../payments/allocation";
import { getTenantEffectiveEndDate } from "../../lib/tenancyDates";

type PanelMode = "list" | "create" | "edit";
type HouseStatusFilter = "all" | "occupied" | "vacant" | "inactive";

type HouseFormWithEffectiveDate = HouseFormValues & {
  rentEffectiveDate?: string;
};

function roundMoney(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function parseDateInput(value?: string | null) {
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
      ? startOfMonth(moveOutDate).getTime() <
        startOfMonth(paymentDateValue).getTime()
      : false;
  const canCarryForward = tenant.status === "active" && !movedOutBeforePaymentMonth;
  const extraMonths =
    canCarryForward && rent > 0 && allocatableAmount > 0
      ? Math.max(24, Math.ceil(allocatableAmount / rent) + 12)
      : 0;
  return buildMonthSeries(tenant.moveInDate, effectiveEndDate, extraMonths);
}

function applyAllocation(
  paidByMonth: Record<string, number>,
  allocation: Record<string, number>,
  multiplier = 1
) {
  Object.entries(allocation).forEach(([month, amount]) => {
    const value = roundMoney(Number(amount) * multiplier);
    if (!Number.isFinite(value) || value === 0) return;
    paidByMonth[month] = roundMoney((paidByMonth[month] ?? 0) + value);
  });
}

function allocateReversal(params: {
  amount: number;
  paidByMonth: Record<string, number>;
}) {
  let remaining = roundMoney(Math.max(Number(params.amount) || 0, 0));
  const allocation: Record<string, number> = {};
  const months = Object.entries(params.paidByMonth)
    .filter(([, paid]) => Number(paid) > 0)
    .map(([month]) => month)
    .sort((a, b) => b.localeCompare(a));

  months.forEach((month) => {
    if (remaining <= 0) return;
    const paid = roundMoney(Math.max(Number(params.paidByMonth[month] ?? 0), 0));
    if (paid <= 0) return;
    const applied = roundMoney(Math.min(paid, remaining));
    if (applied <= 0) return;
    allocation[month] = applied;
    remaining = roundMoney(remaining - applied);
  });

  return { allocation, remaining };
}

function recalculateTenantAllocations(params: {
  tenant: Tenant;
  house: House;
  payments: Payment[];
}): Array<{ paymentId: string; allocationJson: string }> {
  const { tenant, house, payments } = params;
  const sortedPayments = payments
    .slice()
    .sort(
      (a, b) =>
        (a.paymentDate ?? "").localeCompare(b.paymentDate ?? "") ||
        a.$id.localeCompare(b.$id)
    );
  const paidByMonth: Record<string, number> = {};
  const updates: Array<{ paymentId: string; allocationJson: string }> = [];

  sortedPayments.forEach((payment) => {
    if (payment.isReversal) {
      const reversalAmount = roundMoney(
        Math.max(
          Math.abs(Number(payment.amount) || 0) -
            Math.abs(Number(payment.securityDepositApplied) || 0),
          0
        )
      );
      const { allocation } = allocateReversal({
        amount: reversalAmount,
        paidByMonth,
      });
      applyAllocation(paidByMonth, allocation, -1);
      updates.push({
        paymentId: payment.$id,
        allocationJson: JSON.stringify(allocation),
      });
      return;
    }

    const securityDepositApplied = roundMoney(
      Math.max(Number(payment.securityDepositApplied) || 0, 0)
    );
    const allocatableAmount = roundMoney(
      Math.max(Number(payment.amount) || 0, 0) - securityDepositApplied
    );
    const months = buildAllocationMonths({
      tenant,
      paymentDate: payment.paymentDate,
      allocatableAmount,
      rent: house.monthlyRent ?? 0,
    });
    const effectiveEndDate = getTenantEffectiveEndDate(
      tenant,
      parseDateInput(payment.paymentDate)
    );
    const occupancyEndDate =
      tenant.moveOutDate ??
      (tenant.status === "inactive"
        ? effectiveEndDate.toISOString().slice(0, 10)
        : null);
    const rentByMonth = buildRentByMonth({
      months,
      houseHistoryJson: house.rentHistoryJson ?? null,
      fallbackRent: house.monthlyRent ?? 0,
      occupancyStartDate: tenant.moveInDate,
      occupancyEndDate,
    });
    const allocation = previewAllocation({
      amount: allocatableAmount,
      months,
      paidByMonth,
      rentByMonth,
    });
    const allocationMap = Object.fromEntries(
      allocation.lines
        .filter((line) => line.applied > 0)
        .map((line) => [line.month, line.applied])
    );
    applyAllocation(paidByMonth, allocationMap, 1);
    updates.push({
      paymentId: payment.$id,
      allocationJson: JSON.stringify(allocationMap),
    });
  });

  return updates;
}

export default function HousesPage() {
  const { user, permissions, planLimits } = useAuth();
  const canManageHouses = permissions.canManageHouses;
  const toast = useToast();
  const [houses, setHouses] = useState<House[]>([]);
  const [selected, setSelected] = useState<House | null>(null);
  const [mode, setMode] = useState<PanelMode>("list");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [historyEditOpen, setHistoryEditOpen] = useState(false);
  const [historyEditMode, setHistoryEditMode] = useState<"add" | "edit">("add");
  const [historyEditEntry, setHistoryEditEntry] = useState<RentHistoryEntry | null>(null);
  const [historyEditMonth, setHistoryEditMonth] = useState("");
  const [historyEditOriginalDate, setHistoryEditOriginalDate] = useState<string | null>(
    null
  );
  const [historyEditAmount, setHistoryEditAmount] = useState(0);
  const [historyEditSaving, setHistoryEditSaving] = useState(false);
  const [houseSearchQuery, setHouseSearchQuery] = useState("");
  const [houseStatusFilter, setHouseStatusFilter] = useState<HouseStatusFilter>("all");
  const [housePage, setHousePage] = useState(1);
  const [housePageSize, setHousePageSize] = useState(20);

  const sortedHouses = useMemo(() => sortHousesNatural(houses), [houses]);
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
  const houseLimitStatus = useMemo(
    () => getLimitStatus(planLimits.maxHouses, houses.length),
    [houses.length, planLimits.maxHouses]
  );

  const loadHouses = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listAllDocuments<House>({
        databaseId: rcmsDatabaseId,
        collectionId: COLLECTIONS.houses,
        queries: [Query.orderAsc("code")],
      });
      setHouses(sortHousesNatural(result));
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

  const openHistoryEditor = (entry: RentHistoryEntry) => {
    setHistoryEditMode("edit");
    setHistoryEditEntry(entry);
    setHistoryEditAmount(Number(entry.amount) || 0);
    setHistoryEditMonth(formatEffectiveMonth(entry.effectiveDate));
    setHistoryEditOriginalDate(entry.effectiveDate);
    setHistoryEditOpen(true);
  };

  const openHistoryAdder = () => {
    if (!selected) return;
    setHistoryEditMode("add");
    setHistoryEditEntry(null);
    setHistoryEditAmount(Number(selected.monthlyRent) || 0);
    setHistoryEditMonth(new Date().toISOString().slice(0, 7));
    setHistoryEditOriginalDate(null);
    setHistoryEditOpen(true);
  };

  const recalcHouseAllocations = async (house: House) => {
    const tenantsForHouse = await listAllDocuments<Tenant>({
      databaseId: rcmsDatabaseId,
      collectionId: COLLECTIONS.tenants,
      queries: [Query.equal("house", [house.$id]), Query.orderAsc("fullName")],
    });
    let updatedCount = 0;

    for (const tenant of tenantsForHouse) {
      const tenantPayments = await listAllDocuments<Payment>({
        databaseId: rcmsDatabaseId,
        collectionId: COLLECTIONS.payments,
        queries: [Query.equal("tenant", [tenant.$id]), Query.orderAsc("paymentDate")],
      });
      if (tenantPayments.length === 0) continue;

      const allocationUpdates = recalculateTenantAllocations({
        tenant,
        house,
        payments: tenantPayments,
      });
      const paymentLookup = new Map(tenantPayments.map((payment) => [payment.$id, payment]));

      for (const update of allocationUpdates) {
        const existing = paymentLookup.get(update.paymentId)?.allocationJson ?? "";
        if (existing === update.allocationJson) {
          continue;
        }
        await updateScopedDocument<
          { allocationJson: string },
          Payment
        >({
          databaseId: rcmsDatabaseId,
          collectionId: COLLECTIONS.payments,
          documentId: update.paymentId,
          data: { allocationJson: update.allocationJson },
        });
        updatedCount += 1;
      }
    }

    return updatedCount;
  };

  const handleCreate = async (values: HouseFormWithEffectiveDate) => {
    if (!canManageHouses) {
      toast.push("warning", "You do not have permission to create houses.");
      return;
    }
    if (houseLimitStatus.reached) {
      const message =
        "House limit reached on your current plan. Open Billing to add more houses.";
      setError(message);
      toast.push("warning", message);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { rentEffectiveDate, ...rest } = values;
      const effectiveMonth = rentEffectiveDate ?? new Date().toISOString().slice(0, 7);
      const effectiveDate =
        normalizeEffectiveMonth(effectiveMonth) ?? new Date().toISOString().slice(0, 10);
      const manualStatus = rest.status === "inactive" ? "inactive" : "vacant";
      const created = await createWorkspaceDocument({
        databaseId: rcmsDatabaseId,
        collectionId: COLLECTIONS.houses,
        documentId: ID.unique(),
        data: {
          ...rest,
          status: manualStatus,
          currentTenantId: null,
          rentHistoryJson: appendRentHistory(null, {
            effectiveDate,
            amount: rest.monthlyRent,
            source: "house",
          }),
        },
      });
      setHouses((prev) => sortHousesNatural([...prev, created as unknown as House]));
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
      const normalizedEffectiveDate = rentEffectiveDate
        ? normalizeEffectiveMonth(rentEffectiveDate)
        : null;
      const effectiveDate =
        normalizedEffectiveDate ?? new Date().toISOString().slice(0, 10);
      if (rentChanged && !rentEffectiveDate) {
        setError("Provide a rent effective month for the new rate.");
        toast.push("warning", "Provide a rent effective month for the new rate.");
        setLoading(false);
        return;
      }
      if (rentChanged && rentEffectiveDate && !normalizedEffectiveDate) {
        setError("Provide a valid rent effective month for the new rate.");
        toast.push("warning", "Provide a valid rent effective month for the new rate.");
        setLoading(false);
        return;
      }
      const baselineDateCandidates = tenantsForHouse
        .map((tenant) => tenant.moveInDate?.slice(0, 10))
        .filter(Boolean) as string[];
      const createdAt = (selected as House & { $createdAt?: string }).$createdAt;
      if (createdAt) baselineDateCandidates.push(createdAt.slice(0, 10));
      const baselineDate =
        baselineDateCandidates.length > 0
          ? baselineDateCandidates.sort()[0]
          : effectiveDate;

      const nextRentHistoryJson = rentChanged
        ? appendRentHistoryWithBaseline({
            existing: selected.rentHistoryJson ?? null,
            newEntry: {
              effectiveDate,
              amount: rest.monthlyRent,
              source: "house",
            },
            previousAmount: selected.monthlyRent,
            baselineDate,
          })
        : selected.rentHistoryJson ?? null;
      const latestRent =
        parseRentHistory(nextRentHistoryJson).at(-1)?.amount ?? rest.monthlyRent;
      const updatedPayload = {
        ...rest,
        monthlyRent: latestRent,
        status: normalizedStatus,
        currentTenantId: occupant?.$id ?? null,
        rentHistoryJson: nextRentHistoryJson,
      };
      const updated = await updateScopedDocument<typeof updatedPayload, House>({
        databaseId: rcmsDatabaseId,
        collectionId: COLLECTIONS.houses,
        documentId: selected.$id,
        data: updatedPayload,
      });
      setHouses((prev) =>
        sortHousesNatural(
          prev.map((house) =>
            house.$id === selected.$id ? (updated as unknown as House) : house
          )
        )
      );
      setSelected(updated as unknown as House);
      setMode("list");
      setModalOpen(false);
      toast.push("success", "House updated.");
      if (rentChanged) {
        toast.push("success", "Recalculating payments for updated rent...");
        try {
          const updatedCount = await recalcHouseAllocations(updated as unknown as House);
          toast.push(
            "success",
            updatedCount > 0
              ? `Recalculated ${updatedCount} payment allocation(s).`
              : "No payments needed recalculation."
          );
        } catch (err) {
          toast.push(
            "error",
            "House updated, but payment recalculation failed. Refresh and try again."
          );
        }
      }
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

  const handleSaveHistoryEdit = async () => {
    if (!selected) return;
    const amount = Number(historyEditAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.push("warning", "Enter a valid rent amount.");
      return;
    }
    const normalizedMonth = normalizeEffectiveMonth(historyEditMonth);
    if (!normalizedMonth) {
      toast.push("warning", "Select a valid rent effective month.");
      return;
    }

    const originalDate = historyEditOriginalDate;
    const originalMonth = formatEffectiveMonth(originalDate ?? "");
    const effectiveDate =
      historyEditMode === "edit" && originalDate && originalMonth === historyEditMonth
        ? originalDate
        : normalizedMonth;
    const replacingDate = historyEditMode === "edit" ? originalDate : null;

    if (
      historyEditMode === "edit" &&
      historyEditEntry &&
      amount === historyEditEntry.amount &&
      effectiveDate === historyEditEntry.effectiveDate
    ) {
      setHistoryEditOpen(false);
      setHistoryEditEntry(null);
      return;
    }

    setHistoryEditSaving(true);
    try {
      const nextRentHistoryJson = upsertRentHistoryEntry({
        existing: selected.rentHistoryJson ?? null,
        entry: {
          effectiveDate,
          amount,
          source: "house",
        },
        replaceDate: replacingDate ?? undefined,
      });
      const latestRent =
        parseRentHistory(nextRentHistoryJson).at(-1)?.amount ?? selected.monthlyRent;
      const updated = await updateScopedDocument<
        { rentHistoryJson: string | null; monthlyRent: number },
        House
      >({
        databaseId: rcmsDatabaseId,
        collectionId: COLLECTIONS.houses,
        documentId: selected.$id,
        data: {
          rentHistoryJson: nextRentHistoryJson,
          monthlyRent: latestRent,
        },
      });
      setHouses((prev) =>
        sortHousesNatural(
          prev.map((house) =>
            house.$id === selected.$id ? (updated as unknown as House) : house
          )
        )
      );
      setSelected(updated as unknown as House);
      setHistoryEditOpen(false);
      setHistoryEditEntry(null);
      setHistoryEditOriginalDate(null);
      setHistoryEditMonth("");
      toast.push("success", "Rent history updated. Recalculating payments...");
      try {
        const updatedCount = await recalcHouseAllocations(updated as unknown as House);
        toast.push(
          "success",
          updatedCount > 0
            ? `Recalculated ${updatedCount} payment allocation(s).`
            : "No payments needed recalculation."
        );
      } catch (err) {
        toast.push(
          "error",
          "Rent history updated, but payment recalculation failed. Refresh and try again."
        );
      }
    } catch (err) {
      toast.push("error", "Failed to update rent history.");
    } finally {
      setHistoryEditSaving(false);
    }
  };

  const handleDeleteHistoryEntry = async (entry: RentHistoryEntry) => {
    if (!selected) return;
    const confirmed = window.confirm(
      `Remove rent rate for ${formatEffectiveMonth(entry.effectiveDate)}?`
    );
    if (!confirmed) return;
    setHistoryEditSaving(true);
    try {
      const nextRentHistoryJson = removeRentHistoryEntry(
        selected.rentHistoryJson ?? null,
        entry.effectiveDate
      );
      const latestRent =
        parseRentHistory(nextRentHistoryJson).at(-1)?.amount ?? selected.monthlyRent;
      const updated = await updateScopedDocument<
        { rentHistoryJson: string | null; monthlyRent: number },
        House
      >({
        databaseId: rcmsDatabaseId,
        collectionId: COLLECTIONS.houses,
        documentId: selected.$id,
        data: {
          rentHistoryJson: nextRentHistoryJson,
          monthlyRent: latestRent,
        },
      });
      setHouses((prev) =>
        sortHousesNatural(
          prev.map((house) =>
            house.$id === selected.$id ? (updated as unknown as House) : house
          )
        )
      );
      setSelected(updated as unknown as House);
      toast.push("success", "Rent history removed. Recalculating payments...");
      try {
        const updatedCount = await recalcHouseAllocations(updated as unknown as House);
        toast.push(
          "success",
          updatedCount > 0
            ? `Recalculated ${updatedCount} payment allocation(s).`
            : "No payments needed recalculation."
        );
      } catch (err) {
        toast.push(
          "error",
          "Rent history removed, but payment recalculation failed. Refresh and try again."
        );
      }
    } catch (err) {
      toast.push("error", "Failed to remove rent history.");
    } finally {
      setHistoryEditSaving(false);
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
              {planLimits.maxHouses != null && (
                <div className="mt-1 text-xs text-amber-300">
                  Plan usage: {houseLimitStatus.used.toLocaleString()} /{" "}
                  {formatLimitValue(houseLimitStatus.limit)} houses
                  {houseLimitStatus.reached ? " (limit reached)" : ""}
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {canManageHouses && (
                <button
                  onClick={() => {
                    setMode("create");
                    setModalOpen(true);
                  }}
                  disabled={houseLimitStatus.reached}
                  className="btn-primary text-sm disabled:opacity-60"
                >
                  {houseLimitStatus.reached ? "Add House (Locked)" : "Add House"}
                </button>
              )}
              {canManageHouses && houseLimitStatus.reached ? (
                <Link to="/app/billing" className="btn-secondary text-sm">
                  Open Billing
                </Link>
              ) : null}
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

        <div className="space-y-6">
          {mode === "list" && (
            <HouseDetail
              house={selected}
              canManage={canManageHouses}
              onEditHistory={openHistoryEditor}
              onAddHistory={openHistoryAdder}
              onDeleteHistory={handleDeleteHistoryEntry}
            />
          )}
        </div>
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

      <Modal
        open={canManageHouses && historyEditOpen}
        title={historyEditMode === "edit" ? "Edit Rent History" : "Add Rent Rate"}
        description={
          historyEditMode === "edit"
            ? "Update the rent amount or effective month."
            : "Add a new rent rate for a specific month."
        }
        onClose={() => {
          setHistoryEditOpen(false);
          setHistoryEditEntry(null);
          setHistoryEditOriginalDate(null);
          setHistoryEditMonth("");
        }}
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSaveHistoryEdit();
          }}
        >
          <label className="block text-sm text-slate-300">
            Effective Month
            <input
              type="month"
              className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
              value={historyEditMonth}
              onChange={(event) => setHistoryEditMonth(event.target.value)}
              required
            />
          </label>
          <label className="block text-sm text-slate-300">
            Rent Amount
            <input
              type="number"
              step="0.01"
              min="0.01"
              className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
              value={historyEditAmount}
              onChange={(event) => setHistoryEditAmount(Number(event.target.value) || 0)}
              required
            />
          </label>
          <p className="text-xs text-slate-500">
            If an entry already exists for this month, it will be replaced.
          </p>
          <button
            type="submit"
            disabled={historyEditSaving}
            className="btn-primary w-full text-sm disabled:opacity-60"
          >
            {historyEditSaving
              ? "Saving..."
              : historyEditMode === "edit"
                ? "Save Rent Change"
                : "Add Rent Rate"}
          </button>
        </form>
      </Modal>
    </section>
  );
}

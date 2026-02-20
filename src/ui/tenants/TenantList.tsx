import type { House, Tenant } from "../../lib/schema";

type Props = {
  tenants: Tenant[];
  houses: House[];
  selectedId?: string | null;
  onSelect: (tenant: Tenant) => void;
  onEdit?: (tenant: Tenant) => void;
  onView: (tenant: Tenant) => void;
  canManage: boolean;
};

function resolveHouseLabel(tenant: Tenant, houses: House[]) {
  if (typeof tenant.house === "string") {
    const match = houses.find((house) => house.$id === tenant.house);
    return match ? match.code : "--";
  }
  return tenant.house?.code ?? "--";
}

export default function TenantList({
  tenants,
  houses,
  selectedId,
  onSelect,
  onEdit,
  onView,
  canManage,
}: Props) {
  return (
    <div
      className="overflow-hidden rounded-2xl border"
      style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
    >
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-slate-500" style={{ backgroundColor: "var(--surface-strong)" }}>
          <tr>
            <th className="px-5 py-4">Tenant</th>
            <th className="px-5 py-4">House</th>
            <th className="px-5 py-4">Move-in</th>
            <th className="px-5 py-4">Status</th>
            <th className="px-5 py-4">Actions</th>
          </tr>
        </thead>
        <tbody>
          {tenants.map((tenant) => {
            const isActive = tenant.$id === selectedId;
            return (
              <tr
                key={tenant.$id}
                className={isActive ? "bg-blue-500/10" : "border-t"}
                style={!isActive ? { borderColor: "var(--border)" } : undefined}
              >
                <td className="px-5 py-4">
                  <button
                    onClick={() => onSelect(tenant)}
                    className="font-semibold text-slate-100 hover:underline"
                  >
                    {tenant.fullName}
                  </button>
                  <div className="text-xs text-slate-500">{tenant.phone || "--"}</div>
                </td>
                <td className="px-5 py-4 text-slate-200">
                  {resolveHouseLabel(tenant, houses)}
                </td>
                <td className="px-5 py-4 text-slate-300">
                  {tenant.moveInDate?.slice(0, 10)}
                </td>
                <td className="px-5 py-4">
                  <span className="rounded-full border px-3 py-1 text-xs text-slate-300" style={{ borderColor: "var(--border)" }}>
                    {tenant.status}
                  </span>
                </td>
                <td className="px-5 py-4">
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => onView(tenant)}
                      className="btn-secondary text-xs"
                    >
                      Payment Status
                    </button>
                    {canManage && onEdit && (
                      <button
                        onClick={() => onEdit(tenant)}
                        className="btn-secondary text-xs"
                      >
                        Edit
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
          {tenants.length === 0 && (
            <tr>
              <td className="px-5 py-6 text-slate-500" colSpan={5}>
                No tenants yet. Add a tenant to get started.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

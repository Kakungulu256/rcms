import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { formatDisplayDate } from "../../lib/dateDisplay";
import {
  createWorkspaceInvitation,
  listWorkspaceInvitations,
  revokeWorkspaceInvitation,
  type WorkspaceInvitationRecord,
} from "../../lib/workspaceInvitations";
import { useToast } from "../ToastContext";

type InviteRole = "admin" | "clerk" | "viewer";

export default function WorkspaceInvitationsPanel() {
  const { canAccessFeature } = useAuth();
  const toast = useToast();
  const manageUsersAccess = canAccessFeature("settings.manage_users");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<InviteRole>("viewer");
  const [inviteNote, setInviteNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [invitations, setInvitations] = useState<WorkspaceInvitationRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const pendingCount = useMemo(
    () => invitations.filter((invite) => invite.status === "pending").length,
    [invitations]
  );

  const loadInvitations = async () => {
    if (!manageUsersAccess.allowed) return;
    setLoading(true);
    setError(null);
    const result = await listWorkspaceInvitations();
    if (!result.ok) {
      setError(result.error || "Failed to load invitations.");
      setInvitations([]);
    } else {
      setInvitations(result.invitations ?? []);
    }
    setLoading(false);
  };

  useEffect(() => {
    void loadInvitations();
  }, [manageUsersAccess.allowed]);

  const handleSendInvite = async () => {
    if (!manageUsersAccess.allowed) {
      const message =
        manageUsersAccess.reason ||
        "User management is locked on your current plan.";
      toast.push("warning", message);
      return;
    }

    const normalizedEmail = inviteEmail.trim().toLowerCase();
    if (!normalizedEmail) {
      toast.push("warning", "Invite email is required.");
      return;
    }

    setSubmitting(true);
    setError(null);
    setLastInviteUrl(null);
    try {
      const result = await createWorkspaceInvitation({
        email: normalizedEmail,
        role: inviteRole,
        note: inviteNote,
      });
      if (!result.ok || !result.invitation) {
        throw new Error(result.error || "Failed to send invitation.");
      }

      setInvitations((previous) => {
        const deduped = previous.filter(
          (item) => item.$id !== result.invitation?.$id
        );
        return [result.invitation as WorkspaceInvitationRecord, ...deduped];
      });
      setInviteEmail("");
      setInviteRole("viewer");
      setInviteNote("");
      setLastInviteUrl(result.inviteUrl ?? null);
      toast.push("success", "Invitation sent.");
    } catch (inviteError) {
      const message =
        inviteError instanceof Error
          ? inviteError.message
          : "Failed to send invitation.";
      setError(message);
      toast.push("error", message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async (invitationId: string) => {
    if (!manageUsersAccess.allowed) return;
    setRevokingId(invitationId);
    setError(null);
    try {
      const result = await revokeWorkspaceInvitation(invitationId);
      if (!result.ok || !result.invitation) {
        throw new Error(result.error || "Failed to revoke invitation.");
      }
      setInvitations((previous) =>
        previous.map((invite) =>
          invite.$id === invitationId
            ? ({
                ...invite,
                status: "revoked",
                revokedAt:
                  result.invitation?.revokedAt ??
                  new Date().toISOString(),
              } as WorkspaceInvitationRecord)
            : invite
        )
      );
      toast.push("success", "Invitation revoked.");
    } catch (revokeError) {
      const message =
        revokeError instanceof Error
          ? revokeError.message
          : "Failed to revoke invitation.";
      setError(message);
      toast.push("error", message);
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/30 p-6">
      <div className="text-sm font-semibold text-slate-100">Team Invitations</div>
      <p className="mt-2 text-xs text-slate-500">
        Send role-based workspace invitations by email and track acceptance.
      </p>

      {!manageUsersAccess.allowed ? (
        <div className="mt-4 rounded-xl border border-amber-600/40 bg-amber-950/30 p-4 text-sm text-amber-100">
          {manageUsersAccess.reason ||
            "User management is locked on your current plan."}
        </div>
      ) : (
        <>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <label className="block text-sm text-slate-300 md:col-span-2">
              Invite Email
              <input
                type="email"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
                placeholder="member@example.com"
              />
            </label>
            <label className="block text-sm text-slate-300">
              Role
              <select
                value={inviteRole}
                onChange={(event) => setInviteRole(event.target.value as InviteRole)}
                className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
              >
                <option value="viewer">Viewer</option>
                <option value="clerk">Clerk</option>
                <option value="admin">Admin</option>
              </select>
            </label>
          </div>

          <label className="mt-4 block text-sm text-slate-300">
            Note (optional)
            <input
              type="text"
              value={inviteNote}
              onChange={(event) => setInviteNote(event.target.value)}
              className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
              placeholder="Optional invite note"
            />
          </label>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void handleSendInvite()}
              disabled={submitting}
              className="btn-primary text-sm disabled:opacity-60"
            >
              {submitting ? "Sending..." : "Send Invitation"}
            </button>
            <button
              type="button"
              onClick={() => void loadInvitations()}
              disabled={loading}
              className="btn-secondary text-sm disabled:opacity-60"
            >
              {loading ? "Refreshing..." : "Refresh Invites"}
            </button>
            <span className="text-xs text-slate-500">
              Pending invites: {pendingCount.toLocaleString()}
            </span>
          </div>
        </>
      )}

      {lastInviteUrl ? (
        <div className="mt-4 rounded-xl border border-sky-500/40 bg-sky-500/10 p-3 text-xs text-sky-300">
          Invite link generated: {lastInviteUrl}
        </div>
      ) : null}

      {error ? (
        <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
          {error}
        </div>
      ) : null}

      <div className="mt-5 overflow-x-auto rounded-xl border border-slate-800">
        <table className="min-w-[760px] w-full text-left text-sm text-slate-300">
          <thead className="text-xs text-slate-500" style={{ backgroundColor: "var(--surface-strong)" }}>
            <tr>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Expires</th>
              <th className="px-4 py-3">Accepted</th>
              <th className="px-4 py-3">Action</th>
            </tr>
          </thead>
          <tbody>
            {invitations.map((invite) => (
              <tr
                key={invite.$id}
                className="border-t odd:bg-slate-950/30"
                style={{ borderColor: "var(--border)" }}
              >
                <td className="px-4 py-3">{invite.email}</td>
                <td className="px-4 py-3">{invite.role}</td>
                <td className="px-4 py-3">{invite.status}</td>
                <td className="px-4 py-3">{formatDisplayDate(invite.expiresAt)}</td>
                <td className="px-4 py-3">{formatDisplayDate(invite.acceptedAt)}</td>
                <td className="px-4 py-3">
                  {invite.status === "pending" ? (
                    <button
                      type="button"
                      onClick={() => void handleRevoke(invite.$id)}
                      disabled={revokingId === invite.$id || !manageUsersAccess.allowed}
                      className="btn-secondary text-xs disabled:opacity-60"
                    >
                      {revokingId === invite.$id ? "Revoking..." : "Revoke"}
                    </button>
                  ) : (
                    <span className="text-xs text-slate-500">--</span>
                  )}
                </td>
              </tr>
            ))}
            {invitations.length === 0 ? (
              <tr>
                <td className="px-4 py-4 text-slate-500" colSpan={6}>
                  {loading ? "Loading invitations..." : "No invitations found."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

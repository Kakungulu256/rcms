import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { setActiveWorkspaceId } from "../../lib/workspace";
import {
  acceptWorkspaceInvitation,
  previewWorkspaceInvitation,
} from "../../lib/workspaceInvitations";
import { useToast } from "../ToastContext";
import { formatDisplayDate } from "../../lib/dateDisplay";

type InvitePreview = {
  id: string;
  workspaceId: string;
  workspaceName: string;
  email: string;
  role: "admin" | "clerk" | "viewer";
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: string | null;
};

export default function AcceptInvitePage() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<InvitePreview | null>(null);

  const token = useMemo(
    () => new URLSearchParams(location.search).get("token")?.trim() ?? "",
    [location.search]
  );

  useEffect(() => {
    let active = true;
    if (!token) {
      setInvite(null);
      setError("Invitation token is missing.");
      return () => {
        active = false;
      };
    }

    const loadPreview = async () => {
      setLoading(true);
      setError(null);
      const result = await previewWorkspaceInvitation(token);
      if (!active) return;
      if (!result.ok || !result.invitation) {
        setInvite(null);
        setError(result.error || "Invitation not found.");
      } else {
        setInvite(result.invitation as unknown as InvitePreview);
      }
      setLoading(false);
    };

    void loadPreview();
    return () => {
      active = false;
    };
  }, [token]);

  const handleAccept = async () => {
    if (!token) {
      setError("Invitation token is missing.");
      return;
    }
    if (!user) {
      navigate("/login", {
        replace: false,
        state: { from: `${location.pathname}${location.search}` },
      });
      return;
    }

    setAccepting(true);
    setError(null);
    try {
      const result = await acceptWorkspaceInvitation(token);
      if (!result.ok || !result.workspaceId) {
        throw new Error(result.error || "Failed to accept invitation.");
      }
      setActiveWorkspaceId(result.workspaceId);
      await refresh();
      toast.push("success", "Invitation accepted. You can now access the workspace.");
      navigate("/app", { replace: true });
    } catch (acceptError) {
      const message =
        acceptError instanceof Error
          ? acceptError.message
          : "Failed to accept invitation.";
      setError(message);
      toast.push("error", message);
    } finally {
      setAccepting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-3xl items-center px-6 py-8">
        <div className="w-full rounded-2xl border border-slate-800 bg-slate-900/50 p-8">
          <div className="text-sm text-slate-400">RCMS</div>
          <h1 className="mt-2 text-2xl font-semibold text-white">
            Workspace Invitation
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Review invite details and accept to join the workspace.
          </p>

          {loading ? (
            <div className="mt-6 text-sm text-slate-400">Loading invitation...</div>
          ) : invite ? (
            <div className="mt-6 space-y-3 rounded-xl border border-slate-800 bg-slate-950/30 p-4 text-sm text-slate-300">
              <div>
                Workspace:{" "}
                <span className="font-semibold text-slate-100">
                  {invite.workspaceName}
                </span>
              </div>
              <div>
                Invited email:{" "}
                <span className="font-semibold text-slate-100">{invite.email}</span>
              </div>
              <div>
                Role:{" "}
                <span className="font-semibold text-slate-100">
                  {invite.role.toUpperCase()}
                </span>
              </div>
              <div>
                Status:{" "}
                <span className="font-semibold text-slate-100">
                  {invite.status.toUpperCase()}
                </span>
              </div>
              <div>
                Expires:{" "}
                <span className="font-semibold text-slate-100">
                  {formatDisplayDate(invite.expiresAt)}
                </span>
              </div>
            </div>
          ) : null}

          {error ? (
            <div className="mt-6 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {error}
            </div>
          ) : null}

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void handleAccept()}
              disabled={accepting || loading || !invite || invite.status !== "pending"}
              className="btn-primary text-sm disabled:opacity-60"
            >
              {accepting ? "Accepting..." : user ? "Accept Invitation" : "Sign in to Accept"}
            </button>
            <Link to="/" className="btn-secondary text-sm">
              Back to Home
            </Link>
          </div>

          {!user ? (
            <p className="mt-4 text-xs text-slate-500">
              Sign in with the invited email address before accepting.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { isPlatformOwnerUser } from "../lib/platformOwner";

type RequireWorkspaceProps = {
  children: React.ReactNode;
};

export default function RequireWorkspace({ children }: RequireWorkspaceProps) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-sm text-slate-400">
        Loading workspace...
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!user.hasWorkspace) {
    const platformOwner = isPlatformOwnerUser({ id: user.id, email: user.email });
    return <Navigate to={platformOwner ? "/app/platform" : "/signup"} replace />;
  }

  return <>{children}</>;
}

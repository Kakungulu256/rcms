import { rcmsDatabaseId, createWorkspaceDocument } from "./appwrite";
import { COLLECTIONS, encodeJson } from "./schema";

export type AuditAction = "create" | "update" | "reverse" | "delete";

export async function logAudit(params: {
  entityType: string;
  entityId: string;
  action: AuditAction;
  actorId: string;
  details?: Record<string, unknown>;
  workspaceId?: string;
}) {
  const { entityType, entityId, action, actorId, details, workspaceId } = params;
  return createWorkspaceDocument({
    databaseId: rcmsDatabaseId,
    collectionId: COLLECTIONS.auditLogs,
    workspaceId,
    data: {
      entityType,
      entityId,
      action,
      actorId,
      timestamp: new Date().toISOString(),
      detailsJson: encodeJson(details ?? null),
    },
  });
}

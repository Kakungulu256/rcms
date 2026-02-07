import { ID } from "appwrite";
import { databases, rcmsDatabaseId } from "./appwrite";
import { COLLECTIONS, encodeJson } from "./schema";

export type AuditAction = "create" | "update" | "reverse" | "delete";

export async function logAudit(params: {
  entityType: string;
  entityId: string;
  action: AuditAction;
  actorId: string;
  details?: Record<string, unknown>;
}) {
  const { entityType, entityId, action, actorId, details } = params;
  return databases.createDocument(rcmsDatabaseId, COLLECTIONS.auditLogs, ID.unique(), {
    entityType,
    entityId,
    action,
    actorId,
    timestamp: new Date().toISOString(),
    detailsJson: encodeJson(details ?? null),
  });
}

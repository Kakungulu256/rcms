import { Account, Client, Databases, Functions, ID, Query, Storage, Teams } from "appwrite";
import { COLLECTIONS } from "./schema";
import { getActiveWorkspaceId, normalizeWorkspaceId } from "./workspace";

const endpoint = import.meta.env.VITE_APPWRITE_ENDPOINT as string | undefined;
const projectId = import.meta.env.VITE_APPWRITE_PROJECT_ID as string | undefined;
const databaseId = import.meta.env.VITE_APPWRITE_DATABASE_ID as string | undefined;
const receiptsBucketId = import.meta.env.VITE_APPWRITE_RECEIPTS_BUCKET_ID as
  | string
  | undefined;

if (!endpoint || !projectId) {
  console.warn(
    "Missing Appwrite config. Set VITE_APPWRITE_ENDPOINT and VITE_APPWRITE_PROJECT_ID."
  );
}

export const appwriteClient = new Client()
  .setEndpoint(endpoint ?? "")
  .setProject(projectId ?? "");

export const databases = new Databases(appwriteClient);
export const functions = new Functions(appwriteClient);
export const storage = new Storage(appwriteClient);
export const account = new Account(appwriteClient);
export const teams = new Teams(appwriteClient);
export const rcmsDatabaseId = databaseId ?? "rcms";
export const rcmsReceiptsBucketId = receiptsBucketId ?? "rcms_receipts";
export const WORKSPACE_SCOPED_COLLECTION_IDS = new Set<string>([
  COLLECTIONS.houses,
  COLLECTIONS.tenants,
  COLLECTIONS.payments,
  COLLECTIONS.expenses,
  COLLECTIONS.securityDepositDeductions,
  COLLECTIONS.auditLogs,
]);

export function isWorkspaceScopedCollection(collectionId: string) {
  return WORKSPACE_SCOPED_COLLECTION_IDS.has(collectionId);
}

export function getWorkspaceScopedQueries(params: {
  collectionId: string;
  queries?: string[];
  workspaceId?: string | null;
}) {
  const { collectionId, queries = [], workspaceId } = params;
  if (!isWorkspaceScopedCollection(collectionId)) return [...queries];
  const resolvedWorkspaceId =
    normalizeWorkspaceId(workspaceId) ?? getActiveWorkspaceId();
  return [Query.equal("workspaceId", [resolvedWorkspaceId]), ...queries];
}

export function withWorkspaceData<T extends Record<string, unknown>>(params: {
  collectionId: string;
  data: T;
  workspaceId?: string | null;
}) {
  const { collectionId, data, workspaceId } = params;
  if (!isWorkspaceScopedCollection(collectionId)) return data;
  const resolvedWorkspaceId =
    normalizeWorkspaceId(workspaceId) ?? getActiveWorkspaceId();
  return {
    ...data,
    workspaceId: resolvedWorkspaceId,
  };
}

export async function createWorkspaceDocument<T extends Record<string, unknown>>(params: {
  databaseId: string;
  collectionId: string;
  data: T;
  workspaceId?: string | null;
  documentId?: string;
}) {
  const { databaseId, collectionId, data, workspaceId, documentId } = params;
  const payload = withWorkspaceData({ collectionId, data, workspaceId });
  return databases.createDocument(
    databaseId,
    collectionId,
    documentId ?? ID.unique(),
    payload
  );
}

export async function listAllDocuments<T = unknown>(params: {
  databaseId: string;
  collectionId: string;
  queries?: string[];
  pageSize?: number;
  workspaceId?: string | null;
  skipWorkspaceScope?: boolean;
}): Promise<T[]> {
  const {
    databaseId,
    collectionId,
    queries = [],
    pageSize = 100,
    workspaceId,
    skipWorkspaceScope = false,
  } = params;
  const fetchPages = async (sourceQueries: string[]) => {
    const documents: T[] = [];
    let cursor: string | null = null;

    while (true) {
      const pageQueries = [...sourceQueries, Query.limit(pageSize)];
      if (cursor) {
        pageQueries.push(Query.cursorAfter(cursor));
      }
      const page = await databases.listDocuments(databaseId, collectionId, pageQueries);
      documents.push(...(page.documents as unknown as T[]));
      if (page.documents.length < pageSize) {
        break;
      }
      cursor = page.documents[page.documents.length - 1].$id;
    }

    return documents;
  };
  const baseQueries = skipWorkspaceScope
    ? [...queries]
    : getWorkspaceScopedQueries({
        collectionId,
        queries,
        workspaceId,
      });
  const documents = await fetchPages(baseQueries);

  const allowLegacyFallback =
    !skipWorkspaceScope &&
    isWorkspaceScopedCollection(collectionId) &&
    documents.length === 0 &&
    String(import.meta.env.VITE_WORKSPACE_INCLUDE_LEGACY_UNSCOPED ?? "true") !== "false";
  if (!allowLegacyFallback) {
    return documents;
  }

  const resolvedWorkspaceId =
    normalizeWorkspaceId(workspaceId) ?? getActiveWorkspaceId();
  const legacyDocuments = await fetchPages([...queries]);
  return legacyDocuments.filter((document) => {
    const documentWorkspaceId = normalizeWorkspaceId((document as any)?.workspaceId);
    return !documentWorkspaceId || documentWorkspaceId === resolvedWorkspaceId;
  });
}

if (import.meta.env.DEV) {
  (window as any).__APPWRITE = {
    client: appwriteClient,
    account,
    teams,
    databases,
    functions,
    storage,
  };
}

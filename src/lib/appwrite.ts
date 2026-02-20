import { Account, Client, Databases, Functions, Query, Teams } from "appwrite";

const endpoint = import.meta.env.VITE_APPWRITE_ENDPOINT as string | undefined;
const projectId = import.meta.env.VITE_APPWRITE_PROJECT_ID as string | undefined;
const databaseId = import.meta.env.VITE_APPWRITE_DATABASE_ID as string | undefined;

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
export const account = new Account(appwriteClient);
export const teams = new Teams(appwriteClient);
export const rcmsDatabaseId = databaseId ?? "rcms";

export async function listAllDocuments<T = unknown>(params: {
  databaseId: string;
  collectionId: string;
  queries?: string[];
  pageSize?: number;
}): Promise<T[]> {
  const { databaseId, collectionId, queries = [], pageSize = 100 } = params;
  const documents: T[] = [];
  let cursor: string | null = null;

  while (true) {
    const pageQueries = [...queries, Query.limit(pageSize)];
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
}

if (import.meta.env.DEV) {
  (window as any).__APPWRITE = {
    client: appwriteClient,
    account,
    teams,
    databases,
    functions,
  };
}

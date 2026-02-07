import { Account, Client, Databases, Functions } from "appwrite";

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
export const rcmsDatabaseId = databaseId ?? "rcms";

if (import.meta.env.DEV) {
  (window as any).__APPWRITE = {
    client: appwriteClient,
    account,
    databases,
    functions,
  };
}

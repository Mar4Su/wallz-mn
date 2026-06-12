import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";

const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function resolveServiceAccountPath(serviceAccountPath: string): string {
  const candidates = isAbsolute(serviceAccountPath)
    ? [serviceAccountPath]
    : [resolve(process.cwd(), serviceAccountPath), resolve(serverDir, serviceAccountPath)];

  const foundPath = candidates.find((candidate) => existsSync(candidate));
  if (foundPath) return foundPath;

  throw new Error(
    `Firebase service account file not found. FIREBASE_SERVICE_ACCOUNT_PATH="${serviceAccountPath}". Tried: ${candidates.join(", ")}`
  );
}

function serviceAccountFromEnv() {
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (rawJson) return JSON.parse(rawJson);

  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!serviceAccountPath) return null;

  const absolutePath = resolveServiceAccountPath(serviceAccountPath);
  return JSON.parse(readFileSync(absolutePath, "utf8"));
}

if (!getApps().length) {
  const serviceAccount = serviceAccountFromEnv();
  initializeApp({
    credential: serviceAccount ? cert(serviceAccount) : undefined,
    projectId: process.env.FIREBASE_PROJECT_ID || serviceAccount?.project_id,
  });
}

export const adminAuth = getAuth();
export const adminDb = getFirestore();
export const adminFieldValue = FieldValue;
export const adminTimestamp = Timestamp;

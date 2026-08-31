import { applicationDefault, cert, getApps, initializeApp, type ServiceAccount } from "firebase-admin/app";
import { getAuth, type Auth, type DecodedIdToken } from "firebase-admin/auth";

let cachedAuth: Auth | null = null;

function parseServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { project_id?: string; client_email?: string; private_key?: string };
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
      throw new Error("missing project_id, client_email, or private_key");
    }
    if (process.env.FIREBASE_PROJECT_ID?.trim() && process.env.FIREBASE_PROJECT_ID.trim() !== parsed.project_id) {
      throw new Error("FIREBASE_PROJECT_ID does not match the service account project_id");
    }
    return {
      projectId: parsed.project_id,
      clientEmail: parsed.client_email,
      privateKey: parsed.private_key?.replace(/\\n/g, "\n"),
    } as ServiceAccount;
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : "";
    throw new Error(`FIREBASE_SERVICE_ACCOUNT_JSON is invalid${detail}`);
  }
}

function getFirebaseAdminAuth() {
  if (cachedAuth) return cachedAuth;

  const serviceAccount = parseServiceAccount();
  const hasApplicationCredentials = Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim());
  if (!serviceAccount && !hasApplicationCredentials) {
    throw new Error("Firebase auth is not configured");
  }

  if (!getApps().length) {
    const projectId = process.env.FIREBASE_PROJECT_ID || (serviceAccount as { projectId?: string } | null)?.projectId;
    initializeApp(
      serviceAccount
        ? { credential: cert(serviceAccount), projectId }
        : { credential: applicationDefault(), projectId },
    );
  }

  cachedAuth = getAuth();
  return cachedAuth;
}

export function isFirebaseAuthConfigured() {
  return Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim() || process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim());
}

export function validateFirebaseAuthConfiguration() {
  if (!isFirebaseAuthConfigured()) throw new Error("Firebase Admin credentials are required");
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim()) parseServiceAccount();
}

export async function verifyFirebaseIdToken(idToken: string) {
  const auth = getFirebaseAdminAuth();
  return auth.verifyIdToken(idToken, true);
}

export function getFirebasePhoneNumber(decoded: DecodedIdToken) {
  const phoneNumber = (decoded as DecodedIdToken & { phone_number?: string }).phone_number;
  return typeof phoneNumber === "string" && phoneNumber.trim() ? phoneNumber.trim() : "";
}

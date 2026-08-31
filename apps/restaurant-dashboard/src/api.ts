import { demoRequest } from "./demo-data";
import { isDemoSession } from "./demo-mode";
import { cacheResponse, cachedResponse, flushOfflineMutations, isOfflineQueueSafe, offlineIdentity, queueMutation } from "./offline";

export const API = import.meta.env.VITE_API_ORIGIN || `${window.location.protocol}//${window.location.hostname}:4000`;
export const TOKEN_KEY = "white_label_owner_token";

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); }
}

export class OfflineQueuedError extends Error {
  constructor(readonly queueId: string) { super("Saved offline. The platform will synchronize this update when the connection returns."); }
}

export type PlatformRequestInit = RequestInit & { offline?: "queue-safe" | "online-only" };

export async function api<T>(path: string, token: string, init: PlatformRequestInit = {}): Promise<T> {
  if (isDemoSession(token)) return demoRequest<T>(path, init);
  const method = (init.method || "GET").toUpperCase();
  const identity = offlineIdentity(token);
  const queueSafe = init.offline === "queue-safe" && isOfflineQueueSafe(path, method);
  const idempotencyKey = queueSafe ? crypto.randomUUID() : undefined;
  if (method === "GET" && !navigator.onLine) {
    const cached = await cachedResponse<T>(identity, path);
    if (cached !== undefined) return cached;
  }
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}), ...init.headers },
    });
  } catch (error) {
    if (method === "GET") {
      const cached = await cachedResponse<T>(identity, path);
      if (cached !== undefined) return cached;
    }
    if (queueSafe && idempotencyKey) {
      const queued = await queueMutation({ identity, path, method, body: typeof init.body === "string" ? init.body : undefined, idempotencyKey });
      throw new OfflineQueuedError(queued.id);
    }
    throw error;
  }
  const text = response.status === 204 ? "" : await response.text();
  let data: { message?: string; code?: string } | T | undefined;
  if (text) {
    try {
      data = JSON.parse(text) as { message?: string; code?: string } | T;
    } catch {
      if (!response.ok) throw new ApiError("The server returned an invalid response", response.status);
      throw new ApiError("The server returned invalid JSON", response.status);
    }
  }
  if (!response.ok) {
    const error = data as { message?: string; code?: string } | undefined;
    throw new ApiError(error?.message || "Request failed", response.status, error?.code);
  }
  if (method === "GET" && data !== undefined) await cacheResponse(identity, path, data).catch(() => undefined);
  return data as T;
}

export function synchronizeOfflineChanges(token: string) {
  return flushOfflineMutations(API, token);
}

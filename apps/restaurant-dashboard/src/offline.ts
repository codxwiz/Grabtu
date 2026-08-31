const DB_NAME = "white_label-restaurant-offline";
const DB_VERSION = 1;
const CACHE_STORE = "responses";
const QUEUE_STORE = "mutations";
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

type CachedResponse = {
  key: string;
  identity: string;
  path: string;
  data: unknown;
  cachedAt: number;
};

export type QueuedMutation = {
  id: string;
  identity: string;
  path: string;
  method: string;
  body?: string;
  idempotencyKey: string;
  queuedAt: number;
  attempts: number;
  lastError?: string;
};

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(CACHE_STORE)) database.createObjectStore(CACHE_STORE, { keyPath: "key" });
      if (!database.objectStoreNames.contains(QUEUE_STORE)) database.createObjectStore(QUEUE_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transact<T>(storeName: string, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) {
  return openDatabase().then(database => new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const request = action(transaction.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
  }));
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
}

export function offlineIdentity(token: string) {
  try {
    const payload = JSON.parse(decodeBase64Url(token.split(".")[1])) as { restaurantId?: string; id?: string };
    if (payload.restaurantId && payload.id) return `${payload.restaurantId}:${payload.id}`;
  } catch {}
  return "anonymous";
}

export function isOfflineQueueSafe(path: string, method: string) {
  const normalizedMethod = method.toUpperCase();
  return (normalizedMethod === "PATCH" && /^\/api\/orders\/[^/]+\/status$/.test(path))
    || (normalizedMethod === "PATCH" && /^\/api\/admin\/service-requests\/[^/]+$/.test(path))
    || (normalizedMethod === "POST" && /^\/api\/admin\/tables\/[^/]+\/clear$/.test(path));
}

export async function cacheResponse(identity: string, path: string, data: unknown) {
  if (!("indexedDB" in window)) return;
  const entry: CachedResponse = { key: `${identity}:${path}`, identity, path, data, cachedAt: Date.now() };
  await transact(CACHE_STORE, "readwrite", store => store.put(entry));
}

export async function cachedResponse<T>(identity: string, path: string): Promise<T | undefined> {
  if (!("indexedDB" in window)) return undefined;
  const entry = await transact<CachedResponse | undefined>(CACHE_STORE, "readonly", store => store.get(`${identity}:${path}`));
  if (!entry || Date.now() - entry.cachedAt > CACHE_MAX_AGE_MS) return undefined;
  return entry.data as T;
}

export async function queueMutation(input: Omit<QueuedMutation, "id" | "queuedAt" | "attempts">) {
  if (!("indexedDB" in window)) throw new Error("Offline storage is unavailable in this browser");
  const entry: QueuedMutation = { ...input, id: crypto.randomUUID(), queuedAt: Date.now(), attempts: 0 };
  await transact(QUEUE_STORE, "readwrite", store => store.add(entry));
  window.dispatchEvent(new CustomEvent("white_label:offline-queue", { detail: { queued: true } }));
  return entry;
}

async function queuedMutations() {
  if (!("indexedDB" in window)) return [];
  return transact<QueuedMutation[]>(QUEUE_STORE, "readonly", store => store.getAll());
}

async function updateMutation(entry: QueuedMutation) {
  await transact(QUEUE_STORE, "readwrite", store => store.put(entry));
}

async function removeMutation(id: string) {
  await transact(QUEUE_STORE, "readwrite", store => store.delete(id));
}

export async function pendingOfflineMutations(identity?: string) {
  const entries = await queuedMutations();
  return identity ? entries.filter(entry => entry.identity === identity).length : entries.length;
}

export async function flushOfflineMutations(apiOrigin: string, token: string) {
  if (!navigator.onLine) return { delivered: 0, remaining: await pendingOfflineMutations(offlineIdentity(token)) };
  const identity = offlineIdentity(token);
  const entries = (await queuedMutations()).filter(entry => entry.identity === identity).sort((a, b) => a.queuedAt - b.queuedAt);
  let delivered = 0;
  for (const entry of entries) {
    if (!isOfflineQueueSafe(entry.path, entry.method)) {
      entry.lastError = "Mutation is not approved for offline replay";
      await updateMutation(entry);
      continue;
    }
    try {
      const response = await fetch(`${apiOrigin}${entry.path}`, {
        method: entry.method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "Idempotency-Key": entry.idempotencyKey,
        },
        body: entry.body,
      });
      if (response.ok || response.headers.get("Idempotency-Replayed") === "true") {
        await removeMutation(entry.id);
        delivered += 1;
        continue;
      }
      const data = await response.json().catch(() => ({})) as { message?: string; code?: string };
      entry.attempts += 1;
      entry.lastError = data.message || `Server returned ${response.status}`;
      await updateMutation(entry);
      if (response.status === 401 || response.status === 403 || response.status === 409) break;
    } catch (error) {
      entry.attempts += 1;
      entry.lastError = error instanceof Error ? error.message : "Network error";
      await updateMutation(entry);
      break;
    }
  }
  const remaining = await pendingOfflineMutations(identity);
  window.dispatchEvent(new CustomEvent("white_label:offline-sync", { detail: { delivered, remaining } }));
  return { delivered, remaining };
}

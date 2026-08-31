export const DEMO_TOKEN = "white_label-demo-session";
export const DEMO_STORAGE_KEY = "white_label_demo_mode";

export function isDemoSession(token?: string | null) {
  if (token === DEMO_TOKEN) return true;
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(DEMO_STORAGE_KEY) === "1";
}

export function enableDemoSession() {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DEMO_STORAGE_KEY, "1");
}

export function disableDemoSession() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(DEMO_STORAGE_KEY);
}

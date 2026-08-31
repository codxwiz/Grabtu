import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { Order } from "@whitelabel/shared-types";
import { api, ApiError, TOKEN_KEY } from "./api";
import { BillingPage } from "./BillingPage";
import { Login } from "./Login";
import { MenuPage } from "./MenuPage";
import { PaymentsPage } from "./PaymentsPage";
import { SettingsPage } from "./SettingsPage";
import { StaffPage } from "./StaffPage";
import { TablesPage } from "./TablesPage";
import { disableDemoSession } from "./demo-mode";
import type { Billing, CardMerchantConfig, Category, DiningTable, Entitlements, MenuItem, MenuItemOption, PaymentMethodAdmin, RestaurantSettings, SessionUser, StaffMember, SupportTicket } from "./types";

const KdsPage = lazy(() => import("./KdsPage").then(module => ({ default: module.KdsPage })));
const PRODUCT_NAME = import.meta.env.VITE_PRODUCT_NAME || "Restaurant Platform";
const BRAND_WORDMARK = import.meta.env.VITE_BRAND_WORDMARK || "/brand-wordmark.png";
const THEME_KEY = "white_label_console_theme";
type Page = "kds" | "menu" | "tables" | "payments" | "staff" | "settings" | "billing";

// This mirrors the API's effective route authorization. Read-only roles can
// inspect their workspace, while mutation controls are gated independently.
const ACCESS: Record<string, readonly Page[]> = {
  OWNER: ["kds", "menu", "tables", "payments", "staff", "settings", "billing"],
  MANAGER: ["kds", "menu", "tables", "payments", "settings"],
  SUPERVISOR: ["kds", "menu", "tables", "payments"],
  CASHIER: ["payments"],
  WAITER: ["menu"],
  KITCHEN: ["kds"],
  ORG_ADMIN: ["kds"],
  ORG_ANALYST: ["menu"],
};
const LABEL: Record<Page, string> = { kds: "KDS Mode", menu: "Menu", tables: "Tables & QR", payments: "Payments", staff: "Staff", settings: "Brand Settings", billing: "Billing" };

function ThemeIcon({ theme }: { theme: "dark" | "light" }) {
  return theme === "dark"
    ? <svg className="theme-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 15.2A8.3 8.3 0 0 1 8.8 4 8.4 8.4 0 1 0 20 15.2Z" /></svg>
    : <svg className="theme-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>;
}

export function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || "");
  const logout = useCallback(() => {
    disableDemoSession();
    localStorage.removeItem(TOKEN_KEY);
    setToken("");
  }, []);
  if (!token) return <Login onLogin={next => { localStorage.setItem(TOKEN_KEY, next); setToken(next); }} />;
  return <Dashboard token={token} onLogout={logout} />;
}

function Dashboard({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [page, setPage] = useState<Page>("kds");
  const [theme, setTheme] = useState<"dark" | "light">(() => localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [payments, setPayments] = useState<PaymentMethodAdmin[]>([]);
  const [verificationOrders, setVerificationOrders] = useState<Order[]>([]);
  const [cardMerchant, setCardMerchant] = useState<CardMerchantConfig | null>(null);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [settings, setSettings] = useState<RestaurantSettings | null>(null);
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);
  const [billing, setBilling] = useState<Billing | null>(null);
  const [supportTickets, setSupportTickets] = useState<SupportTicket[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const successTimer = useRef<number | null>(null);
  const errorTimer = useRef<number | null>(null);
  const role = user?.role.toUpperCase() || "";
  const visiblePages = role ? (ACCESS[role] || []) : [];
  const canManageMenu = ["OWNER", "MANAGER", "SUPERVISOR"].includes(role);
  const canManageTables = ["OWNER", "MANAGER", "SUPERVISOR"].includes(role);
  const canConfigureUpi = ["OWNER", "MANAGER"].includes(role);
  const canConfigureCard = role === "OWNER";
  const canPrepare = Boolean(user?.capabilities?.includes("orders.prepare"));
  const canVerifyPayments = Boolean(user?.capabilities?.includes("payments.confirm"));

  const clearFeedbackTimers = useCallback(() => {
    if (successTimer.current !== null) window.clearTimeout(successTimer.current);
    if (errorTimer.current !== null) window.clearTimeout(errorTimer.current);
    successTimer.current = null;
    errorTimer.current = null;
  }, []);

  const showSuccess = useCallback((message: string) => {
    if (!message) return;
    if (successTimer.current !== null) window.clearTimeout(successTimer.current);
    setSuccess(message);
    successTimer.current = window.setTimeout(() => { setSuccess(""); successTimer.current = null; }, 3500);
  }, []);

  const showError = useCallback((message: string) => {
    if (errorTimer.current !== null) window.clearTimeout(errorTimer.current);
    setError(message);
    errorTimer.current = window.setTimeout(() => { setError(""); errorTimer.current = null; }, 7000);
  }, []);

  useEffect(() => clearFeedbackTimers, [clearFeedbackTimers]);

  const run = useCallback(async <T,>(action: () => Promise<T>, message = "Saved successfully"): Promise<{ ok: true; value: T } | { ok: false }> => {
    setBusy(true);
    setError("");
    try {
      const value = await action();
      if (message) showSuccess(message);
      return { ok: true, value };
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) onLogout();
      showError(reason instanceof Error ? reason.message : "Request failed");
      return { ok: false };
    } finally {
      setBusy(false);
    }
  }, [onLogout, showError, showSuccess]);

  const mutate = useCallback(async (action: () => Promise<unknown>, message = "Saved successfully") => {
    const result = await run(action, message);
    return result.ok;
  }, [run]);

  const loadUser = useCallback(async () => {
    setAuthLoading(true);
    setAuthError("");
    try {
      setUser(await api<SessionUser>("/api/auth/me", token));
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) {
        onLogout();
        return;
      }
      setAuthError(reason instanceof Error ? reason.message : "Could not load your restaurant account");
    } finally {
      setAuthLoading(false);
    }
  }, [onLogout, token]);

  const loadMenu = useCallback(async () => {
    const next = await api<Category[]>("/api/admin/menu", token);
    const missingOptions = next.flatMap(category => category.items.filter(item => item.options === undefined));
    if (missingOptions.length) {
      const options = await Promise.all(missingOptions.map(item => api<MenuItemOption[]>(`/api/admin/menu/items/${item.id}/options`, token)));
      const byItem = new Map(missingOptions.map((item, index) => [item.id, options[index]]));
      for (const category of next) {
        category.items = category.items.map(item => item.options === undefined ? { ...item, options: byItem.get(item.id) || [] } : item);
      }
    }
    setCategories(next);
  }, [token]);
  const loadTables = useCallback(async () => setTables(await api<DiningTable[]>("/api/admin/tables", token)), [token]);
  const loadStaff = useCallback(async () => setStaff(await api<StaffMember[]>("/api/admin/staff", token)), [token]);
  const loadPayments = useCallback(async () => {
    const methodsPromise = api<PaymentMethodAdmin[]>("/api/admin/payment-methods", token);
    const merchantPromise = ["OWNER", "MANAGER"].includes(role) ? api<CardMerchantConfig>("/api/admin/card-merchant", token) : Promise.resolve(null);
    const [methods, merchant] = await Promise.all([methodsPromise, merchantPromise]);
    setPayments(methods);
    setCardMerchant(merchant);
  }, [role, token]);
  const loadVerificationOrders = useCallback(async () => {
    setVerificationOrders(await api<Order[]>("/api/orders/active", token));
  }, [token]);
  const loadPaymentWorkspace = useCallback(async () => {
    await Promise.all([loadPayments(), loadVerificationOrders()]);
  }, [loadPayments, loadVerificationOrders]);
  const loadBilling = useCallback(async () => setBilling(await api<Billing>("/api/admin/billing", token)), [token]);
  const loadSettings = useCallback(async () => {
    const [profile, limits, tickets] = await Promise.all([
      api<RestaurantSettings>("/api/admin/settings", token),
      api<Entitlements>("/api/admin/entitlements", token),
      api<SupportTicket[]>("/api/admin/support-tickets", token),
    ]);
    setSettings(profile);
    setEntitlements(limits);
    setSupportTickets(tickets);
  }, [token]);

  useEffect(() => {
    document.body.classList.remove("console-theme-dark", "console-theme-light");
    document.body.classList.add(`console-theme-${theme}`);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);
  useEffect(() => { void loadUser(); }, [loadUser]);
  useEffect(() => {
    if (!user) return;
    if (!visiblePages.includes(page)) setPage(visiblePages[0] || "kds");
  }, [page, user, visiblePages]);
  useEffect(() => {
    if (!user || !visiblePages.includes(page)) return;
    setError("");
    const load = page === "menu" ? loadMenu : page === "tables" ? loadTables : page === "payments" ? loadPaymentWorkspace : page === "staff" ? loadStaff : page === "settings" ? loadSettings : page === "billing" ? loadBilling : null;
    if (load) void run(load, "");
  }, [page, loadBilling, loadMenu, loadPaymentWorkspace, loadSettings, loadStaff, loadTables, run, user, visiblePages]);

  async function uploadAsset(kind: "logo" | "cover" | "menu-item", file: File) {
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Could not read image"));
      reader.readAsDataURL(file);
    });
    return (await api<{ url: string }>("/api/admin/assets", token, { method: "POST", body: JSON.stringify({ kind, data }) })).url;
  }

  async function safeUploadAsset(kind: "logo" | "cover" | "menu-item", file: File) {
    const result = await run(() => uploadAsset(kind, file), "");
    return result.ok ? result.value : null;
  }

  async function saveItem(data: Partial<MenuItem> & { categoryId: string; name: string; price: number }) {
    return mutate(async () => {
      await api(data.id ? `/api/admin/menu/items/${data.id}` : "/api/admin/menu/items", token, { method: data.id ? "PATCH" : "POST", body: JSON.stringify(data) });
      await loadMenu();
    });
  }

  const notifyFromKds = useCallback((message: string, isError?: boolean) => {
    if (isError) showError(message);
    else showSuccess(message);
  }, [showError, showSuccess]);

  function signOut() {
    void api("/api/auth/logout", token, { method: "POST" }).catch(() => undefined).finally(onLogout);
  }

  if (!user) {
    return <main className="dashboard-gate" aria-live="polite">
      <img src={BRAND_WORDMARK} alt={PRODUCT_NAME} onError={event => { event.currentTarget.hidden = true; }} />
      {authLoading ? <><div className="loading-spinner" aria-hidden="true" /><h1>Opening your restaurant…</h1></> : <><h1>We couldn’t open the console</h1><p>{authError}</p><div><button onClick={() => void loadUser()}>Try again</button><button className="secondary-action" onClick={onLogout}>Return to sign in</button></div></>}
    </main>;
  }

  if (!visiblePages.length) {
    return <main className="dashboard-gate"><h1>No workspace is assigned</h1><p>Ask the restaurant owner to update your staff role.</p><button onClick={signOut}>Sign out</button></main>;
  }

  return <div className={`console-shell theme-${theme}`} aria-busy={busy}><a className="skip-link" href="#console-main">Skip to main content</a><div className="console-body">
    <aside className="console-sidebar" aria-label="Restaurant navigation"><nav className="console-switcher">
      <div className="console-brand console-brand-in-panel"><img className="console-brand-wordmark" src={BRAND_WORDMARK} alt="" onError={event => { event.currentTarget.hidden = true; }} /><strong>{PRODUCT_NAME}</strong></div>
      <div className="console-menu-scroll" role="group" aria-label="Console pages">{visiblePages.map(item => <button key={item} type="button" className={`console-tab ${page === item ? "active" : ""}`} aria-current={page === item ? "page" : undefined} onClick={() => setPage(item)}>{LABEL[item]}</button>)}</div>
      <button type="button" className="mobile-nav-signout" onClick={signOut}>Sign out</button>
    </nav></aside>
    <main id="console-main" tabIndex={-1} className={`console-view page-${page}`}><header className="console-header"><div><p>{user.restaurant.name}</p><h1>{LABEL[page]}</h1></div><div className="header-actions">
      <button type="button" className={`theme-toggle ${theme}`} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} onClick={() => setTheme(current => current === "dark" ? "light" : "dark")}><ThemeIcon theme={theme} /></button><div className={`live ${navigator.onLine ? "" : "offline"}`}><i /> {navigator.onLine ? "Live" : "Offline"}</div><button type="button" className="signout" onClick={signOut}>Sign out</button>
    </div></header>
    {error && <div className="error console-prompt" role="alert">{error}</div>}{success && <div className="toast-inline console-prompt" role="status">{success}</div>}
    <Suspense fallback={<section className="operations-card" aria-live="polite"><p>Loading workspace…</p></section>}>
      {page === "kds" && <KdsPage token={token} canManage={Boolean(user.capabilities?.includes("kds.manage"))} canPrepare={canPrepare} onMessage={notifyFromKds} />}
      {page === "menu" && <MenuPage categories={categories} canManage={canManageMenu} onAddCategory={data => mutate(async () => { await api("/api/admin/menu/categories", token, { method: "POST", body: JSON.stringify(data) }); await loadMenu(); })} onSaveItem={saveItem} onDeleteItem={item => mutate(async () => { await api(`/api/admin/menu/items/${item.id}`, token, { method: "DELETE" }); await loadMenu(); })} onSaveOption={(itemId, data) => mutate(async () => { await api(`/api/admin/menu/items/${itemId}/options`, token, { method: "POST", body: JSON.stringify(data) }); await loadMenu(); })} onUpload={safeUploadAsset} />}
      {page === "tables" && <TablesPage tables={tables} canManage={canManageTables} onAdd={data => mutate(async () => { await api("/api/admin/tables", token, { method: "POST", body: JSON.stringify(data) }); await loadTables(); })} onEdit={(table, data) => mutate(async () => { await api(`/api/admin/tables/${table.id}`, token, { method: "PATCH", body: JSON.stringify(data) }); await loadTables(); })} onToggle={table => mutate(async () => { await api(`/api/admin/tables/${table.id}`, token, { method: "PATCH", body: JSON.stringify({ isActive: !table.isActive }) }); await loadTables(); })} onDelete={table => mutate(async () => { await api(`/api/admin/tables/${table.id}`, token, { method: "DELETE" }); await loadTables(); })} onQr={table => api(`/api/admin/tables/${table.id}/qr`, token)} />}
      {page === "payments" && <PaymentsPage methods={payments} cardMerchant={cardMerchant} verificationOrders={verificationOrders} canConfigureUpi={canConfigureUpi} canConfigureCard={canConfigureCard} canVerifyPayments={canVerifyPayments} onAdd={data => mutate(async () => { await api("/api/admin/payment-methods", token, { method: "POST", body: JSON.stringify(data) }); await loadPayments(); })} onToggle={method => mutate(async () => { await api(`/api/admin/payment-methods/${method.id}`, token, { method: "PATCH", body: JSON.stringify({ isActive: !method.isActive }) }); await loadPayments(); })} onDelete={method => mutate(async () => { await api(`/api/admin/payment-methods/${method.id}`, token, { method: "DELETE" }); await loadPayments(); })} onConnectCard={data => mutate(async () => { setCardMerchant(await api<CardMerchantConfig>("/api/admin/card-merchant", token, { method: "PUT", body: JSON.stringify(data) })); })} onDisconnectCard={() => mutate(async () => { await api("/api/admin/card-merchant", token, { method: "DELETE" }); await loadPayments(); })} onVerifyPayment={(order, paymentStatus) => mutate(async () => { await api(`/api/orders/${order.id}/payment-status`, token, { method: "PATCH", body: JSON.stringify({ status: paymentStatus }) }); await loadVerificationOrders(); }, paymentStatus === "paid" ? "Payment confirmed" : "Payment returned to pending")} onRefreshVerification={loadVerificationOrders} />}
      {page === "staff" && <StaffPage staff={staff} onAdd={data => mutate(async () => { await api("/api/admin/staff", token, { method: "POST", body: JSON.stringify(data) }); await loadStaff(); })} onToggle={member => mutate(async () => { await api(`/api/admin/staff/${member.id}`, token, { method: "PATCH", body: JSON.stringify({ isActive: !member.isActive }) }); await loadStaff(); })} />}
      {page === "settings" && settings && entitlements && <SettingsPage settings={settings} entitlements={entitlements} supportTickets={supportTickets} canOpenBilling={role === "OWNER"} onCreateSupportTicket={data => mutate(async () => { await api("/api/admin/support-tickets", token, { method: "POST", body: JSON.stringify(data) }); await loadSettings(); })} onSave={data => mutate(async () => { await api("/api/admin/settings", token, { method: "PATCH", body: JSON.stringify(data) }); await loadSettings(); })} onUpload={safeUploadAsset} onOpenBilling={() => setPage("billing")} />}
      {page === "billing" && <BillingPage billing={billing} onCheckout={plan => { void mutate(async () => { const result = await api<{ checkoutUrl: string | null }>("/api/admin/billing/checkout", token, { method: "POST", body: JSON.stringify({ plan }) }); if (result.checkoutUrl) window.location.assign(result.checkoutUrl); else await loadBilling(); }); }} onCancel={() => { void mutate(async () => { await api("/api/admin/billing/cancel", token, { method: "POST" }); await loadBilling(); }); }} />}
    </Suspense></main>
  </div></div>;
}

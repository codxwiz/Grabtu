import React, { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { io } from "socket.io-client";
import type { MenuItemOption, MenuResponse, Order } from "@whitelabel/shared-types";
import { LegalPage, MarketingSite, type MarketingPageKey } from "./MarketingSite";
import "./styles.css";
import "./payments.css";
import "./a11y.css";
import "./marketing.css";
import "./cinematic-actions.css";
import "./dynamic-upi.css";

const API = import.meta.env.VITE_API_ORIGIN || `${location.protocol}//${location.hostname}:4000`;
const money = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);
const DEMO_TABLE_TOKEN = "white_label-demo-table";
type RazorpayResult={razorpay_payment_id:string;razorpay_order_id:string;razorpay_signature:string};
type UpiLaunchOption={id:"google_pay"|"phonepe"|"paytm"|"generic_upi";label:string};
type DynamicUpiPayment={paymentId:string;orderId:string;transactionReference:string;amountPaise:number;currency:"INR";merchantName:string;merchantVpa:string;status:string;selectedApp?:string|null;customerReference?:string|null;expiresAt:string;qrImageData:string;launchOptions:UpiLaunchOption[]};
type CustomerServiceRequest={id:string;type:string;status:"OPEN"|"ACKNOWLEDGED"|"RESOLVED"|"CANCELLED";createdAt:string};
type RazorpayCheckoutOptions={key:string;amount:number;currency:string;name:string;description:string;order_id:string;handler:(result:RazorpayResult)=>void;modal:{ondismiss:()=>void};theme:{color:string}};
declare global{interface Window{Razorpay:new(options:RazorpayCheckoutOptions)=>{open:()=>void}}}
let razorpayScript:Promise<void>|null=null;
function loadRazorpayCheckout(){if(window.Razorpay)return Promise.resolve();if(!razorpayScript)razorpayScript=new Promise((resolve,reject)=>{const script=document.createElement("script");script.src="https://checkout.razorpay.com/v1/checkout.js";script.async=true;script.onload=()=>resolve();script.onerror=()=>reject(new Error("Secure card checkout could not load"));document.head.appendChild(script)});return razorpayScript}
function ActionIcon({kind}:{kind:"waiter"|"upi"|"card"|"counter"}){const common={width:18,height:18,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:1.8,strokeLinecap:"round" as const,strokeLinejoin:"round" as const,"aria-hidden":true};if(kind==="waiter")return <svg {...common}><path d="M4 16h16M6 16a6 6 0 0 1 12 0M12 7V5M3 20h18"/></svg>;if(kind==="upi")return <svg {...common}><rect x="5" y="2.5" width="14" height="19" rx="2"/><path d="M9 6h6M10 18h4"/></svg>;if(kind==="card")return <svg {...common}><rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 9h19M6 15h4"/></svg>;return <svg {...common}><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6M9 12h6"/></svg>}

function getCustomerRoute() {
  const path = location.pathname.split("/");
  const hashPreview = location.hash.startsWith("#c") || location.hash === "#demo-menu";
  const isTokenRoute = path[1] === "t";
  const isOrderingRoute = isTokenRoute || (path[1] === "r" && path[3] === "table") || hashPreview;
  return { path, hashPreview, isTokenRoute, isOrderingRoute };
}

const legalRouteKinds = new Set(["privacy", "terms", "retention", "support", "shipping", "refunds"] as const);
const marketingRouteKinds = new Set(["services", "pricing", "about", "contact"] as const);

function getLegalRouteKind() {
  const route = location.pathname.split("/")[1];
  return legalRouteKinds.has(route as "privacy" | "terms" | "retention" | "support" | "shipping" | "refunds")
    ? (route as "privacy" | "terms" | "retention" | "support" | "shipping" | "refunds")
    : null;
}

function getMarketingRouteKind(): MarketingPageKey {
  const route = location.pathname.split("/")[1];
  if(!route)return "home";
  if (marketingRouteKinds.has(route as "services" | "pricing" | "about" | "contact")) {
    return route as "services" | "pricing" | "about" | "contact";
  }
  return "not-found";
}

const demoMenu: MenuResponse = {
  restaurant: {
    id: "rest_demo",
    name: "Copper & Clove",
    slug: "demo-bistro",
    tagline: "Small-batch spice · fresh plate service",
    currency: "INR",
    orderingEnabled: true,
    orderPauseMessage: "",
    taxPercent: 5,
    serviceChargePercent: 2,
    brandColor: "#17372b",
    coverImageUrl: "",
    logoUrl: "",
  },
  table: { id: "table_demo_1", label: "Table 7", qrToken: "demo-token" },
  categories: [
    {
      id: "cat_1",
      name: "Starters",
      sortOrder: 1,
      items: [
        {
          id: "m1",
          categoryId: "cat_1",
          name: "Tandoori Mushroom",
          description: "Char-grilled button mushrooms",
          price: 220,
          isAvailable: true,
          isVeg: true,
          tags: ["Chef's pick"],
          prepMinutes: 12,
          options: [
            { id: "opt_1", name: "Extra mushrooms", priceDelta: 40, isAvailable: true },
          ],
        },
        {
          id: "m2",
          categoryId: "cat_1",
          name: "Corn & Peanut Chaat",
          description: "Crunchy, tangy and toasted with lime",
          price: 180,
          isAvailable: true,
          isVeg: true,
          tags: [],
          prepMinutes: 8,
        },
      ],
    },
    {
      id: "cat_2",
      name: "Mains",
      sortOrder: 2,
      items: [
        {
          id: "m3",
          categoryId: "cat_2",
          name: "Smoked Paneer Kofta",
          description: "Creamy tomato curry with charred kofta",
          price: 280,
          isAvailable: true,
          isVeg: true,
          tags: ["House favorite"],
          prepMinutes: 16,
        },
        {
          id: "m4",
          categoryId: "cat_2",
          name: "Kadai Chicken",
          description: "Rustic onion gravy with coriander",
          price: 320,
          isAvailable: true,
          isVeg: false,
          tags: [],
          prepMinutes: 18,
        },
      ],
    },
    {
      id: "cat_3",
      name: "Breads",
      sortOrder: 3,
      items: [
        {
          id: "m5",
          categoryId: "cat_3",
          name: "Butter Naan",
          description: "Soft naan brushed with butter",
          price: 55,
          isAvailable: true,
          isVeg: true,
          tags: [],
          prepMinutes: 6,
        },
        {
          id: "m6",
          categoryId: "cat_3",
          name: "Lachha Paratha",
          description: "Flaky layered bread",
          price: 70,
          isAvailable: true,
          isVeg: true,
          tags: [],
          prepMinutes: 7,
        },
      ],
    },
    {
      id: "cat_4",
      name: "Drinks",
      sortOrder: 4,
      items: [
        {
          id: "m7",
          categoryId: "cat_4",
          name: "Masala Chaas",
          description: "Spiced buttermilk with cumin",
          price: 90,
          isAvailable: true,
          isVeg: true,
          tags: ["Refreshing"],
          prepMinutes: 4,
        },
      ],
    },
  ],
  paymentMethods: [
    {
      id: "pm_1",
      provider: "google_pay",
      displayName: "Pay with Google Pay",
      upiId: "copper.clove@okaxis",
      qrImageData:
        "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMDAiIGhlaWdodD0iMjAwIiB2aWV3Qm94PSIwIDAgMjAwIDIwMCI+PHJlY3Qgd2lkdGg9IjIwMCIgaGVpZ2h0PSIyMDAiIGZpbGw9IiNmNGYyZWIiLz48cmVjdCB4PSIzMCIgeT0iMzAiIHdpZHRoPSI0NSIgaGVpZ2h0PSI0NSIgZmlsbD0iIzE3MzczYiIvPjxyZWN0IHg9IjgxIiB5PSIzMCIgd2lkdGg9IjQ1IiBoZWlnaHQ9IjQ1IiBmaWxsPSIjMTczNzNiIi8+PHJlY3QgeD0iMTMyIiB5PSIzMCIgd2lkdGg9IjM4IiBoZWlnaHQ9IjM4IiBmaWxsPSIjMTczNzNiIi8+PHJlY3QgeD0iMzAiIHk9Ijg2IiB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIGZpbGw9IiMxNzM3M2IiLz48cmVjdCB4PSI2MCIgeT0iODYiIHdpZHRoPSI1MCIgaGVpZ2h0PSI1MCIgZmlsbD0iIzE3MzczYiIvPjxyZWN0IHg9IjEyOCIgeT0iOTAiIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgZmlsbD0iIzE3MzczYiIvPjxyZWN0IHg9IjcwIiB5PSIxNTAiIHdpZHRoPSI2MCIgaGVpZ2h0PSIyMCIgZmlsbD0iIzE3MzczYiIvPjwvc3ZnPg==",
    },
  ],
};

function LoadingMenu() {
  return (
    <main className="menu-skeleton" aria-label="Loading menu">
      <div />
      <div />
      <div />
      <div />
    </main>
  );
}

function App() {
  const legalKind = getLegalRouteKind();
  const marketingKind = getMarketingRouteKind();
  const { isOrderingRoute } = getCustomerRoute();
  const menuPreviewHref = "/r/demo-bistro/table/T7";
  const dashboardHref = import.meta.env.VITE_DASHBOARD_ORIGIN || `${location.protocol}//${location.hostname}:5174`;
  const currentPath = location.pathname;

  if (legalKind) {
    return (
      <LegalPage
        kind={legalKind}
        dashboardHref={dashboardHref}
        menuPreviewHref={menuPreviewHref}
        currentPath={currentPath}
      />
    );
  }

  if (!isOrderingRoute) {
    return (
      <MarketingSite
        dashboardHref={dashboardHref}
        menuPreviewHref={menuPreviewHref}
        currentPath={currentPath}
        page={marketingKind}
      />
    );
  }

  return <CustomerMenuApp />;
}

function CustomerMenuApp() {
  const [menu, setMenu] = useState<MenuResponse>();
  const [tableToken, setTableToken] = useState("");
  const orderIdempotencyRef=useRef(crypto.randomUUID());
  const [cart, setCart] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [order, setOrder] = useState<Order>();
  const [checkout, setCheckout] = useState(false);
  const [orderSheetExpanded, setOrderSheetExpanded] = useState(false);
  const [paymentMode, setPaymentMode] = useState<"upi" | "card" | "counter" | null>(null);
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [upiPayment, setUpiPayment] = useState<DynamicUpiPayment>();
  const [selectedUpiApp, setSelectedUpiApp] = useState<UpiLaunchOption["id"] | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [activeCategory, setActiveCategory] = useState("");
  const [waiterPending, setWaiterPending] = useState(false);
  const [waiterRequests, setWaiterRequests] = useState<CustomerServiceRequest[]>([]);
  const waiterResetTimer = useRef<number | null>(null);
  const demoStatusInitialized = useRef(false);

  const { path, hashPreview, isTokenRoute } = getCustomerRoute();
  const slug = path[2] || "demo-bistro";
  const tableCode = path[4] || (hashPreview ? "T7" : "T1");
  const qrToken = isTokenRoute ? path[2] : "";
  const allowDemoFallback = slug === "demo-bistro" || hashPreview || /localhost|127\.0\.0\.1/i.test(location.hostname);

  useEffect(() => () => {
    if (waiterResetTimer.current !== null) window.clearTimeout(waiterResetTimer.current);
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    (async () => {
      try {
        let url = `${API}/api/menu/${slug}?tableId=${tableCode}`;
        let next = isTokenRoute ? "" : DEMO_TABLE_TOKEN;

        if (isTokenRoute) {
          const response = await fetch(`${API}/api/auth/table-session/${qrToken}`, { signal: controller.signal });
          const session = await response.json();
          if (!response.ok || !session.tableToken) throw new Error(session.message || "Invalid table QR");
          next = session.tableToken;
          url = `${API}/api/menu/by-token/${qrToken}`;
        }

        const response = await fetch(url, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || "Could not load this menu");
        setTableToken(next);
        setMenu(data);
        setActiveCategory(data.categories[0]?.id || "");
        setOrderSheetExpanded(false);
      } catch (reason) {
        if ((reason as Error).name === "AbortError") return;
        if (!isTokenRoute && allowDemoFallback) {
          setTableToken(DEMO_TABLE_TOKEN);
          setMenu(demoMenu);
          setActiveCategory(demoMenu.categories[0]?.id || "");
          setNotice("Showing the local customer menu preview.");
          setOrderSheetExpanded(false);
          return;
        }
        setError(reason instanceof Error ? reason.message : "Could not load this menu");
      }
    })();

    return () => controller.abort();
  }, [slug, tableCode, isTokenRoute, qrToken]);

  useEffect(() => {
    if (!menu || tableToken === DEMO_TABLE_TOKEN) return;
    const socket = io(API, { auth: tableToken ? { token: tableToken } : undefined });
    socket.emit("join:table", menu.table.id);
    socket.on("order:updated", setOrder);
    socket.on("service-request:updated", (request: CustomerServiceRequest) => {
      if (request.type !== "WAITER") return;
      setWaiterRequests(current => {
        const remaining = current.filter(item => item.id !== request.id);
        return request.status === "OPEN" || request.status === "ACKNOWLEDGED" ? [...remaining, request] : remaining;
      });
    });
    return () => {
      socket.close();
    };
  }, [menu, tableToken]);

  useEffect(() => {
    if (!menu || !tableToken || tableToken === DEMO_TABLE_TOKEN) return;
    const controller = new AbortController();
    void fetch(`${API}/api/table/service-requests`, { headers: { "X-Table-Token": tableToken }, cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) return;
        const requests = await response.json() as CustomerServiceRequest[];
        setWaiterRequests(requests.filter(request => request.type === "WAITER"));
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [menu, tableToken]);

  const items = menu?.categories.flatMap(category => category.items) || [];
  const count = Object.values(cart).reduce((sum, value) => sum + value, 0);
  const unitPrice = (item: { id: string; price: number; options?: MenuItemOption[] }) =>
    item.price + (item.options || []).filter(option => (selected[item.id] || []).includes(option.id)).reduce((sum, option) => sum + option.priceDelta, 0);
  const orderLines = useMemo(
    () =>
      Object.entries(cart)
        .filter(([, quantity]) => quantity)
        .map(([menuItemId, quantity]) => {
          const item = items.find(candidate => candidate.id === menuItemId);
          return {
            id: menuItemId,
            quantity,
            name: item?.name || "Item",
            price: item ? unitPrice(item) : 0,
          };
        }),
    [cart, items, selected],
  );
  const subtotal = useMemo(() => items.reduce((sum, item) => sum + (cart[item.id] || 0) * unitPrice(item), 0), [items, cart, selected]);
  const tax = Math.round(subtotal * ((menu?.restaurant.taxPercent || 0) / 100));
  const serviceCharge = Math.round(subtotal * ((menu?.restaurant.serviceChargePercent || 0) / 100));
  const total = subtotal + tax + serviceCharge;
  const payment = menu?.paymentMethods.find(method => method.id === (order?.paymentMethod?.id || paymentMethodId));
  const demoMode = tableToken === DEMO_TABLE_TOKEN;
  const scanStatus = (menu?.table.qrToken || demoMode) ? "SCAN CONFIRMED" : "SCAN MENU";
  const waiterAcknowledged = waiterRequests.some(request => request.status === "ACKNOWLEDGED");

  useEffect(() => {
    if (!menu || !demoMode || order || demoStatusInitialized.current || new URLSearchParams(location.search).get("demo") !== "status") return;
    const firstItem = menu.categories.flatMap(category => category.items)[0];
    if (!firstItem) return;
    demoStatusInitialized.current = true;
    const now = new Date().toISOString();
    setOrder({
      id: "DEMO-1001",
      trackingToken: "demo-tracking",
      restaurantId: menu.restaurant.id,
      tableId: menu.table.id,
      tableLabel: menu.table.label,
      status: "new",
      items: [{ id: "demo-line-1", menuItemId: firstItem.id, name: firstItem.name, quantity: 1, unitPrice: firstItem.price }],
      totalAmount: firstItem.price,
      taxAmount: 0,
      serviceChargeAmount: 0,
      paymentStatus: "pay_at_counter",
      estimatedReadyAt: new Date(Date.now() + 12 * 60_000).toISOString(),
      createdAt: now,
      updatedAt: now,
    });
    setNotice("Demo order status updates automatically.");
  }, [menu, demoMode, order]);

  useEffect(() => {
    if (!demoMode || !order || order.trackingToken !== "demo-tracking") return;
    const nextStatus = ({ new: "accepted", accepted: "preparing", preparing: "ready", ready: "served" } as const)[order.status as "new" | "accepted" | "preparing" | "ready"];
    if (!nextStatus) return;
    const delay = order.status === "new" ? 1800 : order.status === "ready" ? 5000 : 3000;
    const timer = window.setTimeout(() => {
      setOrder(current => current?.trackingToken === "demo-tracking"
        ? { ...current, status: nextStatus, updatedAt: new Date().toISOString() }
        : current);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [demoMode, order?.id, order?.status]);

  function add(itemId: string, change: number) {
    if (!menu?.restaurant.orderingEnabled) return;
    setCart(current => {
      const nextQuantity = Math.max(0, (current[itemId] || 0) + change);
      return { ...current, [itemId]: nextQuantity };
    });
  }
  function toggleOption(itemId: string, optionId: string) {
    setSelected(current => ({
      ...current,
      [itemId]: (current[itemId] || []).includes(optionId) ? current[itemId].filter(id => id !== optionId) : [...(current[itemId] || []), optionId],
    }));
  }

  async function createDynamicUpiPayment(nextOrder: Order) {
    const response=await fetch(`${API}/api/customer/orders/${nextOrder.id}/payments/upi`,{method:"POST",headers:{"Content-Type":"application/json","X-Table-Token":tableToken},body:JSON.stringify({trackingToken:nextOrder.trackingToken,paymentMethodId})});
    const data=await response.json();
    if(!response.ok)throw new Error(data.message||"Could not create the UPI payment request");
    setUpiPayment(data);
    setSelectedUpiApp(data.selectedApp || "");
    return data as DynamicUpiPayment;
  }

  async function launchUpiApp(app: UpiLaunchOption["id"]) {
    if(!order||!upiPayment)return;
    try{
      const response=await fetch(`${API}/api/customer/orders/${order.id}/payments/${upiPayment.paymentId}/retry-launch`,{method:"POST",headers:{"Content-Type":"application/json","X-Table-Token":tableToken},body:JSON.stringify({app})});
      const data=await response.json();
      if(!response.ok)throw new Error(data.message||"Could not open the selected UPI app");
      if(typeof data.launchUrl!=="string"||!/^(upi|tez|phonepe|paytmmp):\/\//.test(data.launchUrl))throw new Error("The payment app link was invalid");
      window.location.href=data.launchUrl;
    }catch(reason){setError(reason instanceof Error?reason.message:"Could not open the selected UPI app")}
  }

  useEffect(()=>{
    if(!order||!upiPayment||["paid","failed","expired","cancelled","requires_review"].includes(upiPayment.status))return;
    let cancelled=false;
    let delay=3000;
    let timer=window.setTimeout(poll,delay);
    async function poll(){
      try{
        const response=await fetch(`${API}/api/customer/orders/${order!.id}/payments/${upiPayment!.paymentId}`,{headers:{"X-Table-Token":tableToken},cache:"no-store"});
        if(response.ok){
          const data=await response.json() as DynamicUpiPayment;
          if(cancelled)return;
          setUpiPayment(data);
          if(["paid","failed","expired","cancelled","requires_review"].includes(data.status))return;
          delay=Math.min(delay+2000,10000);
        }
      }catch{}
      if(!cancelled)timer=window.setTimeout(poll,delay);
    }
    return()=>{cancelled=true;window.clearTimeout(timer)};
  },[order?.id,upiPayment?.paymentId,upiPayment?.status,tableToken]);

  async function place() {
    if (!menu || !count) return;
    setBusy(true);
    setError("");
    try {
      if (demoMode) {
        const demoOrder: Order = {
          id: "EQ-1001",
          trackingToken: "demo-tracking",
          restaurantId: menu.restaurant.id,
          tableId: menu.table.id,
          tableLabel: menu.table.label,
          status: "new",
          items: Object.entries(cart)
            .filter(([, quantity]) => quantity)
            .map(([menuItemId, quantity]) => {
              const item = items.find(candidate => candidate.id === menuItemId);
              return {
                id: `${menuItemId}-${quantity}`,
                menuItemId,
                name: item?.name || "Item",
                quantity,
                unitPrice: item ? unitPrice(item) : 0,
                notes: notes[menuItemId] || undefined,
                options: (selected[menuItemId] || []).map(optionId => ({
                  id: optionId,
                  name: item?.options?.find(option => option.id === optionId)?.name || "Option",
                  priceDelta: item?.options?.find(option => option.id === optionId)?.priceDelta || 0,
                })),
              };
            }),
          totalAmount: total,
          taxAmount: tax,
          serviceChargeAmount: serviceCharge,
          paymentStatus: paymentMethodId ? "pending" : "pay_at_counter",
          paymentMethod: paymentMethodId ? { id: paymentMethodId, provider: payment?.provider || "google_pay", displayName: payment?.displayName || "Pay with Google Pay" } : undefined,
          paymentReference: undefined,
          estimatedReadyAt: new Date(Date.now() + 18 * 60_000).toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        setOrder(demoOrder);
        setCart({});
        setCheckout(false);
        setNotice("Demo order placed locally.");
        return;
      }

      const response = await fetch(`${API}/api/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": orderIdempotencyRef.current, "X-Table-Token": tableToken },
        body: JSON.stringify({
          restaurantId: menu.restaurant.id,
          tableId: menu.table.id,
          tableLabel: menu.table.label,
          paymentMethodId: paymentMethodId || undefined,
          paymentMode: paymentMode || "counter",
          items: Object.entries(cart)
            .filter(([, quantity]) => quantity)
            .map(([menuItemId, quantity]) => ({ menuItemId, quantity, optionIds: selected[menuItemId] || [], notes: notes[menuItemId] || undefined })),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message);
      if(paymentMode==="card"){
        const checkoutResponse=await fetch(`${API}/api/orders/${data.id}/card-checkout`,{method:"POST",headers:{"Content-Type":"application/json","X-Table-Token":tableToken},body:JSON.stringify({trackingToken:data.trackingToken})});
        const checkout=await checkoutResponse.json();
        if(!checkoutResponse.ok)throw new Error(checkout.message||"Could not start card checkout");
        await loadRazorpayCheckout();
        const widget=new window.Razorpay({key:checkout.keyId,amount:checkout.amount,currency:checkout.currency,name:checkout.restaurantName,description:`Order ${data.id}`,order_id:checkout.razorpayOrderId,theme:{color:menu.restaurant.brandColor||"#17372b"},modal:{ondismiss:()=>setError("Payment was not completed. Your cart is still available.")},handler:async(result)=>{try{setBusy(true);const confirmationResponse=await fetch(`${API}/api/orders/${data.id}/card-confirm`,{method:"POST",headers:{"Content-Type":"application/json","X-Table-Token":tableToken},body:JSON.stringify({trackingToken:data.trackingToken,...result})});const confirmed=await confirmationResponse.json();if(!confirmationResponse.ok&&confirmationResponse.status!==202)throw new Error(confirmed.message||"Payment confirmation failed");setOrder(confirmationResponse.status===202?data:confirmed);setCart({});setCheckout(false);orderIdempotencyRef.current=crypto.randomUUID();setNotice(confirmationResponse.status===202?"Payment received and awaiting bank confirmation.":"Card payment confirmed.")}catch(reason){setError(reason instanceof Error?reason.message:"Could not confirm card payment")}finally{setBusy(false)}}});
        widget.open();
        return;
      }
      if(paymentMode==="upi")await createDynamicUpiPayment(data);
      setOrder(data);
      setCart({});
      setCheckout(false);
      orderIdempotencyRef.current=crypto.randomUUID();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not place order");
    } finally {
      setBusy(false);
    }
  }

  async function reportPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!order?.trackingToken) return;
    setBusy(true);
    try {
      if (demoMode) {
        setNotice("Payment reported to the restaurant.");
        return;
      }
      const dynamicEndpoint=upiPayment?`/api/customer/orders/${order.id}/payments/${upiPayment.paymentId}/report-paid`:`/api/orders/${order.id}/payment-report`;
      const response = await fetch(`${API}${dynamicEndpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json",...(upiPayment?{"X-Table-Token":tableToken}:{}) },
        body: JSON.stringify({ trackingToken: order.trackingToken }),
      });
      const updated = await response.json();
      if (!response.ok) throw new Error(updated.message);
      if(updated.payment)setUpiPayment(updated.payment);
      setOrder(updated.order||updated);
      setNotice("Payment reported. The restaurant will verify it before marking it paid.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not submit reference");
    } finally {
      setBusy(false);
    }
  }

  async function request(type: string) {
    if (!tableToken) return;
    setBusy(true);
    try {
      if (demoMode) {
        if (type === "WAITER") setWaiterRequests(current => [...current, { id: crypto.randomUUID(), type: "WAITER", status: "OPEN", createdAt: new Date().toISOString() }]);
        if (type === "WAITER") startWaiterCooldown();
        setNotice("Request sent. A team member will be with you shortly.");
        return;
      }
      const response = await fetch(`${API}/api/table/service-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Table-Token": tableToken },
        body: JSON.stringify({ type }),
      });
      const created = await response.json() as CustomerServiceRequest & {message?:string};
      if (!response.ok) throw new Error(created.message);
      if (type === "WAITER") setWaiterRequests(current => [...current, created]);
      if (type === "WAITER") startWaiterCooldown();
      setNotice("Request sent. A team member will be with you shortly.");
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  function startWaiterCooldown() {
    setWaiterPending(true);
    if (waiterResetTimer.current !== null) window.clearTimeout(waiterResetTimer.current);
    waiterResetTimer.current = window.setTimeout(() => {
      setWaiterPending(false);
      waiterResetTimer.current = null;
    }, 30_000);
  }

  async function feedback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!order?.trackingToken) return;
    const form = new FormData(event.currentTarget);
    if (demoMode) {
      setNotice("Thank you for your feedback.");
      return;
    }
    const response = await fetch(`${API}/api/orders/${order.id}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trackingToken: order.trackingToken, rating: Number(form.get("rating")), comment: form.get("comment") }),
    });
    if (response.ok) setNotice("Thank you for your feedback.");
    else setError((await response.json()).message);
  }

  if (!menu) {
    return error ? (
      <main className="center error-page">
        <h1>We couldn’t open this menu</h1>
        <p>{error}</p>
        <button onClick={() => location.reload()}>Try again</button>
      </main>
    ) : (
      <LoadingMenu />
    );
  }

  if (order) {
    const estimate = order.estimatedReadyAt ? new Date(order.estimatedReadyAt) : null;
    const steps = ["new", "accepted", "preparing", "ready", "served"];
    const currentStep = Math.max(0, steps.indexOf(order.status));
    return (
      <div className="customer-stage"><main className="phone tracking-phone">
        <header className="phone-head"><h1>{menu.restaurant.name}</h1><div className="table-token"><span />{menu.table.label.toUpperCase()} · SCAN CONFIRMED</div></header>
        {order.status !== "served" ? <section className="status-screen">
          <div className="status-track"><i style={{ width: `${currentStep / (steps.length - 1) * 100}%` }} />
            {steps.map((status, index) => <div className="status-step" key={status}><b className={index < currentStep ? "done" : index === currentStep ? "current" : ""}>{index < currentStep ? "✓" : index + 1}</b><span>{status === "accepted" ? "Placed" : status}</span></div>)}
          </div>
          <h2>{order.status === "ready" ? "Ready to serve!" : order.status === "preparing" ? "Preparing your food…" : "Order received"}</h2>
          <p>{menu.table.label} · Order #{order.id}</p>
          {estimate && <p className="estimate">Estimated ready by <strong>{estimate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</strong></p>}
          <span className={`payment-chip ${order.paymentStatus}`}>{order.paymentStatus === "paid" ? "Payment confirmed" : order.paymentStatus === "reported" ? "Verifying UPI…" : order.paymentStatus === "pending" ? order.paymentMode==="card"?"Card payment awaiting confirmation":"Complete UPI payment" : `Pay ${money(order.totalAmount)} at counter`}</span>
          {order.paymentStatus === "pending" && payment && <section className="pay-card dynamic-upi-card">{upiPayment?<><div className="dynamic-payment-summary"><span>Exact amount</span><strong>{money(upiPayment.amountPaise/100)}</strong><small>Order #{order.id} · {menu.table.label}</small><small>Paying {upiPayment.merchantName} · {upiPayment.merchantVpa}</small></div><div className="dynamic-qr-panel"><div className="dynamic-qr-frame"><img src={upiPayment.qrImageData} alt={`Dynamic UPI QR for order ${order.id}, amount ${money(upiPayment.amountPaise/100)}`} /></div><div><strong>Scan to pay</strong><p>Scan this unique QR using any UPI app. The amount and restaurant UPI ID are already included.</p><small>Expires {new Date(upiPayment.expiresAt).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</small></div></div><div className="payment-choice-divider"><span>or pay on this phone</span></div><div className="upi-wallet-picker"><label htmlFor="upi-wallet">Choose your UPI app</label><p>Select an installed payment app from the dropdown.</p><div className="premium-select"><span className="premium-select-mark" aria-hidden="true"><ActionIcon kind="upi"/></span><select id="upi-wallet" value={selectedUpiApp} onChange={event=>setSelectedUpiApp(event.target.value as UpiLaunchOption["id"]|"")}><option value="">Select a payment app</option>{upiPayment.launchOptions.map(option=><option value={option.id} key={option.id}>{option.label}</option>)}</select><svg className="premium-select-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg></div><button type="button" className="upi-continue" disabled={!selectedUpiApp} onClick={()=>selectedUpiApp&&void launchUpiApp(selectedUpiApp)}>{selectedUpiApp?`Continue with ${upiPayment.launchOptions.find(option=>option.id===selectedUpiApp)?.label}`:"Choose an app to continue"}<span aria-hidden="true">→</span></button></div><form onSubmit={reportPayment}><p>After completing payment, notify the restaurant for manual verification.</p><button disabled={busy}>{busy ? "Notifying…" : "I've completed the payment"}</button></form></>:<p>Preparing your secure UPI payment request…</p>}</section>}
          <button className={`call-waiter ${waiterPending ? "pending" : ""} ${waiterAcknowledged ? "acknowledged" : ""}`} onClick={() => void request("WAITER")} disabled={busy || waiterPending}><ActionIcon kind="waiter"/>{waiterAcknowledged && <span className="waiter-acknowledged">Acknowledged</span>}<span>{waiterPending && !waiterAcknowledged ? "Request sent" : "Call Waiter"}</span></button>
          <button className="outline-action" onClick={() => setOrder(undefined)}>Order something else</button>
        </section> : order.paymentMode === "upi" && order.paymentStatus === "paid" ? <form className="feedback-screen" onSubmit={feedback}><h2>How was your experience?</h2><p>Your feedback is sent directly to the restaurant dashboard on their phone.</p><div className="rating-row"><label><input type="radio" name="rating" value="2" required /><span>😕</span></label><label><input type="radio" name="rating" value="4" /><span>😊</span></label><label><input type="radio" name="rating" value="5" /><span>🤩</span></label></div><textarea name="comment" placeholder="Any comments? (optional)" /><button>Submit feedback</button><button type="button" className="skip" onClick={() => setOrder(undefined)}>Skip — no thanks</button></form> : <section className="feedback-screen"><h2>Thank you for dining with us</h2><p>Your order is complete.</p><button type="button" onClick={() => setOrder(undefined)}>Back to menu</button></section>}
        {notice && <div className="floating-toast" role="status">{notice}</div>}
      </main></div>
    );
  }

  const visibleCategory = menu.categories.find(category => category.id === activeCategory) || menu.categories[0];

  return (
    <div className="customer-stage" style={{ "--brand": menu.restaurant.brandColor || "#17372b" } as React.CSSProperties}>
      <div className="phone menu-phone">
        <header className="phone-head" style={menu.restaurant.coverImageUrl ? { backgroundImage: `linear-gradient(135deg, rgba(26,26,26,.9), rgba(44,44,44,.82)), url(${menu.restaurant.coverImageUrl})` } : undefined}>
          <div className="restaurant-identity">
            {menu.restaurant.logoUrl && <img className="customer-restaurant-logo" src={menu.restaurant.logoUrl} alt={`${menu.restaurant.name} logo`} decoding="async" />}
            <div><h1>{menu.restaurant.name}</h1>{menu.restaurant.tagline && <p>{menu.restaurant.tagline}</p>}</div>
          </div>
          <div className="table-token"><span />{menu.table.label.toUpperCase()} · {scanStatus}</div>
        </header>
        <nav className="category-tabs" aria-label="Menu categories">
          {menu.categories.map(category => <button type="button" className={category.id === visibleCategory?.id ? "active" : ""} onClick={() => setActiveCategory(category.id)} key={category.id}>{category.name}</button>)}
        </nav>
        {!menu.restaurant.orderingEnabled && <div className="paused-banner" role="alert">{menu.restaurant.orderPauseMessage || "Online ordering is temporarily paused"}</div>}
        {notice && <div className="toast-inline preview-toast" role="status">{notice}</div>}
        <main className="menu-list">
          {menu.categories.length === 0 && (
            <div className="empty-state">
              <h2>Menu coming soon</h2>
              <p>The restaurant is preparing its digital menu.</p>
            </div>
          )}
          {visibleCategory && <section id={visibleCategory.id} className="menu-section">
              {visibleCategory.items.map(item => (
                <article className="menu-item" key={item.id}>
                  {item.imageUrl && <img className="customer-menu-photo" src={item.imageUrl} alt={item.name} loading="lazy" decoding="async" />}
                  <div className="item-copy">
                    <div className="item-name"><span className={item.isVeg ? "veg-mark" : "nonveg-mark"} /><h3>{item.name}</h3></div>
                    <p>{item.description}</p>
                    <strong>{money(unitPrice(item))}</strong><small className="prep-time"> · {item.prepMinutes || 15} min</small>
                    {item.tags.map(tag => <small key={tag}>{tag}</small>)}
                    {item.options?.length ? (
                      <fieldset className="item-options">
                        <legend>Customize</legend>
                        {item.options.map(option => (
                          <label key={option.id}>
                            <input type="checkbox" checked={(selected[item.id] || []).includes(option.id)} onChange={() => toggleOption(item.id, option.id)} />
                            <span>{option.name}</span>
                            <small>{option.priceDelta ? `+${money(option.priceDelta)}` : "Included"}</small>
                          </label>
                        ))}
                      </fieldset>
                    ) : null}
                    {cart[item.id] > 0 && (
                      <label className="item-note">
                        Kitchen note
                        <input value={notes[item.id] || ""} maxLength={200} onChange={event => setNotes(current => ({ ...current, [item.id]: event.target.value }))} placeholder="Less spicy, no onion…" />
                      </label>
                    )}
                  </div>
                  {cart[item.id] ? (
                    <div className="qty" aria-label={`${item.name} quantity`}>
                      <button aria-label={`Remove one ${item.name}`} onClick={() => add(item.id, -1)}>−</button>
                      <b>{cart[item.id]}</b>
                      <button aria-label={`Add one ${item.name}`} onClick={() => add(item.id, 1)}>+</button>
                    </div>
                  ) : (
                    <button className="add" disabled={!menu.restaurant.orderingEnabled} onClick={() => add(item.id, 1)}>{menu.restaurant.orderingEnabled ? "Add" : "Unavailable"}</button>
                  )}
                </article>))}
            </section>}
        </main>
        <div className="service-bar"><span>Need something?</span><button className={`${waiterPending ? "pending" : ""} ${waiterAcknowledged ? "acknowledged" : ""}`} onClick={() => void request("WAITER")} disabled={busy || waiterPending}><ActionIcon kind="waiter"/>{waiterAcknowledged && <span className="waiter-acknowledged">Acknowledged</span>}<span>{waiterPending && !waiterAcknowledged ? "Request sent" : "Call Waiter"}</span></button></div>
        {count > 0 && orderSheetExpanded && (
          <div className="drawer-overlay" onClick={() => { setOrderSheetExpanded(false); setCheckout(false); setPaymentMode(null); }}><section className="order-drawer" aria-label="Your order" onClick={event => event.stopPropagation()}>
            <div className="order-sheet-head">
              <h2>Your order</h2>
              <button className="sheet-close" onClick={() => setOrderSheetExpanded(false)} aria-label="Collapse order sheet">−</button>
            </div>
            <div className="order-lines">
              {orderLines.map(line => (
                <div className="order-line" key={line.id}>
                  <span>{line.quantity} × {line.name}</span>
                  <b>{money(line.price * line.quantity)}</b>
                </div>
              ))}
            </div>
            {tax > 0 && <div className="charge-line"><span>Tax</span><b>{money(tax)}</b></div>}
            {serviceCharge > 0 && <div className="charge-line"><span>Service charge</span><b>{money(serviceCharge)}</b></div>}
            <div className="order-total">
              <span>Total</span>
              <b>{money(total)}</b>
            </div>
            <div className="payment-actions">
              <button className="payment-upi" disabled={!menu.restaurant.orderingEnabled||!menu.paymentMethods.length} onClick={() => { setPaymentMode("upi"); setCheckout(true); setPaymentMethodId(menu.paymentMethods[0]?.id || ""); }}><ActionIcon kind="upi"/>Pay via UPI (scan QR)</button>
              {menu.restaurant.cardPaymentsEnabled && <button className="payment-card" disabled={!menu.restaurant.orderingEnabled} onClick={() => { setPaymentMode("card"); setCheckout(true); setPaymentMethodId(""); }}><ActionIcon kind="card"/>Pay by card</button>}
              <button className="payment-counter" disabled={!menu.restaurant.orderingEnabled} onClick={() => { setPaymentMode("counter"); setCheckout(true); setPaymentMethodId(""); }}><ActionIcon kind="counter"/>Pay at counter</button>
            </div>
            {checkout && (
              <div className="payment-sheet">
                {paymentMode === "upi" && payment && (
                  <div className="pay-note dynamic-upi-intro">
                    <h3>Dynamic UPI payment</h3>
                    <p>A unique QR and app payment request will be created using the final server-calculated amount.</p>
                    <strong>{money(total)}</strong>
                  </div>
                )}
                {paymentMode === "card" && (
                  <div className="pay-note dark-note">
                    <h3>Pay by card</h3>
                    <p>Razorpay Secure Checkout opens after you place the order.</p>
                  </div>
                )}
                {paymentMode === "counter" && (
                  <div className="pay-note">
                    <h3>Pay at counter</h3>
                    <p>Show this screen when you finish dining.</p>
                  </div>
                )}
                {error && <div className="error" role="alert">{error}</div>}
                <button className="place-final" onClick={place} disabled={busy}>{busy ? "Processing…" : paymentMode === "counter" ? `Place order · ${money(total)}` : `Pay now · ${money(total)}`}</button>
              </div>
            )}
            <button className="browse-menu" onClick={() => { setOrderSheetExpanded(false); setCheckout(false); setPaymentMode(null); }}>Keep browsing menu</button>
          </section></div>
        )}
        {count > 0 && !orderSheetExpanded && (
          <button className="cart-bar" onClick={() => setOrderSheetExpanded(true)}>
            <span>Cart · {count} item{count === 1 ? "" : "s"}</span>
            <b><span>Order Now</span> · {money(total)} ›</b>
          </button>
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

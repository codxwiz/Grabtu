import type { Order } from "@whitelabel/shared-types";
import QRCode from "qrcode";
import type {
  Analytics,
  Billing,
  CardMerchantConfig,
  Category,
  DiningTable,
  Entitlements,
  MenuItem,
  Orders,
  PaymentMethodAdmin,
  RestaurantSettings,
  ServiceRequest,
  SessionUser,
  StaffMember,
  SupportTicket,
} from "./types";

type DemoState = {
  user: SessionUser;
  categories: Category[];
  tables: DiningTable[];
  payments: PaymentMethodAdmin[];
  cardMerchant: CardMerchantConfig;
  staff: StaffMember[];
  settings: RestaurantSettings;
  entitlements: Entitlements;
  billing: Billing;
  requests: ServiceRequest[];
  orders: Orders;
  history: Orders;
  analytics: Analytics;
  supportTickets: SupportTicket[];
};

const now = Date.now();
const iso = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
const future = (minutesFromNow: number) => new Date(now + minutesFromNow * 60_000).toISOString();

let idCounter = 1;
const uid = (prefix: string) => `${prefix}_${idCounter++}`;
const clone = <T,>(value: T): T => (typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value)));

function buildOrder(order: Omit<Order, "restaurantId" | "taxAmount" | "serviceChargeAmount">): Order {
  return {
    ...order,
    restaurantId: "rest_demo",
    taxAmount: Math.round(order.totalAmount * 0.05),
    serviceChargeAmount: Math.round(order.totalAmount * 0.02),
  };
}

const state: DemoState = {
  user: {
    name: "Demo Owner",
    phone: "+919876543210",
    role: "owner",
    capabilities: ["kds.manage","orders.prepare","payments.confirm","inventory.read","inventory.manage","reservations.read","reservations.manage","finance.read","finance.manage","growth.read","growth.manage","integrations.read","integrations.manage","payments.refund"],
    restaurant: { id: "rest_demo", name: "The Saffron Table", slug: "demo-bistro" },
  },
  settings: {
    name: "The Saffron Table",
    orderingEnabled: true,
    orderPauseMessage: "",
    taxPercent: 5,
    serviceChargePercent: 2,
    plan: "starter",
    planStatus: "trialing",
    trialEndsAt: future(14 * 24 * 60),
    featuresLocked: false,
    logoUrl: "",
    coverImageUrl: "",
    brandColor: "#17372b",
  },
  entitlements: {
    plan: "starter",
    planStatus: "trialing",
    trialEndsAt: future(14 * 24 * 60),
    featuresLocked: false,
    limits: { tables: 5, staff: 2, menuItems: 15, analyticsDays: 7 },
  },
  billing: {
    subscription: {
      id: "sub_demo",
      plan: "starter",
      status: "trialing",
      currentPeriodEnd: future(30 * 24 * 60),
      cancelAtPeriodEnd: false,
    },
    invoices: [
      { id: "inv_1008", number: "INV-1008", status: "paid", amount: 1499, currency: "INR", createdAt: iso(60 * 24 * 8) },
      { id: "inv_1009", number: "INV-1009", status: "open", amount: 2499, currency: "INR", createdAt: iso(60 * 12) },
    ],
    plans: [
      { plan: "starter", amount: 1499, currency: "INR", limits: { tables: 5, staff: 2, menuItems: 15, analyticsDays: 7 } },
      { plan: "growth", amount: 3499, currency: "INR", limits: { tables: 15, staff: 6, menuItems: 45, analyticsDays: 30 } },
      { plan: "business", amount: 7999, currency: "INR", limits: { tables: 30, staff: 20, menuItems: 150, analyticsDays: 90 } },
    ],
  },
  payments: [
    {
      id: "pm_1",
      provider: "google_pay",
      displayName: "Pay with Google Pay",
      upiId: "saffron.table@okaxis",
      qrImageData:
        "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNDAiIGhlaWdodD0iMjQwIiB2aWV3Qm94PSIwIDAgMjQwIDI0MCI+PHJlY3Qgd2lkdGg9IjI0MCIgaGVpZ2h0PSIyNDAiIGZpbGw9IiNmNGYyZWIiLz48cmVjdCB4PSIzMCIgeT0iMzAiIHdpZHRoPSI4MCIgaGVpZ2h0PSI4MCIgZmlsbD0iIzE3MzczYiIvPjxyZWN0IHg9IjEyMCIgeT0iMzAiIHdpZHRoPSI0NSIgaGVpZ2h0PSI0NSIgZmlsbD0iIzE3MzczYiIvPjxyZWN0IHg9IjE3MCIgeT0iMzAiIHdpZHRoPSIzMCIgaGVpZ2h0PSIzMCIgZmlsbD0iIzE3NzczYiIvPjxyZWN0IHg9IjM0IiB5PSIxNDAiIHdpZHRoPSIzNCIgaGVpZ2h0PSIzNCIgZmlsbD0iIzE3MzczYiIvPjxyZWN0IHg9Ijc0IiB5PSIxNDAiIHdpZHRoPSIxMCIgaGVpZ2h0PSI2MCIgZmlsbD0iIzE3NzczYiIvPjxyZWN0IHg9IjEwMCIgeT0iMTQwIiB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIGZpbGw9IiMxNzM3M2IiLz48cmVjdCB4PSIxNDQiIHk9IjE0MCIgd2lkdGg9IjUyIiBoZWlnaHQ9IjUyIiBmaWxsPSIjMTczNzNiIi8+PC9zdmc+",
      isActive: true,
    },
    {
      id: "pm_2",
      provider: "paytm",
      displayName: "Pay with Paytm",
      phone: "9876543210",
      qrImageData:
        "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNDAiIGhlaWdodD0iMjQwIiB2aWV3Qm94PSIwIDAgMjQwIDI0MCI+PHJlY3Qgd2lkdGg9IjI0MCIgaGVpZ2h0PSIyNDAiIGZpbGw9IiNmOGZiZjYiLz48cmVjdCB4PSI0MCIgeT0iNDAiIHdpZHRoPSI1MCIgaGVpZ2h0PSI1MCIgZmlsbD0iI2IwMzEyZiIvPjxyZWN0IHg9IjEyMCIgeT0iNDAiIHdpZHRoPSI4MCIgaGVpZ2h0PSIzMCIgZmlsbD0iI2IwMzEyZiIvPjxyZWN0IHg9IjQwIiB5PSIxMjAiIHdpZHRoPSIzMCIgaGVpZ2h0PSI0MCIgZmlsbD0iI2IwMzEyZiIvPjxyZWN0IHg9Ijk0IiB5PSIxMjAiIHdpZHRoPSI4MCIgaGVpZ2h0PSI4MCIgZmlsbD0iI2IwMzEyZiIvPjxyZWN0IHg9IjE4MCIgeT0iMTIwIiB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIGZpbGw9IiNiMDMxMmYiLz48L3N2Zz4=",
      isActive: false,
    },
  ],
  cardMerchant:{provider:"razorpay",maskedKeyId:"",connected:false,enabled:false,testMode:false,webhookUrl:"https://api.example.com/api/payments/razorpay/webhook/demo",verifiedAt:null},
  staff: [
    { id: "staff_1", name: "Demo Owner", phone: "+919876543210", role: "OWNER", isActive: true, createdAt: iso(60 * 24 * 30), lastLoginAt: iso(6) },
    { id: "staff_2", name: "Asha", phone: "+919876543211", role: "WAITER", isActive: true, createdAt: iso(60 * 24 * 9), lastLoginAt: iso(48) },
    { id: "staff_3", name: "Kabir", phone: "+919876543212", role: "KITCHEN", isActive: true, createdAt: iso(60 * 24 * 14), lastLoginAt: iso(90) },
  ],
  tables: [
    { id: "table_1", label: "Table 01", code: "T1", isActive: true, _count: { orders: 14 } },
    { id: "table_2", label: "Table 02", code: "T2", isActive: true, _count: { orders: 11 } },
    { id: "table_3", label: "Patio 01", code: "P1", isActive: true, _count: { orders: 8 } },
    { id: "table_4", label: "Bar 01", code: "B1", isActive: false, _count: { orders: 3 } },
  ],
  categories: [
    {
      id: "cat_1",
      name: "Popular",
      sortOrder: 1,
      items: [
        {
          id: "m1",
          categoryId: "cat_1",
          name: "Paneer Tikka Pizza",
          description: "Wood-fired crust, smoky paneer, onions and mint drizzle",
          price: 429,
          isAvailable: true,
          isVeg: true,
          tags: ["Bestseller", "Chef's pick"],
          imageUrl: "https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=900&q=80",
          prepMinutes: 18,
          options: [
            { id: "opt_1", name: "Extra cheese", priceDelta: 49, isAvailable: true },
            { id: "opt_2", name: "Gluten-free base", priceDelta: 79, isAvailable: true },
          ],
        },
      ],
    },
    {
      id: "cat_2",
      name: "Mains",
      sortOrder: 2,
      items: [
        {
          id: "m2",
          categoryId: "cat_2",
          name: "Smash Burger",
          description: "Double patty, cheddar, house sauce and crispy onions",
          price: 379,
          isAvailable: true,
          isVeg: false,
          tags: ["Fast seller"],
          imageUrl: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=900&q=80",
          prepMinutes: 14,
          options: [{ id: "opt_3", name: "Add fries", priceDelta: 69, isAvailable: true }],
        },
      ],
    },
    {
      id: "cat_3",
      name: "Sides",
      sortOrder: 3,
      items: [
        {
          id: "m3",
          categoryId: "cat_3",
          name: "Truffle Fries",
          description: "Crispy fries with parmesan and truffle oil",
          price: 199,
          isAvailable: true,
          isVeg: true,
          tags: [],
          prepMinutes: 10,
        },
      ],
    },
  ],
  orders: [
    buildOrder({
      id: "ORD-1024",
      tableId: "table_1",
      tableLabel: "Table 01",
      status: "new",
      paymentStatus: "reported",
      paymentReference: "UPI-4829",
      createdAt: iso(7),
      updatedAt: iso(1),
      estimatedReadyAt: future(13),
      items: [
        { id: "oi_1", menuItemId: "m1", name: "Paneer Tikka Pizza", quantity: 1, unitPrice: 429, notes: "No olives" },
        { id: "oi_2", menuItemId: "m3", name: "Truffle Fries", quantity: 1, unitPrice: 199, options: [{ id: "opt_4", name: "Extra parmesan", priceDelta: 29 }] },
      ],
      totalAmount: 676,
    }),
    buildOrder({
      id: "ORD-1023",
      tableId: "table_2",
      tableLabel: "Table 02",
      status: "preparing",
      paymentStatus: "paid",
      paymentReference: "RZP-2718",
      createdAt: iso(18),
      updatedAt: iso(2),
      estimatedReadyAt: future(6),
      items: [{ id: "oi_3", menuItemId: "m2", name: "Smash Burger", quantity: 2, unitPrice: 379 }],
      totalAmount: 758,
    }),
    buildOrder({
      id: "ORD-1022",
      tableId: "table_3",
      tableLabel: "Patio 01",
      status: "ready",
      paymentStatus: "pay_at_counter",
      createdAt: iso(34),
      updatedAt: iso(4),
      estimatedReadyAt: future(-2),
      items: [{ id: "oi_4", menuItemId: "m3", name: "Truffle Fries", quantity: 1, unitPrice: 199 }],
      totalAmount: 199,
    }),
  ],
  history: [
    buildOrder({
      id: "ORD-1021",
      tableId: "table_1",
      tableLabel: "Table 01",
      status: "served",
      paymentStatus: "paid",
      paymentReference: "RZP-1101",
      createdAt: iso(120),
      updatedAt: iso(95),
      items: [{ id: "oi_5", menuItemId: "m1", name: "Paneer Tikka Pizza", quantity: 1, unitPrice: 429 }],
      totalAmount: 452,
    }),
    buildOrder({
      id: "ORD-1020",
      tableId: "table_4",
      tableLabel: "Bar 01",
      status: "cancelled",
      paymentStatus: "refunded",
      createdAt: iso(170),
      updatedAt: iso(165),
      items: [{ id: "oi_6", menuItemId: "m2", name: "Smash Burger", quantity: 1, unitPrice: 379 }],
      totalAmount: 401,
    }),
  ],
  requests: [
    { id: "req_1", tableId: "table_1", tableLabel: "Table 01", tableCode: "T1", type: "call_waiter", note: "Need an extra water glass", status: "OPEN", createdAt: iso(5) },
    { id: "req_2", tableId: "table_3", tableLabel: "Patio 01", tableCode: "P1", type: "call_waiter", note: "Please bring mayo", status: "ACKNOWLEDGED", createdAt: iso(20) },
  ],
  analytics: {
    days: 7,
    from: "2026-07-07",
    to: "2026-07-13",
    totalOrders: 64,
    revenue: 21482,
    daily: [
      { date: "2026-07-07", orders: 7, revenue: 1984 },
      { date: "2026-07-08", orders: 8, revenue: 2560 },
      { date: "2026-07-09", orders: 10, revenue: 3105 },
      { date: "2026-07-10", orders: 9, revenue: 2975 },
      { date: "2026-07-11", orders: 11, revenue: 3884 },
      { date: "2026-07-12", orders: 12, revenue: 4102 },
      { date: "2026-07-13", orders: 7, revenue: 2872 },
    ],
    topItems: [
      { name: "Paneer Tikka Pizza", quantity: 21, revenue: 9009 },
      { name: "Smash Burger", quantity: 18, revenue: 6822 },
      { name: "Truffle Fries", quantity: 12, revenue: 2388 },
    ],
  },
  supportTickets: [],
};

const phase3Demo={
  stations:[{id:"station_hot",name:"Hot Kitchen",code:"HOT",color:"#34c38f",sortOrder:1,isActive:true,categories:[{category:{id:"cat_2",name:"Mains"}}]},{id:"station_pizza",name:"Pizza Oven",code:"PIZZA",color:"#e9a64a",sortOrder:2,isActive:true,categories:[{category:{id:"cat_1",name:"Popular"}}]}],
  tickets:[
    {id:"ticket_1",status:"QUEUED",priority:0,createdAt:iso(6),station:{id:"station_pizza",name:"Pizza Oven",color:"#e9a64a"},order:{displayId:"ORD-1024",tableLabel:"Table 01",createdAt:iso(7),status:"NEW"},items:[{id:"ti_1",quantity:1,notes:"No olives",orderItem:{name:"Paneer Tikka Pizza"}}]},
    {id:"ticket_2",status:"PREPARING",priority:1,createdAt:iso(17),station:{id:"station_hot",name:"Hot Kitchen",color:"#34c38f"},order:{displayId:"ORD-1023",tableLabel:"Table 02",createdAt:iso(18),status:"PREPARING"},items:[{id:"ti_2",quantity:2,orderItem:{name:"Smash Burger"}}]},
    {id:"ticket_3",status:"READY",priority:0,createdAt:iso(31),station:{id:"station_hot",name:"Hot Kitchen",color:"#34c38f"},order:{displayId:"ORD-1022",tableLabel:"Patio 01",createdAt:iso(34),status:"READY"},items:[{id:"ti_3",quantity:1,orderItem:{name:"Truffle Fries"}}]},
  ],
  inventory:[
    {id:"stock_1",name:"Paneer",sku:"PAN-01",unit:"kg",onHand:2.4,reorderLevel:3,costPerUnitPaise:38000,lowStock:true,recipeIngredients:[{menuItemId:"m1",quantity:.18,wastePercent:5}]},
    {id:"stock_2",name:"Potatoes",sku:"POT-01",unit:"kg",onHand:18,reorderLevel:6,costPerUnitPaise:4200,lowStock:false,recipeIngredients:[{menuItemId:"m3",quantity:.25,wastePercent:8}]},
    {id:"stock_3",name:"Pizza flour",sku:"FLR-01",unit:"kg",onHand:9.5,reorderLevel:5,costPerUnitPaise:6800,lowStock:false,recipeIngredients:[{menuItemId:"m1",quantity:.22,wastePercent:3}]},
  ],
  vendors:[{id:"vendor_1",name:"Fresh Fields Supply",gstin:"27ABCDE1234F1Z5",phone:"+919900001111",isActive:true}],
  purchaseOrders:[{id:"po_1",number:"PO-20260726-001",status:"SUBMITTED",vendor:{id:"vendor_1",name:"Fresh Fields Supply",isActive:true},lines:[{id:"pol_1",inventoryItemId:"stock_1",orderedQuantity:"10",receivedQuantity:"0",unitCostPaise:36000,inventoryItem:{id:"stock_1",name:"Paneer",sku:"PAN-01",unit:"kg",onHand:2.4,reorderLevel:3,costPerUnitPaise:38000,lowStock:true}}],createdAt:iso(120)}],
  reservations:[{id:"reservation_1",partySize:4,startsAt:future(90),durationMinutes:90,status:"CONFIRMED",guest:{name:"Priya Mehta",phone:"+919811112222"}}],
  waitlist:[{id:"wait_1",partySize:2,quotedWaitMinutes:20,status:"WAITING",createdAt:iso(8),guest:{name:"Arjun Rao",phone:"+919822223333"}}],
  fiscalProfile:{legalName:"The Saffron Table Hospitality Pvt Ltd",gstin:"27ABCDE1234F1Z5",stateCode:"27",address:"12 Market Road, Mumbai, Maharashtra",invoicePrefix:"TST",cgstPercent:2.5,sgstPercent:2.5,igstPercent:0},
  invoices:[{id:"tax_1",invoiceNumber:"TST-2026-000128",status:"ISSUED",totalAmount:758,issuedAt:iso(18),order:{displayId:"ORD-1023",tableLabel:"Table 02"}}],
  creditNotes:[{id:"credit_1",creditNoteNumber:"CN-TST-2026-000127",reason:"Card payment refund",totalAmount:401,providerRefundId:"rfnd_demo",issuedAt:iso(165),taxInvoice:{invoiceNumber:"TST-2026-000127"},order:{displayId:"ORD-1020",tableLabel:"Bar 01"}}],
  settlements:[{id:"settlement_1",provider:"razorpay",providerSettlementId:"setl_demo_128",status:"MATCHED",grossAmount:75800,feeAmount:1516,taxAmount:273,netAmount:74011,createdAt:iso(60)}],
  integrations:[{id:"integration_1",provider:"tally",displayName:"Tally Prime",isActive:true}],
  exports:[{id:"export_1",format:"json",status:"GENERATED",recordCount:38,checksum:"51f42c30be22ee9552c8",createdAt:iso(45)}],
};
const phase4Demo={
  program:{name:"Copper & Clove Rewards",pointsPerRupee:1,redemptionValuePaise:100,minimumRedeemPoints:100,isActive:true},
  accounts:[{id:"loyalty_1",pointsBalance:842,lifetimeEarned:1260,tier:"GOLD",guest:{name:"Priya Mehta",phone:"+919811112222"}},{id:"loyalty_2",pointsBalance:320,lifetimeEarned:480,tier:"MEMBER",guest:{name:"Arjun Rao",phone:"+919822223333"}}],
  promotions:[{id:"promo_1",code:"WELCOME10",name:"Welcome reward",discountType:"PERCENT",discountValue:10,startsAt:new Date().toISOString(),endsAt:future(43200),usageCount:18,usageLimit:100,isActive:true}],
  keys:[{id:"key_1",name:"ERP production",keyPrefix:"kn_live_7Zx4Q",scopes:["menu.read","orders.read"],createdAt:iso(1440)}],
  webhooks:[{id:"hook_1",name:"Operations data lake",url:"https://example.com/white_label/events",subscribedEvents:["restaurant.sync"],isActive:true,consecutiveFailures:0,lastDeliveredAt:iso(2)}],
  deliveries:[{id:"delivery_1",eventType:"restaurant.sync",status:"DELIVERED",attemptCount:1,responseStatus:200,createdAt:iso(2),endpoint:{name:"Operations data lake"}}],
};

function parseBody(body: BodyInit | null | undefined) {
  if (typeof body !== "string") return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

function respond<T>(value: T): T {
  return clone(value);
}

function success(message: string) {
  return { message };
}

function activeOrders() {
  return state.orders.filter(order => order.status !== "served" && order.status !== "cancelled");
}

function findCategory(categoryId: string) {
  return state.categories.find(category => category.id === categoryId);
}

function findItem(itemId: string) {
  for (const category of state.categories) {
    const item = category.items.find(entry => entry.id === itemId);
    if (item) return item;
  }
  return undefined;
}

function updateHistory(order: Order) {
  state.history = [order, ...state.history.filter(entry => entry.id !== order.id)];
}

function updateAnalytics() {
  const uniqueOrders = new Map<string, Order>();
  for (const order of [...state.orders, ...state.history]) uniqueOrders.set(order.id, order);
  const allOrders = [...uniqueOrders.values()];
  state.analytics = {
    ...state.analytics,
    totalOrders: allOrders.length,
    revenue: allOrders.reduce((sum, order) => sum + order.totalAmount, 0),
  };
}

export async function demoRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = String(init.method || "GET").toUpperCase();
  const body = parseBody(init.body);

  if (path === "/api/auth/me") return respond(state.user) as T;
  if (path === "/api/auth/logout") return undefined as T;
  if (path === "/api/orders/active") return respond(activeOrders()) as T;
  if(path==="/api/admin/kds/stations"&&method==="GET")return respond(phase3Demo.stations) as T;
  if(path.startsWith("/api/admin/kds/tickets")&&method==="GET"){const stationId=new URL(path,"http://demo").searchParams.get("stationId");return respond(stationId?phase3Demo.tickets.filter(ticket=>ticket.station.id===stationId):phase3Demo.tickets) as T}
  if(path.startsWith("/api/admin/kds/tickets/")&&path.endsWith("/status")&&method==="PATCH"){const ticket=phase3Demo.tickets.find(row=>row.id===path.split("/")[5]);if(ticket&&body?.status)ticket.status=String(body.status);return respond(ticket||success("Ticket not found")) as T}
  if(path==="/api/admin/kds/stations"&&method==="POST"){const station={id:uid("station"),name:String(body?.name||"Station"),code:String(body?.code||"NEW"),color:String(body?.color||"#2e7d5b"),sortOrder:Number(body?.sortOrder||0),isActive:true,categories:state.categories.filter(category=>(body?.categoryIds||[]).includes(category.id)).map(category=>({category:{id:category.id,name:category.name}}))};phase3Demo.stations.push(station);return respond(station) as T}
  if(path==="/api/admin/inventory"&&method==="GET")return respond(phase3Demo.inventory) as T;
  if(path==="/api/admin/inventory"&&method==="POST"){const item={id:uid("stock"),name:String(body?.name),sku:String(body?.sku),unit:String(body?.unit),onHand:Number(body?.onHand||0),reorderLevel:Number(body?.reorderLevel||0),costPerUnitPaise:Number(body?.costPerUnitPaise||0),lowStock:false,recipeIngredients:[]};phase3Demo.inventory.push(item);return respond(item) as T}
  if(/^\/api\/admin\/inventory\/[^/]+\/movements$/.test(path)&&method==="POST"){const item=phase3Demo.inventory.find(entry=>entry.id===path.split("/")[4]);if(item){const quantity=Number(body?.quantity||0),negative=["WASTE","TRANSFER"].includes(String(body?.type));item.onHand=Number((item.onHand+(negative?-quantity:quantity)).toFixed(3));item.lowStock=item.onHand<=item.reorderLevel}return respond({id:uid("movement"),...body}) as T}
  if(path.startsWith("/api/admin/menu/items/")&&path.endsWith("/recipe")&&method==="PUT"){const menuItemId=path.split("/")[5];for(const item of phase3Demo.inventory)item.recipeIngredients=item.recipeIngredients.filter(link=>link.menuItemId!==menuItemId);for(const row of body?.ingredients||[]){const item=phase3Demo.inventory.find(entry=>entry.id===row.inventoryItemId);if(item)item.recipeIngredients.push({menuItemId,quantity:Number(row.quantity),wastePercent:Number(row.wastePercent||0)})}return respond({menuItemId,ingredients:body?.ingredients||[]}) as T}
  if(path==="/api/admin/procurement/vendors"&&method==="GET")return respond(phase3Demo.vendors) as T;
  if(path==="/api/admin/procurement/vendors"&&method==="POST"){const vendor={id:uid("vendor"),name:String(body?.name),gstin:"",phone:"",isActive:true};phase3Demo.vendors.push(vendor);return respond(vendor) as T}
  if(path==="/api/admin/procurement/purchase-orders"&&method==="GET")return respond(phase3Demo.purchaseOrders) as T;
  if(path==="/api/admin/procurement/purchase-orders"&&method==="POST"){const vendor=phase3Demo.vendors.find(entry=>entry.id===body?.vendorId);const order={id:uid("po"),number:`PO-DEMO-${String(phase3Demo.purchaseOrders.length+1).padStart(3,"0")}`,status:"DRAFT",vendor:vendor||phase3Demo.vendors[0],lines:(body?.lines||[]).map((line:any)=>({id:uid("pol"),inventoryItemId:String(line.inventoryItemId),orderedQuantity:String(line.orderedQuantity),receivedQuantity:"0",unitCostPaise:Number(line.unitCostPaise),inventoryItem:phase3Demo.inventory.find(entry=>entry.id===line.inventoryItemId)})),createdAt:new Date().toISOString()};phase3Demo.purchaseOrders.unshift(order as any);return respond(order) as T}
  if(/^\/api\/admin\/procurement\/purchase-orders\/[^/]+\/submit$/.test(path)&&method==="POST"){const order=phase3Demo.purchaseOrders.find(entry=>entry.id===path.split("/")[5]);if(order)order.status="SUBMITTED";return respond(order||success("Purchase order not found")) as T}
  if(/^\/api\/admin\/procurement\/purchase-orders\/[^/]+\/receive$/.test(path)&&method==="POST"){const order=phase3Demo.purchaseOrders.find(entry=>entry.id===path.split("/")[5]);if(order){for(const receipt of body?.lines||[]){const line=order.lines.find(entry=>entry.id===receipt.lineId);if(line){line.receivedQuantity=String(Number(line.receivedQuantity)+Number(receipt.quantity));const stock=phase3Demo.inventory.find(entry=>entry.id===line.inventoryItemId);if(stock){stock.onHand+=Number(receipt.quantity);stock.lowStock=stock.onHand<=stock.reorderLevel}}}order.status=order.lines.every(line=>Number(line.receivedQuantity)>=Number(line.orderedQuantity))?"RECEIVED":"PARTIALLY_RECEIVED"}return respond(order||success("Purchase order not found")) as T}
  if(path==="/api/admin/reservations"&&method==="GET")return respond(phase3Demo.reservations) as T;
  if(path==="/api/admin/waitlist"&&method==="GET")return respond(phase3Demo.waitlist) as T;
  if(path==="/api/admin/fiscal/invoices"&&method==="GET")return respond(phase3Demo.invoices) as T;
  if(path==="/api/admin/fiscal/credit-notes"&&method==="GET")return respond(phase3Demo.creditNotes) as T;
  if(path==="/api/admin/fiscal/profile"&&method==="GET")return respond(phase3Demo.fiscalProfile) as T;
  if(path==="/api/admin/settlements"&&method==="GET")return respond(phase3Demo.settlements) as T;
  if(path==="/api/admin/accounting/integrations"&&method==="GET")return respond(phase3Demo.integrations) as T;
  if(path==="/api/admin/accounting/exports"&&method==="GET")return respond(phase3Demo.exports) as T;
  if(path==="/api/admin/growth/loyalty"&&method==="GET")return respond({program:phase4Demo.program,accounts:phase4Demo.accounts}) as T;
  if(path==="/api/admin/growth/loyalty"&&method==="PUT"){phase4Demo.program={...phase4Demo.program,...body};return respond(phase4Demo.program) as T}
  if(path==="/api/admin/growth/loyalty/members"&&method==="POST"){const row={id:uid("loyalty"),pointsBalance:0,lifetimeEarned:0,tier:"MEMBER",guest:{name:String(body?.name),phone:String(body?.phone)}};phase4Demo.accounts.push(row);return respond(row) as T}
  if(path==="/api/admin/growth/promotions"&&method==="GET")return respond(phase4Demo.promotions) as T;
  if(path==="/api/admin/growth/promotions"&&method==="POST"){const row={id:uid("promo"),usageCount:0,...body};phase4Demo.promotions.unshift(row as any);return respond(row) as T}
  if(/^\/api\/admin\/growth\/promotions\/[^/]+$/.test(path)&&method==="PATCH"){const row=phase4Demo.promotions.find(entry=>entry.id===path.split("/")[5]);if(row)Object.assign(row,body);return respond(row||success("Promotion not found")) as T}
  if(path==="/api/admin/integrations/api-keys"&&method==="GET")return respond(phase4Demo.keys) as T;
  if(path==="/api/admin/integrations/api-keys"&&method==="POST"){const row={id:uid("key"),keyPrefix:"kn_live_demo",createdAt:new Date().toISOString(),secret:`kn_live_${uid("secret")}`,...body};phase4Demo.keys.unshift(row as any);return respond(row) as T}
  if(/^\/api\/admin\/integrations\/api-keys\/[^/]+$/.test(path)&&method==="DELETE"){const row=phase4Demo.keys.find(entry=>entry.id===path.split("/")[5]);if(row)(row as any).revokedAt=new Date().toISOString();return undefined as T}
  if(path==="/api/admin/integrations/webhooks"&&method==="GET")return respond(phase4Demo.webhooks) as T;
  if(path==="/api/admin/integrations/webhooks"&&method==="POST"){const row={id:uid("hook"),isActive:true,consecutiveFailures:0,secret:`whsec_${uid("secret")}`,...body};phase4Demo.webhooks.unshift(row as any);return respond(row) as T}
  if(/^\/api\/admin\/integrations\/webhooks\/[^/]+$/.test(path)&&method==="PATCH"){const row=phase4Demo.webhooks.find(entry=>entry.id===path.split("/")[5]);if(row)Object.assign(row,body);return respond(row||success("Webhook not found")) as T}
  if(path==="/api/admin/integrations/webhook-deliveries"&&method==="GET")return respond(phase4Demo.deliveries) as T;

  if (path.startsWith("/api/orders/") && path.endsWith("/status") && method === "PATCH") {
    const order = state.orders.find(entry => entry.id === path.split("/")[3]) || state.history.find(entry => entry.id === path.split("/")[3]);
    if (order && body?.status) {
      order.status = body.status;
      order.updatedAt = new Date().toISOString();
      if (order.status === "served" || order.status === "cancelled") updateHistory(order);
      updateAnalytics();
      return respond(order) as T;
    }
    return respond(success("Saved")) as T;
  }

  if (path.startsWith("/api/orders/") && path.endsWith("/payment-status") && method === "PATCH") {
    const order = state.orders.find(entry => entry.id === path.split("/")[3]) || state.history.find(entry => entry.id === path.split("/")[3]);
    if (order && body?.status) {
      order.paymentStatus = body.status;
      order.updatedAt = new Date().toISOString();
      updateAnalytics();
      return respond(order) as T;
    }
    return respond(success("Saved")) as T;
  }
  if(path.startsWith("/api/admin/orders/")&&path.endsWith("/manual-refund")&&method==="POST"){const order=state.history.find(entry=>entry.id===path.split("/")[4]);if(order)order.paymentStatus="refunded";return respond({order,creditNote:phase3Demo.creditNotes[0]}) as T}
  if(/^\/api\/admin\/orders\/[^/]+\/refund$/.test(path)&&method==="POST"){const order=state.history.find(entry=>entry.id===path.split("/")[4]);if(order)order.paymentStatus="refunded";return respond(order||success("Refund recorded")) as T}

  if (path === "/api/admin/menu") return respond(state.categories) as T;
  if (path.startsWith("/api/admin/menu/items/") && path.endsWith("/options") && method === "GET") {
    const item = findItem(path.split("/")[4]);
    return respond(Array.isArray(item?.options) ? item.options : []) as T;
  }
  if (path === "/api/admin/menu/categories" && method === "POST") {
    const category = { id: uid("cat"), name: String(body?.name || "New category"), sortOrder: Number(body?.sortOrder || state.categories.length + 1), items: [] as MenuItem[] };
    state.categories.push(category);
    return respond(category) as T;
  }
  if (path === "/api/admin/menu/items" && method === "POST") {
    const category = findCategory(String(body?.categoryId));
    if (!category) return respond(success("Category not found")) as T;
    const item: MenuItem = {
      id: uid("item"),
      categoryId: category.id,
      name: String(body?.name || "New item"),
      description: String(body?.description || ""),
      price: Number(body?.price || 0),
      isAvailable: body?.isAvailable ?? true,
      isVeg: body?.isVeg ?? true,
      tags: Array.isArray(body?.tags) ? body.tags : [],
      imageUrl: body?.imageUrl || "",
      prepMinutes: Number(body?.prepMinutes || 15),
      options: [],
    };
    category.items.unshift(item);
    return respond(item) as T;
  }
  if (path.startsWith("/api/admin/menu/items/") && path.endsWith("/options") && method === "POST") {
    const item = findItem(path.split("/")[4]);
    if (!item) return respond(success("Menu item not found")) as T;
    const option = { id: uid("opt"), name: String(body?.name || "Option"), priceDelta: Number(body?.priceDelta || 0), isAvailable: body?.isAvailable ?? true };
    item.options = [...(item.options || []), option];
    return respond(option) as T;
  }
  if (path.startsWith("/api/admin/menu/items/") && method === "DELETE") {
    const itemId = path.split("/")[4];
    for (const category of state.categories) category.items = category.items.filter(item => item.id !== itemId);
    return undefined as T;
  }
  if (path.startsWith("/api/admin/menu/items/") && method === "PATCH") {
    const item = findItem(path.split("/")[4]);
    if (!item) return respond(success("Menu item not found")) as T;
    Object.assign(item, {
      categoryId: String(body?.categoryId || item.categoryId),
      name: String(body?.name || item.name),
      description: String(body?.description || item.description),
      price: Number(body?.price ?? item.price),
      isAvailable: body?.isAvailable ?? item.isAvailable,
      isVeg: body?.isVeg ?? item.isVeg,
      tags: Array.isArray(body?.tags) ? body.tags : item.tags,
      imageUrl: body?.imageUrl ?? item.imageUrl,
      prepMinutes: Number(body?.prepMinutes || item.prepMinutes || 15),
    });
    return respond(item) as T;
  }

  if (path === "/api/admin/tables" && method === "GET") return respond(state.tables) as T;
  if (path === "/api/admin/tables" && method === "POST") {
    const table: DiningTable = { id: uid("table"), label: String(body?.label || "Table"), code: String(body?.code || "T"), isActive: body?.isActive ?? true, serviceStatus: "AVAILABLE", activeOrderCount: 0, latestOrder: null, _count: { orders: 0 } };
    state.tables.unshift(table);
    return respond(table) as T;
  }
  if (path.startsWith("/api/admin/tables/") && path.endsWith("/qr")) {
    const table = state.tables.find(entry => entry.id === path.split("/")[4]);
    if (!table) return respond({ url: "", svg: "<svg />", pngDataUrl: "" }) as T;
    const customerOrigin = import.meta.env.VITE_CUSTOMER_ORIGIN || `${window.location.protocol}//${window.location.hostname}:5173`;
    const url = `${customerOrigin}/r/demo-bistro/table/${encodeURIComponent(table.code)}`;
    const svg = await QRCode.toString(url, { type: "svg", margin: 2, width: 512, color: { dark: "#17372b", light: "#ffffff" } });
    const pngDataUrl = await QRCode.toDataURL(url, { type: "image/png", margin: 2, width: 1024, color: { dark: "#17372b", light: "#ffffff" } });
    return respond({ url, svg, pngDataUrl }) as T;
  }
  if (path.startsWith("/api/admin/tables/") && method === "PATCH") {
    const table = state.tables.find(entry => entry.id === path.split("/")[4]);
    if (!table) return respond(success("Table not found")) as T;
    Object.assign(table, { isActive: body?.isActive ?? table.isActive, label: body?.label ?? table.label, code: body?.code ?? table.code });
    return respond(table) as T;
  }
  if (path.startsWith("/api/admin/tables/") && method === "DELETE") {
    const index = state.tables.findIndex(entry => entry.id === path.split("/")[4]);
    if (index >= 0) state.tables.splice(index, 1);
    return undefined as T;
  }
  if (/^\/api\/admin\/tables\/[^/]+\/clear$/.test(path) && method === "POST") {
    const table = state.tables.find(entry => entry.id === path.split("/")[4]);
    if (!table) return respond(success("Table not found")) as T;
    table.serviceStatus = "AVAILABLE";
    table.activeOrderCount = 0;
    table.latestOrder = null;
    return respond(table) as T;
  }

  if (path === "/api/admin/payment-methods" && method === "GET") return respond(state.payments) as T;
  if (path === "/api/admin/card-merchant" && method === "GET") return respond(state.cardMerchant) as T;
  if (path === "/api/admin/card-merchant" && method === "PUT") {const testMode=String(body?.keyId||"").startsWith("rzp_test_");state.cardMerchant={provider:"razorpay",maskedKeyId:`${String(body?.keyId||"").slice(0,8)}••••••••`,connected:true,enabled:!testMode,testMode,webhookUrl:"https://api.example.com/api/payments/razorpay/webhook/demo",webhookSecret:"demo-secret-shown-once",verifiedAt:new Date().toISOString()};return respond(state.cardMerchant) as T;}
  if (path === "/api/admin/card-merchant" && method === "DELETE") {state.cardMerchant={provider:"razorpay",maskedKeyId:"",connected:false,enabled:false,testMode:false,webhookUrl:"https://api.example.com/api/payments/razorpay/webhook/demo",verifiedAt:null};return undefined as T;}
  if (path === "/api/admin/payment-methods" && method === "POST") {
    const payment: PaymentMethodAdmin = {
      id: uid("pay"),
      provider: String(body?.provider || "other"),
      displayName: String(body?.displayName || "UPI payment"),
      upiId: body?.upiId || undefined,
      phone: body?.phone || undefined,
      qrImageData: String(body?.qrImageData || ""),
      isActive: true,
    };
    state.payments.unshift(payment);
    return respond(payment) as T;
  }
  if (path.startsWith("/api/admin/payment-methods/") && method === "PATCH") {
    const payment = state.payments.find(entry => entry.id === path.split("/")[4]);
    if (!payment) return respond(success("Payment method not found")) as T;
    Object.assign(payment, { isActive: body?.isActive ?? payment.isActive, displayName: body?.displayName ?? payment.displayName, upiId: body?.upiId ?? payment.upiId, phone: body?.phone ?? payment.phone });
    return respond(payment) as T;
  }
  if (path.startsWith("/api/admin/payment-methods/") && method === "DELETE") {
    const index = state.payments.findIndex(entry => entry.id === path.split("/")[4]);
    if (index >= 0) state.payments.splice(index, 1);
    return undefined as T;
  }

  if (path === "/api/admin/staff" && method === "GET") return respond(state.staff) as T;
  if (path === "/api/admin/staff" && method === "POST") {
    const member: StaffMember = {
      id: uid("staff"),
      name: String(body?.name || "New staff"),
      phone: String(body?.phone || "+910000000000"),
      role: String(body?.role || "WAITER"),
      isActive: true,
      createdAt: new Date().toISOString(),
      lastLoginAt: undefined,
    };
    state.staff.unshift(member);
    return respond(member) as T;
  }
  if (path.startsWith("/api/admin/staff/") && method === "PATCH") {
    const member = state.staff.find(entry => entry.id === path.split("/")[4]);
    if (!member) return respond(success("Staff member not found")) as T;
    Object.assign(member, { isActive: body?.isActive ?? member.isActive, name: body?.name ?? member.name, role: body?.role ?? member.role });
    return respond(member) as T;
  }

  if (path === "/api/admin/service-requests") return respond(state.requests.filter(request => request.status === "OPEN" || request.status === "ACKNOWLEDGED")) as T;
  if (path.startsWith("/api/admin/service-requests/") && method === "PATCH") {
    const request = state.requests.find(entry => entry.id === path.split("/")[4]);
    if (!request) return respond(success("Request not found")) as T;
    if (body?.status !== "ACKNOWLEDGED" && body?.status !== "RESOLVED") return respond(success("Invalid service request status")) as T;
    if (body.status === "ACKNOWLEDGED" && request.status !== "OPEN") return respond(success("Only open requests can be acknowledged")) as T;
    request.status = body.status;
    return respond(request) as T;
  }

  if (path === "/api/admin/settings") {
    if (method === "PATCH") {
      Object.assign(state.settings, body || {});
      state.user.restaurant.name = state.settings.name;
      return respond(state.settings) as T;
    }
    return respond(state.settings) as T;
  }
  if (path === "/api/admin/entitlements") return respond(state.entitlements) as T;

  if (path === "/api/admin/billing") return respond(state.billing) as T;
  if (path === "/api/admin/billing/checkout" && method === "POST") {
    const plan = String(body?.plan || "starter");
    const limits = plan === "growth" ? { tables: 15, staff: 6, menuItems: 45, analyticsDays: 30 } : plan === "business" ? { tables: 30, staff: 20, menuItems: 150, analyticsDays: 90 } : { tables: 5, staff: 2, menuItems: 15, analyticsDays: 7 };
    state.settings.plan = plan;
    state.settings.planStatus = "trialing";
    state.settings.featuresLocked = false;
    state.entitlements = { ...state.entitlements, plan, planStatus: "trialing", featuresLocked: false, limits };
    state.billing.subscription = {
      id: `sub_${plan}`,
      plan,
      status: plan === "starter" ? "trialing" : "active",
      currentPeriodEnd: future(30 * 24 * 60),
      cancelAtPeriodEnd: false,
    };
    return respond({ checkoutUrl: null }) as T;
  }
  if (path === "/api/admin/billing/cancel" && method === "POST") {
    if (state.billing.subscription) state.billing.subscription.cancelAtPeriodEnd = true;
    return respond(success("Cancellation scheduled")) as T;
  }

  if (path.startsWith("/api/admin/orders/history")) return respond({ orders: state.history }) as T;
  if (path.startsWith("/api/admin/analytics/summary")) return respond(state.analytics) as T;
  if (path === "/api/admin/support-tickets" && method === "GET") return respond(state.supportTickets) as T;
  if (path === "/api/admin/support-tickets" && method === "POST") { const ticket: SupportTicket={id:uid("ticket"),subject:String(body?.subject||"Support request"),category:String(body?.category||"OTHER"),priority:String(body?.priority||"NORMAL"),message:String(body?.message||""),status:"OPEN",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};state.supportTickets.unshift(ticket);return respond(ticket) as T; }
  if (path.startsWith("/api/admin/orders/") && path.endsWith("/counter") && method === "PATCH") { const id=path.split("/")[4],order=state.history.find(entry=>entry.id===id);if(order){order.tableLabel=String(body?.tableLabel||order.tableLabel);order.totalAmount=Number(body?.totalAmount||order.totalAmount);order.updatedAt=new Date().toISOString();return respond(order) as T;} }

  if (path === "/api/admin/assets" && method === "POST") return respond({ url: String(body?.data || "") }) as T;
  return respond(success("Saved")) as T;
}

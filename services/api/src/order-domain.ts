import type { Order } from "@whitelabel/shared-types";

type PublicOrderRow = {
  displayId: string;
  trackingToken?: string | null;
  restaurantId: string;
  tableId: string;
  tableLabel: string;
  status: string;
  totalAmount: number;
  subtotalAmount?: number | null;
  taxAmount?: number | null;
  serviceChargeAmount?: number | null;
  paymentStatus: string;
  paymentMode?: string | null;
  providerOrderId?: string | null;
  paymentReference?: string | null;
  paymentMethod?: { id: string; provider: string; displayName: string } | null;
  estimatedReadyAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  items: Array<{
    id: string;
    menuItemId: string;
    name: string;
    quantity: number;
    unitPrice: number;
    notes?: string | null;
    options?: unknown;
  }>;
};

const ORDER_STATUSES = new Set(["new", "accepted", "preparing", "ready", "served", "cancelled"]);
const PAYMENT_STATUSES = new Set(["pay_at_counter", "pending", "reported", "paid", "refunded"]);
const PAYMENT_MODES = new Set(["upi", "card", "counter"]);

function normalizedEnum(value: string, allowed: ReadonlySet<string>, fallback: string) {
  const normalized = value.toLowerCase();
  return allowed.has(normalized) ? normalized : fallback;
}

export function toPublicOrder(row: PublicOrderRow): Order {
  const paymentMode = normalizedEnum(
    row.paymentMode || (row.providerOrderId ? "card" : row.paymentMethod ? "upi" : "counter"),
    PAYMENT_MODES,
    "counter",
  ) as Order["paymentMode"];
  return {
    id: row.displayId,
    trackingToken: row.trackingToken || undefined,
    restaurantId: row.restaurantId,
    tableId: row.tableId,
    tableLabel: row.tableLabel,
    status: normalizedEnum(row.status, ORDER_STATUSES, "new") as Order["status"],
    totalAmount: row.totalAmount,
    subtotalAmount: row.subtotalAmount ?? undefined,
    taxAmount: row.taxAmount ?? undefined,
    serviceChargeAmount: row.serviceChargeAmount ?? undefined,
    paymentStatus: normalizedEnum(row.paymentStatus, PAYMENT_STATUSES, "pending") as Order["paymentStatus"],
    paymentMode,
    paymentReference: row.paymentReference || undefined,
    paymentMethod: row.paymentMethod
      ? { id: row.paymentMethod.id, provider: row.paymentMethod.provider, displayName: row.paymentMethod.displayName }
      : undefined,
    estimatedReadyAt: row.estimatedReadyAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    items: row.items.map(item => ({
      id: item.id,
      menuItemId: item.menuItemId,
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      notes: item.notes || undefined,
      options: Array.isArray(item.options) ? item.options : undefined,
    })),
  };
}

export type KitchenTicketState = "QUEUED" | "ACKNOWLEDGED" | "PREPARING" | "READY" | "COMPLETED" | "CANCELLED";
export type KitchenDrivenOrderState = "ACCEPTED" | "PREPARING" | "READY" | "SERVED";

export function orderStateForKitchenTickets(ticketStatuses: readonly KitchenTicketState[]): KitchenDrivenOrderState | null {
  const active = ticketStatuses.filter(status => status !== "CANCELLED");
  if (!active.length) return null;
  if (active.every(status => status === "COMPLETED")) return "SERVED";
  if (active.every(status => status === "READY" || status === "COMPLETED")) return "READY";
  if (active.some(status => status === "PREPARING" || status === "READY" || status === "COMPLETED")) return "PREPARING";
  if (active.some(status => status === "ACKNOWLEDGED")) return "ACCEPTED";
  return null;
}

const TICKET_TRANSITIONS: Record<KitchenTicketState, ReadonlySet<KitchenTicketState>> = {
  QUEUED: new Set(["ACKNOWLEDGED", "CANCELLED"]),
  ACKNOWLEDGED: new Set(["PREPARING", "CANCELLED"]),
  PREPARING: new Set(["READY", "CANCELLED"]),
  READY: new Set(["COMPLETED"]),
  COMPLETED: new Set(),
  CANCELLED: new Set(),
};

export function canTransitionKitchenTicket(from: KitchenTicketState, to: KitchenTicketState) {
  return from === to || TICKET_TRANSITIONS[from].has(to);
}

export function validatePaymentSelection(input: { paymentMode?: "upi" | "card" | "counter"; paymentMethodId?: string }) {
  const mode = input.paymentMode || (input.paymentMethodId ? "upi" : "counter");
  if (mode === "upi" && !input.paymentMethodId) return { ok: false as const, message: "Choose an active UPI payment method" };
  if (mode !== "upi" && input.paymentMethodId) return { ok: false as const, message: `${mode === "card" ? "Card" : "Pay at counter"} orders cannot include a UPI payment method` };
  return { ok: true as const, mode };
}

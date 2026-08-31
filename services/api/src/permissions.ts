export const CAPABILITIES = [
  "orders.read",
  "orders.create",
  "orders.accept",
  "orders.prepare",
  "orders.ready",
  "orders.serve",
  "orders.reject",
  "orders.edit",
  "payments.read",
  "payments.confirm",
  "payments.refund",
  "payments.configure",
  "menu.read",
  "menu.manage",
  "tables.read",
  "tables.manage",
  "service_requests.read",
  "service_requests.manage",
  "history.read",
  "analytics.read",
  "settings.read",
  "settings.manage",
  "staff.read",
  "staff.manage",
  "billing.read",
  "billing.manage",
  "audit.read",
  "integrations.read",
  "integrations.manage",
  "organization.read",
  "organization.manage",
  "kds.manage",
  "inventory.read",
  "inventory.manage",
  "reservations.read",
  "reservations.manage",
  "finance.read",
  "finance.manage",
  "growth.read",
  "growth.manage",
] as const;

export type Capability = (typeof CAPABILITIES)[number];
export type RestaurantRole = "OWNER" | "MANAGER" | "SUPERVISOR" | "CASHIER" | "WAITER" | "KITCHEN" | "ORG_ADMIN" | "ORG_ANALYST";

const ALL_CAPABILITIES = new Set<Capability>(CAPABILITIES);

const ROLE_CAPABILITIES: Record<RestaurantRole, ReadonlySet<Capability>> = {
  OWNER: ALL_CAPABILITIES,
  MANAGER: new Set([
    "orders.read", "orders.create", "orders.accept", "orders.prepare", "orders.ready", "orders.serve", "orders.reject", "orders.edit",
    "payments.read", "payments.confirm", "payments.refund", "payments.configure",
    "menu.read", "menu.manage", "tables.read", "tables.manage",
    "service_requests.read", "service_requests.manage", "history.read", "analytics.read",
    "settings.read", "settings.manage", "staff.read", "audit.read", "integrations.read", "integrations.manage",
    "kds.manage", "inventory.read", "inventory.manage", "reservations.read", "reservations.manage", "finance.read", "finance.manage",
    "growth.read", "growth.manage",
  ]),
  SUPERVISOR: new Set([
    "orders.read", "orders.create", "orders.accept", "orders.prepare", "orders.ready", "orders.serve", "orders.reject", "orders.edit",
    "payments.read", "payments.confirm", "payments.refund",
    "menu.read", "menu.manage", "tables.read", "tables.manage",
    "service_requests.read", "service_requests.manage", "history.read", "analytics.read", "settings.read", "staff.read", "audit.read",
    "kds.manage", "inventory.read", "inventory.manage", "reservations.read", "reservations.manage", "finance.read",
    "growth.read", "growth.manage",
  ]),
  CASHIER: new Set([
    "orders.read", "orders.create", "orders.edit",
    "payments.read", "payments.confirm", "history.read", "menu.read", "tables.read",
    "reservations.read", "reservations.manage", "finance.read",
    "growth.read",
  ]),
  WAITER: new Set([
    "orders.read", "orders.create", "orders.accept", "orders.serve",
    "payments.read", "menu.read", "tables.read",
    "service_requests.read", "service_requests.manage", "history.read",
    "reservations.read", "reservations.manage",
    "growth.read",
  ]),
  KITCHEN: new Set([
    "orders.read", "orders.prepare", "orders.ready", "menu.read",
    "inventory.read",
  ]),
  ORG_ADMIN: new Set([
    "orders.read", "orders.create", "orders.accept", "orders.prepare", "orders.ready", "orders.serve", "orders.reject", "orders.edit",
    "payments.read", "payments.confirm", "payments.refund", "payments.configure",
    "menu.read", "menu.manage", "tables.read", "tables.manage",
    "service_requests.read", "service_requests.manage", "history.read", "analytics.read",
    "settings.read", "settings.manage", "staff.read", "audit.read", "integrations.read", "integrations.manage",
    "organization.read", "organization.manage",
    "kds.manage", "inventory.read", "inventory.manage", "reservations.read", "reservations.manage", "finance.read", "finance.manage",
    "growth.read", "growth.manage",
  ]),
  ORG_ANALYST: new Set([
    "orders.read", "payments.read", "menu.read", "tables.read", "service_requests.read",
    "history.read", "analytics.read", "settings.read", "audit.read", "integrations.read",
    "organization.read",
    "inventory.read", "reservations.read", "finance.read",
    "growth.read",
  ]),
};

export function isRestaurantRole(value: string): value is RestaurantRole {
  return value in ROLE_CAPABILITIES;
}

export function capabilitiesForRole(role: string): Capability[] {
  if (!isRestaurantRole(role)) return [];
  return CAPABILITIES.filter(capability => ROLE_CAPABILITIES[role].has(capability));
}

export function roleHasCapability(role: string, capability: Capability): boolean {
  return isRestaurantRole(role) && ROLE_CAPABILITIES[role].has(capability);
}

export function roleAllowedByRouteRoles(role: string, allowedRoles: readonly string[]) {
  if (allowedRoles.includes(role)) return true;
  // An organization admin acts like a location manager, never like its legal/billing owner.
  return role === "ORG_ADMIN" && allowedRoles.some(allowed => allowed === "MANAGER" || allowed === "SUPERVISOR");
}

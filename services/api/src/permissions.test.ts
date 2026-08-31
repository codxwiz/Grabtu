import assert from "node:assert/strict";
import test from "node:test";
import { CAPABILITIES, capabilitiesForRole, roleAllowedByRouteRoles, roleHasCapability } from "./permissions.js";

test("owner receives every registered capability", () => {
  assert.deepEqual(capabilitiesForRole("OWNER"), [...CAPABILITIES]);
});

test("unknown roles are denied by default", () => {
  assert.deepEqual(capabilitiesForRole("UNKNOWN"), []);
  assert.equal(roleHasCapability("UNKNOWN", "orders.read"), false);
});

test("kitchen access stops at ready and cannot confirm payments", () => {
  assert.equal(roleHasCapability("KITCHEN", "orders.prepare"), true);
  assert.equal(roleHasCapability("KITCHEN", "orders.ready"), true);
  assert.equal(roleHasCapability("KITCHEN", "orders.serve"), false);
  assert.equal(roleHasCapability("KITCHEN", "payments.confirm"), false);
  assert.equal(roleHasCapability("KITCHEN", "inventory.read"), true);
  assert.equal(roleHasCapability("KITCHEN", "inventory.manage"), false);
  assert.equal(roleHasCapability("KITCHEN", "kds.manage"), false);
});

test("manager cannot administer billing or owner accounts", () => {
  assert.equal(roleHasCapability("MANAGER", "billing.manage"), false);
  assert.equal(roleHasCapability("MANAGER", "staff.manage"), false);
  assert.equal(roleHasCapability("MANAGER", "integrations.manage"), true);
  assert.equal(roleHasCapability("MANAGER", "inventory.manage"), true);
  assert.equal(roleHasCapability("MANAGER", "finance.manage"), true);
  assert.equal(roleHasCapability("MANAGER", "growth.manage"), true);
});

test("organization analyst is read only across locations", () => {
  assert.equal(roleHasCapability("ORG_ANALYST", "analytics.read"), true);
  assert.equal(roleHasCapability("ORG_ANALYST", "orders.read"), true);
  assert.equal(roleHasCapability("ORG_ANALYST", "orders.edit"), false);
  assert.equal(roleHasCapability("ORG_ANALYST", "payments.confirm"), false);
  assert.equal(roleHasCapability("ORG_ANALYST", "settings.manage"), false);
  assert.equal(roleHasCapability("ORG_ANALYST", "growth.read"), true);
  assert.equal(roleHasCapability("ORG_ANALYST", "growth.manage"), false);
});

test("manual payment confirmation is limited to operational payment roles", () => {
  for (const role of ["OWNER", "MANAGER", "SUPERVISOR", "CASHIER"]) {
    assert.equal(roleHasCapability(role, "payments.confirm"), true, `${role} should confirm payments`);
  }
  for (const role of ["WAITER", "KITCHEN", "ORG_ANALYST", "UNKNOWN"]) {
    assert.equal(roleHasCapability(role, "payments.confirm"), false, `${role} must not confirm payments`);
  }
});

test("organization admins cannot enter owner-only billing routes", () => {
  assert.equal(roleAllowedByRouteRoles("ORG_ADMIN", ["OWNER"]), false);
  assert.equal(roleAllowedByRouteRoles("ORG_ADMIN", ["OWNER", "MANAGER"]), true);
  assert.equal(roleAllowedByRouteRoles("ORG_ANALYST", ["OWNER", "MANAGER", "SUPERVISOR"]), false);
});

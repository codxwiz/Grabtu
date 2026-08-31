import assert from "node:assert/strict";
import test from "node:test";
import { isOfflineQueueSafe } from "./offline.js";

test("only reversible restaurant operations are approved for offline replay", () => {
  assert.equal(isOfflineQueueSafe("/api/orders/KN-1/status", "PATCH"), true);
  assert.equal(isOfflineQueueSafe("/api/admin/service-requests/request-1", "PATCH"), true);
  assert.equal(isOfflineQueueSafe("/api/admin/tables/table-1/clear", "POST"), true);
});

test("financial and configuration mutations remain online-only", () => {
  assert.equal(isOfflineQueueSafe("/api/orders/KN-1/payment-status", "PATCH"), false);
  assert.equal(isOfflineQueueSafe("/api/admin/orders/KN-1/refund", "POST"), false);
  assert.equal(isOfflineQueueSafe("/api/admin/card-merchant", "PUT"), false);
  assert.equal(isOfflineQueueSafe("/api/admin/menu/items/item-1", "DELETE"), false);
});

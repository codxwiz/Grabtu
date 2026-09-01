import assert from "node:assert/strict";
import test from "node:test";
import { isOpenWaiterCall, isWaiterCall } from "./WaiterAlerts";
import type { ServiceRequest } from "./types";

const request = (type: string, status = "OPEN"): ServiceRequest => ({
  id: `${type}-${status}`,
  tableId: "table-1",
  tableLabel: "Table 1",
  type,
  status,
  createdAt: "2026-09-01T00:00:00.000Z",
});

test("recognizes production and demo waiter-call shapes", () => {
  assert.equal(isOpenWaiterCall(request("WAITER")), true);
  assert.equal(isOpenWaiterCall(request("call_waiter")), true);
});

test("does not alert for acknowledged or unrelated service requests", () => {
  assert.equal(isOpenWaiterCall(request("WAITER", "ACKNOWLEDGED")), false);
  assert.equal(isOpenWaiterCall(request("SAUCE_REFILL")), false);
});

test("keeps acknowledged waiter calls available for the service request queue", () => {
  assert.equal(isWaiterCall(request("CALL_WAITER", "ACKNOWLEDGED")), true);
  assert.equal(isWaiterCall(request("SAUCE_REFILL", "ACKNOWLEDGED")), false);
});

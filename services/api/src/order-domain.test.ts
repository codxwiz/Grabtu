import assert from "node:assert/strict";
import test from "node:test";
import { canTransitionKitchenTicket, orderStateForKitchenTickets, toPublicOrder, validatePaymentSelection } from "./order-domain.js";

test("all completed kitchen tickets move the customer order to served", () => {
  assert.equal(orderStateForKitchenTickets(["COMPLETED", "COMPLETED"]), "SERVED");
  assert.equal(orderStateForKitchenTickets(["READY", "COMPLETED"]), "READY");
  assert.equal(orderStateForKitchenTickets(["PREPARING", "ACKNOWLEDGED"]), "PREPARING");
});

test("kitchen ticket transitions cannot skip production stages", () => {
  assert.equal(canTransitionKitchenTicket("QUEUED", "ACKNOWLEDGED"), true);
  assert.equal(canTransitionKitchenTicket("QUEUED", "READY"), false);
  assert.equal(canTransitionKitchenTicket("READY", "COMPLETED"), true);
  assert.equal(canTransitionKitchenTicket("COMPLETED", "PREPARING"), false);
});

test("public order response uses the shared lowercase payment status shape", () => {
  const order = toPublicOrder({
    displayId: "WL-0001",
    trackingToken: "28ec9eb1-8fa5-4010-9b4c-48d755d8dc39",
    restaurantId: "restaurant-1",
    tableId: "table-1",
    tableLabel: "Table 1",
    status: "NEW",
    totalAmount: 525,
    subtotalAmount: 500,
    taxAmount: 25,
    serviceChargeAmount: 0,
    paymentStatus: "REPORTED",
    paymentMode: "upi",
    createdAt: new Date("2026-08-24T00:00:00.000Z"),
    updatedAt: new Date("2026-08-24T00:01:00.000Z"),
    items: [{ id: "line-1", menuItemId: "item-1", name: "Lunch", quantity: 1, unitPrice: 500 }],
  });
  assert.equal(order.status, "new");
  assert.equal(order.paymentStatus, "reported");
  assert.equal(order.paymentMode, "upi");
  assert.equal(order.subtotalAmount, 500);
  assert.deepEqual(order.items[0], { id: "line-1", menuItemId: "item-1", name: "Lunch", quantity: 1, unitPrice: 500, notes: undefined, options: undefined });
});

test("payment mode and UPI method must agree", () => {
  assert.deepEqual(validatePaymentSelection({ paymentMode: "upi" }), { ok: false, message: "Choose an active UPI payment method" });
  assert.equal(validatePaymentSelection({ paymentMode: "upi", paymentMethodId: "method-1" }).ok, true);
  assert.equal(validatePaymentSelection({ paymentMode: "card", paymentMethodId: "method-1" }).ok, false);
  assert.deepEqual(validatePaymentSelection({}), { ok: true, mode: "counter" });
});

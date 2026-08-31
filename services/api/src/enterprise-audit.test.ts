import assert from "node:assert/strict";
import test from "node:test";
import { AuditActorType } from "@prisma/client";
import { calculateAuditHash } from "./enterprise-audit.js";

const base = {
  id: "event-1",
  previousHash: null,
  restaurantId: "restaurant-1",
  actor: { type: AuditActorType.STAFF, id: "staff-1", role: "MANAGER" },
  action: "orders.confirm-payment",
  resourceType: "order",
  resourceId: "order-1",
  requestId: "request-1",
  occurredAt: new Date("2026-07-26T12:00:00.000Z"),
};

test("audit hashes are deterministic across metadata key order", () => {
  const first = calculateAuditHash({ ...base, metadata: { status: "PAID", amount: 1200 } });
  const second = calculateAuditHash({ ...base, metadata: { amount: 1200, status: "PAID" } });
  assert.equal(first, second);
});

test("audit hash changes when protected content changes", () => {
  const original = calculateAuditHash({ ...base, metadata: { amount: 1200 } });
  const tampered = calculateAuditHash({ ...base, metadata: { amount: 1201 } });
  assert.notEqual(original, tampered);
});

test("audit hash commits to the previous chain head", () => {
  const first = calculateAuditHash(base);
  const chained = calculateAuditHash({ ...base, id: "event-2", previousHash: first });
  const unchained = calculateAuditHash({ ...base, id: "event-2", previousHash: null });
  assert.notEqual(chained, unchained);
});

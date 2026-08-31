import assert from "node:assert/strict";
import test from "node:test";
import { mutationRequestHash } from "./idempotent-mutation.js";

test("mutation hashes bind the method, path, and body", () => {
  const original = mutationRequestHash("PATCH", "/api/orders/1/status", { status: "ready" });
  assert.notEqual(original, mutationRequestHash("PATCH", "/api/orders/1/status", { status: "served" }));
  assert.notEqual(original, mutationRequestHash("PATCH", "/api/orders/2/status", { status: "ready" }));
  assert.notEqual(original, mutationRequestHash("POST", "/api/orders/1/status", { status: "ready" }));
});

test("mutation hashes are stable for an identical replay", () => {
  assert.equal(
    mutationRequestHash("PATCH", "/api/orders/1/status", { status: "ready" }),
    mutationRequestHash("PATCH", "/api/orders/1/status", { status: "ready" }),
  );
});

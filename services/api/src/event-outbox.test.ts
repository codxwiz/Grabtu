import assert from "node:assert/strict";
import test from "node:test";
import { retryDelayMs } from "./event-outbox.js";

test("outbox retries use bounded exponential backoff", () => {
  assert.equal(retryDelayMs(1), 1_000);
  assert.equal(retryDelayMs(2), 2_000);
  assert.equal(retryDelayMs(3), 4_000);
  assert.equal(retryDelayMs(20), 300_000);
});

test("outbox retry delay never drops below one second", () => {
  assert.equal(retryDelayMs(0), 1_000);
  assert.equal(retryDelayMs(-10), 1_000);
});

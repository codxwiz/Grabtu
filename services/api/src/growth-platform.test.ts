import assert from "node:assert/strict";
import test from "node:test";
import { calculateEarnedPoints, hashDeveloperKey, integrationEventTopic, isBlockedWebhookHostname, signWebhookPayload } from "./growth-platform.js";

test("loyalty points are deterministic and always rounded down",()=>{
  assert.equal(calculateEarnedPoints(235,1),235);
  assert.equal(calculateEarnedPoints(99,1.25),123);
  assert.throws(()=>calculateEarnedPoints(-1,1));
});

test("developer API keys are stored as one-way hashes",()=>{
  const raw="kn_live_example-key";
  assert.equal(hashDeveloperKey(raw),hashDeveloperKey(raw));
  assert.notEqual(hashDeveloperKey(raw),raw);
  assert.notEqual(hashDeveloperKey(raw),hashDeveloperKey(`${raw}-other`));
});

test("webhook signatures bind timestamp and payload",()=>{
  const first=signWebhookPayload("secret","100","{\"id\":1}");
  assert.equal(first,signWebhookPayload("secret","100","{\"id\":1}"));
  assert.notEqual(first,signWebhookPayload("secret","101","{\"id\":1}"));
  assert.notEqual(first,signWebhookPayload("secret","100","{\"id\":2}"));
});

test("webhook SSRF guard blocks loopback and private networks",()=>{
  for(const host of["localhost","service.local","127.0.0.1","10.0.0.2","172.16.4.2","192.168.1.8","169.254.169.254","::1","fd00::1"])assert.equal(isBlockedWebhookHostname(host),true,host);
  assert.equal(isBlockedWebhookHostname("hooks.example.com"),false);
  assert.equal(isBlockedWebhookHostname("8.8.8.8"),false);
});

test("domain mutations map to supported integration topics",()=>{
  assert.equal(integrationEventTopic("/api/orders","POST"),"order.created");
  assert.equal(integrationEventTopic("/api/orders/ORD-1/payment-status","PATCH"),"payment.updated");
  assert.equal(integrationEventTopic("/api/admin/inventory/item/movements","POST"),"inventory.updated");
  assert.equal(integrationEventTopic("/api/admin/reservations","POST"),"reservation.updated");
  assert.equal(integrationEventTopic("/api/orders/ORD-1/status","PATCH"),"order.updated");
});

import test from "node:test";
import assert from "node:assert/strict";
import { classifyProviderState } from "./payment-reconciliation.js";

test("matches a captured payment only when financial fields agree", () => {
  assert.deepEqual(classifyProviderState({
    kind: "PAYMENT", expectedAmount: 149900, expectedCurrency: "INR", expectedOrderReference: "order_1",
    provider: { reference: "pay_1", amount: 149900, currency: "INR", orderReference: "order_1", status: "captured" },
  }), { status: "MATCHED", mismatchCode: null });
});

test("refuses an amount mismatch even when provider says captured", () => {
  assert.deepEqual(classifyProviderState({
    kind: "PAYMENT", expectedAmount: 149900, expectedCurrency: "INR",
    provider: { reference: "pay_1", amount: 149800, currency: "INR", status: "captured" },
  }), { status: "MISMATCH", mismatchCode: "AMOUNT_MISMATCH" });
});

test("keeps authorized payments pending until capture", () => {
  assert.deepEqual(classifyProviderState({
    kind: "PAYMENT", expectedAmount: 149900, expectedCurrency: "INR",
    provider: { reference: "pay_1", amount: 149900, currency: "INR", status: "authorized" },
  }), { status: "PENDING", mismatchCode: null });
});

test("matches processed refunds", () => {
  assert.deepEqual(classifyProviderState({
    kind: "REFUND", expectedAmount: 149900, expectedCurrency: "INR", expectedOrderReference: "pay_1",
    provider: { reference: "rfnd_1", orderReference: "pay_1", amount: 149900, currency: "INR", status: "processed" },
  }), { status: "MATCHED", mismatchCode: null });
});

test("never matches incomplete provider financial data", () => {
  assert.deepEqual(classifyProviderState({
    kind: "PAYMENT", expectedAmount: 149900, expectedCurrency: "INR", expectedOrderReference: "order_1",
    provider: { reference: "pay_1", currency: "INR", orderReference: "order_1", status: "captured" },
  }), { status: "MISMATCH", mismatchCode: "PROVIDER_AMOUNT_MISSING" });
});

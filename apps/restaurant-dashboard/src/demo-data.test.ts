import assert from "node:assert/strict";
import test from "node:test";
import { demoRequest } from "./demo-data";
import type { Category, MenuItemOption, PaymentMethodAdmin, RestaurantSettings, SessionUser, StaffMember } from "./types";

test("demo owner can prepare orders and confirm payments", async () => {
  const user = await demoRequest<SessionUser>("/api/auth/me");
  assert.equal(user.capabilities?.includes("orders.prepare"), true);
  assert.equal(user.capabilities?.includes("payments.confirm"), true);
});

test("demo menu always returns option arrays", async () => {
  const categories = await demoRequest<Category[]>("/api/admin/menu");
  const itemWithoutEmbeddedOptions = categories.flatMap(category => category.items).find(item => !Array.isArray(item.options));
  assert.ok(itemWithoutEmbeddedOptions);
  const options = await demoRequest<MenuItemOption[]>(`/api/admin/menu/items/${itemWithoutEmbeddedOptions.id}/options`);
  assert.ok(Array.isArray(options));
});

test("demo payment destinations can be created", async () => {
  const created = await demoRequest<PaymentMethodAdmin>("/api/admin/payment-methods", {
    method: "POST",
    body: JSON.stringify({ provider: "other", displayName: "Test destination", upiId: "test@upi" }),
  });
  assert.equal(created.displayName, "Test destination");
  const payments = await demoRequest<PaymentMethodAdmin[]>("/api/admin/payment-methods");
  assert.equal(payments.some(payment => payment.id === created.id), true);
});

test("demo staff members can be created", async () => {
  const created = await demoRequest<StaffMember>("/api/admin/staff", {
    method: "POST",
    body: JSON.stringify({ name: "Test Staff", phone: "+919999999999", role: "KITCHEN" }),
  });
  assert.equal(created.name, "Test Staff");
  const staff = await demoRequest<StaffMember[]>("/api/admin/staff");
  assert.equal(staff.some(member => member.id === created.id), true);
});

test("demo restaurant name updates across settings and session", async () => {
  const settings = await demoRequest<RestaurantSettings>("/api/admin/settings", {
    method: "PATCH",
    body: JSON.stringify({ name: "Demo Company" }),
  });
  const user = await demoRequest<SessionUser>("/api/auth/me");
  assert.equal(settings.name, "Demo Company");
  assert.equal(user.restaurant.name, "Demo Company");
});

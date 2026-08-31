import test from "node:test";
import assert from "node:assert/strict";
import { canAccessOrganizationLocation, organizationRoleForLocation } from "./organization-access.js";

test("keeps the staff role at the home location", () => {
  assert.deepEqual(canAccessOrganizationLocation({homeRestaurantId:"home",targetRestaurantId:"home",homeRole:"WAITER"}),{allowed:true,role:"WAITER"});
});

test("maps organization admins and analysts to scoped virtual roles", () => {
  assert.equal(organizationRoleForLocation("ADMIN"),"ORG_ADMIN");
  assert.equal(organizationRoleForLocation("ANALYST"),"ORG_ANALYST");
});

test("denies cross-location access to ordinary members", () => {
  assert.deepEqual(canAccessOrganizationLocation({homeRestaurantId:"home",targetRestaurantId:"other",homeRole:"MANAGER",membershipRole:"MEMBER"}),{allowed:false,role:null});
});

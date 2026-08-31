export type OrganizationAccessRole = "OWNER" | "ORG_ADMIN" | "ORG_ANALYST";

export function organizationRoleForLocation(role: string): OrganizationAccessRole | null {
  if (role === "OWNER") return "OWNER";
  if (role === "ADMIN") return "ORG_ADMIN";
  if (role === "ANALYST") return "ORG_ANALYST";
  return null;
}

export function canAccessOrganizationLocation(input: {
  homeRestaurantId: string;
  targetRestaurantId: string;
  homeRole: string;
  membershipRole?: string | null;
}) {
  if (input.homeRestaurantId === input.targetRestaurantId) return { allowed: true, role: input.homeRole };
  const role = input.membershipRole ? organizationRoleForLocation(input.membershipRole) : null;
  return role ? { allowed: true, role } : { allowed: false, role: null };
}

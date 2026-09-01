import type { Order } from "@whitelabel/shared-types";
export type Page = "orders" | "history" | "analytics" | "menu" | "inventory" | "reservations" | "finance" | "growth" | "tables" | "table-status" | "kds" | "payments" | "staff" | "settings" | "requests" | "billing" | "organization";
export type MenuItemOption = {id:string;name:string;priceDelta:number;isAvailable:boolean};
export type MenuItem = { id:string; categoryId:string; name:string; description:string; price:number; isAvailable:boolean; isVeg:boolean; tags:string[]; imageUrl?:string;prepMinutes?:number;hsnCode?:string;gstRate?:number; options?:MenuItemOption[] };
export type Category = { id:string; name:string; sortOrder:number; items:MenuItem[] };
export type DiningTable = { id:string; label:string; code:string; isActive:boolean; serviceStatus?:"AVAILABLE"|"OCCUPIED"|"READY_TO_CLEAR"|"DISABLED"; activeOrderCount?:number; latestOrder?:{id:string;status:string;createdAt:string}|null; _count:{orders:number} };
export type OrganizationLocation={id:string;name:string;slug:string;locationCode:string;timezone:string;plan:string;planStatus:string};
export type SessionUser = {
  name:string;
  phone?:string|null;
  role:string;
  capabilities?:string[];
  restaurant:{id:string;name:string;slug:string;locationCode?:string;timezone?:string;plan?:string;trialEndsAt?:string|null};
  organization?:{id:string;name:string;slug:string;role?:string;locations:OrganizationLocation[]}|null;
};
export type PaymentMethodAdmin={id:string;provider:string;displayName:string;upiId?:string;phone?:string;qrImageData:string;isActive:boolean};
export type CardMerchantConfig={provider:string;maskedKeyId:string;connected:boolean;enabled:boolean;testMode:boolean;webhookUrl:string;webhookSecret?:string;verifiedAt?:string|null};
export type StaffMember={id:string;name:string;phone?:string|null;firebaseUid?:string|null;role:string;isActive:boolean;createdAt:string;lastLoginAt?:string};
export type Analytics={days:number;from:string;to:string;totalOrders:number;revenue:number;daily:{date:string;orders:number;revenue:number}[];topItems:{name:string;quantity:number;revenue:number}[]};
export type RestaurantSettings={name:string;orderingEnabled:boolean;orderPauseMessage:string;taxPercent:number;serviceChargePercent:number;plan:string;planStatus:string;trialEndsAt?:string|null;featuresLocked?:boolean;featureLockReason?:string|null;logoUrl?:string;coverImageUrl?:string;brandColor?:string};
export type ServiceRequest={id:string;tableId:string;tableLabel?:string;tableCode?:string;type:string;note?:string;status:string;createdAt:string};
export type Entitlements={
  plan:string;accessLevel?:"standard"|"enterprise";planStatus:string;trialEndsAt?:string|null;featuresLocked?:boolean;featureLockReason?:string|null;
  features?:{enterprise:boolean;multiLocation:boolean;inventory:boolean;reservations:boolean;finance:boolean;growth:boolean;developerPlatform:boolean};
  limits:{tables:number;staff:number;menuItems:number;analyticsDays:number;locations?:number};
};
export type Billing={currentPlan?:string;subscription?:{id:string;provider?:string;providerSubscriptionId?:string|null;plan:string;status:string;currentPeriodEnd:string;cancelAtPeriodEnd:boolean}|null;mandateAuthorized?:boolean;invoices:{id:string;number:string;status:string;amount:number;currency:string;createdAt:string;hostedUrl?:string|null}[];plans:{plan:string;amount:number;currency:string;limits:Entitlements["limits"]}[]};
export type SupportTicket={id:string;subject:string;category:string;priority:string;message:string;status:string;createdAt:string;updatedAt:string;resolvedAt?:string|null};
export type OrganizationOverview={
  id:string;name:string;slug:string;role?:string;
  locations:OrganizationLocation[];
  memberships:{id:string;role:string;createdAt:string;staffUser:{id:string;name:string;phone?:string|null;isActive:boolean;restaurant:{id:string;name:string;locationCode:string}}}[];
};
export type OrganizationAnalytics={from:string;to:string;orders:number;revenue:number;locations:{id:string;name:string;locationCode:string;orders:number;paidOrders:number;revenue:number;openOrders:number}[]};
export type OrganizationMenuTemplate={id:string;name:string;version:number;createdBy:string;createdAt:string;updatedAt:string};
export type Orders = Order[];

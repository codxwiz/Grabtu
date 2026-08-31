import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { AuditActorType, PrismaClient, OrderStatus as DbOrderStatus, PaymentStatus } from "@prisma/client";
import jwt from "jsonwebtoken";
import QRCode from "qrcode";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import pinoHttp from "pino-http";
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient } from "redis";
import { RedisStore } from "rate-limit-redis";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { MenuResponse, OrderStatus } from "@whitelabel/shared-types";
import { createQrStorage } from "./qr-storage.js";
import { registerBillingHardening } from "./billing-hardening.js";
import { getFirebasePhoneNumber, isFirebaseAuthConfigured, validateFirebaseAuthConfiguration, verifyFirebaseIdToken } from "./firebase-auth.js";
import { buildUpiLaunchOptions, buildUpiPayload, createUpiTransactionReference, manualUpiProvider } from "./upi-payment-provider.js";
import { pushPublicKey, sendRestaurantPush } from "./push-notifications.js";
import { buildRazorpaySubscriptionRequest, createMandateSignature } from "./razorpay-subscription.js";
import { appendAuditEvent, verifyAuditChain } from "./enterprise-audit.js";
import { capabilitiesForRole, roleAllowedByRouteRoles, roleHasCapability, type Capability } from "./permissions.js";
import { enqueueOutboxEvent, processOutboxBatch } from "./event-outbox.js";
import { createIdempotentMutationMiddleware } from "./idempotent-mutation.js";
import {
  reconcileRazorpayOrder,
  recordManualUpiReview,
  recordProviderReconciliation,
  resolveManualUpiReview,
} from "./payment-reconciliation.js";
import { organizationRoleForLocation } from "./organization-access.js";
import { consumeInventoryForOrder, ensureKitchenTickets, issueCreditNote, issueTaxInvoice, registerOperationsPlatform } from "./operations-platform.js";
import { deliverDeveloperWebhooks, integrationEventTopic, registerGrowthPlatform } from "./growth-platform.js";
import { toPublicOrder as toOrder, validatePaymentSelection } from "./order-domain.js";

const prisma = new PrismaClient();
const idempotentMutation = createIdempotentMutationMiddleware(prisma);
const PORT = Number(process.env.PORT || 4000);
const JWT_SECRET = process.env.JWT_SECRET || "local-development-secret-change-before-deploy";
const DEFAULT_JWT_SECRET = "local-development-secret-change-before-deploy";
const DEFAULT_BILLING_WEBHOOK_SECRET = "local-billing-secret";
const DEFAULT_MASTER_ADMIN_PHONE = "+919999999999";
const PAYMENT_CREDENTIALS_SECRET = process.env.PAYMENT_CREDENTIALS_SECRET || JWT_SECRET;
function encryptMerchantSecret(value:string){const key=createHash("sha256").update(PAYMENT_CREDENTIALS_SECRET).digest(),iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",key,iv),encrypted=Buffer.concat([cipher.update(value,"utf8"),cipher.final()]);return [iv.toString("base64"),cipher.getAuthTag().toString("base64"),encrypted.toString("base64")].join(".");}
function decryptMerchantSecret(value:string){const[iv,tag,encrypted]=value.split("."),key=createHash("sha256").update(PAYMENT_CREDENTIALS_SECRET).digest(),decipher=createDecipheriv("aes-256-gcm",key,Buffer.from(iv,"base64"));decipher.setAuthTag(Buffer.from(tag,"base64"));return Buffer.concat([decipher.update(Buffer.from(encrypted,"base64")),decipher.final()]).toString("utf8");}
function maskMerchantKey(value:string|null){return value?`${value.slice(0,8)}${"•".repeat(Math.min(8,Math.max(4,value.length-8)))}`:"";}
function isPlaceholderSecret(value:string|undefined,fallbacks:string[]=[]){if(!value)return true;const normalized=value.trim().toLowerCase();return !normalized||fallbacks.map(item=>item.trim().toLowerCase()).includes(normalized)||normalized.includes("change-this")||normalized.includes("replace-with");}
function normalizeMetricsPath(pathname: string) {
  return pathname
    .replace(/\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}(?=\/|$)/gi, "/:id")
    .replace(/\/c[a-z0-9]{24}(?=\/|$)/gi, "/:id")
    .replace(/\/[a-z0-9_-]{20,}(?=\/|$)/gi, "/:id")
    .replace(/\/\d+(?=\/|$)/g, "/:id");
}
function isPasswordProtectionBypassPath(pathname: string) {
  return pathname === "/api/auth/me"
    || pathname === "/api/auth/logout"
    || pathname.startsWith("/api/admin/billing")
    || pathname === "/api/admin/entitlements";
}
function captureRawBody(req: Request & { rawBody?: Buffer }, _res: Response, buf: Buffer) {
  if (req.url.startsWith("/api/billing/webhook")||req.url.startsWith("/api/payments/razorpay/webhook/")) req.rawBody = Buffer.from(buf);
}
function validateProductionEnvironment() {
  if (process.env.NODE_ENV !== "production") return;

  const errors: string[] = [];
  const productionUrlPattern = /^https:\/\/.+/i;
  const requiredOrigins = [
    ["CUSTOMER_ORIGIN", process.env.CUSTOMER_ORIGIN],
    ["DASHBOARD_ORIGIN", process.env.DASHBOARD_ORIGIN],
  ] as const;

  if (!process.env.DATABASE_URL) errors.push("DATABASE_URL is required in production");
  if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) errors.push("PORT must be a valid TCP port");
  if (JWT_SECRET.length < 32 || JWT_SECRET === DEFAULT_JWT_SECRET || isPlaceholderSecret(process.env.JWT_SECRET,[DEFAULT_JWT_SECRET])) errors.push("JWT_SECRET must contain at least 32 non-placeholder characters in production");
  if (process.env.TRUST_PROXY !== "1") errors.push("TRUST_PROXY must be set to 1 behind a proxy in production");
  if (process.env.MASTER_ADMIN_PHONE && (!z.string().regex(/^\+[1-9][0-9]{9,14}$/).safeParse(process.env.MASTER_ADMIN_PHONE).success || process.env.MASTER_ADMIN_PHONE === DEFAULT_MASTER_ADMIN_PHONE)) errors.push("MASTER_ADMIN_PHONE must be a real E.164 operator phone when configured");
  if (!process.env.BILLING_WEBHOOK_SECRET || process.env.BILLING_WEBHOOK_SECRET.length < 24 || isPlaceholderSecret(process.env.BILLING_WEBHOOK_SECRET,[DEFAULT_BILLING_WEBHOOK_SECRET])) errors.push("BILLING_WEBHOOK_SECRET must contain at least 24 non-placeholder characters in production");
  if (!process.env.PAYMENT_CREDENTIALS_SECRET || process.env.PAYMENT_CREDENTIALS_SECRET.length < 32 || isPlaceholderSecret(process.env.PAYMENT_CREDENTIALS_SECRET)) errors.push("PAYMENT_CREDENTIALS_SECRET must contain at least 32 non-placeholder characters in production");
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) errors.push("VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are required for production web push");
  try { validateFirebaseAuthConfiguration(); } catch (error) { errors.push(error instanceof Error ? error.message : "Firebase Admin credentials are invalid"); }

  for (const [name, value] of requiredOrigins) {
    if (!value) {
      errors.push(`${name} is required in production`);
      continue;
    }
    if (!productionUrlPattern.test(value)) {
      errors.push(`${name} must be an https:// URL in production`);
    }
    if (/localhost|127\.0\.0\.1/i.test(value)) {
      errors.push(`${name} cannot point at localhost in production`);
    }
  }

  for (const [name, value] of [["API_ORIGIN", process.env.API_ORIGIN], ["MASTER_ADMIN_ORIGIN", process.env.MASTER_ADMIN_ORIGIN]] as const) {
    if (!value && name === "MASTER_ADMIN_ORIGIN") continue;
    if (!value) errors.push(`${name} is required in production`);
    else if (!productionUrlPattern.test(value) || /localhost|127\.0\.0\.1/i.test(value)) errors.push(`${name} must be a public https:// URL in production`);
  }

  if (process.env.EMAIL_PROVIDER?.toLowerCase() === "resend") {
    if (!process.env.EMAIL_FROM) errors.push("EMAIL_FROM is required when EMAIL_PROVIDER=resend");
    if (!process.env.RESEND_API_KEY) errors.push("RESEND_API_KEY is required when EMAIL_PROVIDER=resend");
  }

  const razorpayBillingValues = [
    process.env.RAZORPAY_KEY_ID,
    process.env.RAZORPAY_KEY_SECRET,
    process.env.RAZORPAY_PLAN_STARTER_ID,
    process.env.RAZORPAY_PLAN_GROWTH_ID,
    process.env.RAZORPAY_PLAN_BUSINESS_ID || process.env.RAZORPAY_PLAN_PRO_ID,
  ];
  if (razorpayBillingValues.some(Boolean) && razorpayBillingValues.some(value => !value)) {
    errors.push("Razorpay subscription billing must be configured with the key ID, key secret, and all three plan IDs together");
  }

  if (errors.length) {
    throw new Error(`Invalid production environment:\n- ${errors.join("\n- ")}`);
  }
}

validateProductionEnvironment();
const origins = [
  process.env.CUSTOMER_ORIGIN || "http://localhost:5173",
  process.env.DASHBOARD_ORIGIN || "http://localhost:5174",
  process.env.MASTER_ADMIN_ORIGIN || (process.env.NODE_ENV === "production" ? "" : "http://localhost:5175"),
].filter(Boolean).map(origin=>origin.replace(/\/+$/, ""));
const isAllowedOrigin=(origin?:string)=>!origin||origins.includes(origin)||(process.env.NODE_ENV!=="production"&&/^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[0-1])\.\d+\.\d+):517[3-9]$/.test(origin));
const qrStorage=createQrStorage();await qrStorage.ensureReady();
const redisClient=process.env.REDIS_URL?createClient({url:process.env.REDIS_URL}):null,redisSubscriber=redisClient?.duplicate();if(redisClient&&redisSubscriber){await Promise.all([redisClient.connect(),redisSubscriber.connect()]);}
const app = express();
const server = createServer(app);
const io = new Server(server, { cors: { origin: (origin, callback) => callback(null, isAllowedOrigin(origin)) } });
if(redisClient&&redisSubscriber)io.adapter(createAdapter(redisClient,redisSubscriber));
app.set("trust proxy",process.env.TRUST_PROXY==="1"?1:false);
app.use(pinoHttp({redact:["req.headers.authorization","req.body.password","req.body.idToken","req.body.qrImageData","req.body.keySecret"]}));
app.use((req,res,next)=>{
  const requestId=String(req.get("x-request-id")||req.id||randomUUID());
  res.locals.requestId=requestId;
  res.set("X-Request-Id",requestId);
  next();
});
app.use(helmet({contentSecurityPolicy:false,crossOriginResourcePolicy:false}));
app.use(cors({ origin: (origin, callback) => callback(null, isAllowedOrigin(origin)) }));
app.use(express.json({ limit: "6mb", verify: captureRawBody }));
app.use("/api/menu",(_req,res,next)=>{res.set("Cache-Control","no-store");next()});
app.use(async(req,res,next)=>{if(req.path.startsWith("/api/menu/")&&req.path!=="/api/menu/by-token") {try{const slug=req.path.split("/")[3];if(slug&&slug!=="by-token"){const restaurant=await prisma.restaurant.findFirst({where:{slug,isActive:true},select:{id:true}});if(!restaurant)return res.status(404).json({message:"Restaurant is unavailable"})}else if(slug==="by-token"){const token=req.path.split("/")[4],table=await prisma.table.findUnique({where:{qrToken:token},include:{restaurant:{select:{isActive:true}}}});if(!table||!table.isActive||table.deletedAt||!table.restaurant.isActive)return res.status(404).json({message:"Restaurant is unavailable"})}}catch{return res.status(503).json({message:"Restaurant availability check failed"})}}if(req.path==="/api/orders"&&req.method==="POST"&&req.body?.restaurantId){const restaurant=await prisma.restaurant.findFirst({where:{id:String(req.body.restaurantId),isActive:true},select:{id:true}});if(!restaurant)return res.status(409).json({message:"Restaurant is unavailable"})}next()});
const requestCounts = new Map<string, number>();
app.use((req,res,next)=>{
  res.on("finish",()=>{
    const route = `${req.method} ${normalizeMetricsPath(req.path)}`;
    const key = `${route}|${res.statusCode}`;
    requestCounts.set(key,(requestCounts.get(key)||0)+1);
    if (requestCounts.size > 1000) {
      const oldest = requestCounts.keys().next().value as string | undefined;
      if (oldest) requestCounts.delete(oldest);
    }
  });
  next();
});
const redisStore=(prefix:string)=>redisClient?new RedisStore({sendCommand:(...args:string[])=>redisClient.sendCommand(args),prefix}):undefined;
app.use("/api/auth",rateLimit({windowMs:15*60*1000,limit:20,standardHeaders:"draft-8",legacyHeaders:false,skipSuccessfulRequests:false,store:redisStore("white_label:auth:")}));
app.use("/api/orders",rateLimit({windowMs:60*1000,limit:60,standardHeaders:"draft-8",legacyHeaders:false,store:redisStore("white_label:orders:")}));
app.use("/api/customer/orders",rateLimit({windowMs:60*1000,limit:30,standardHeaders:"draft-8",legacyHeaders:false,store:redisStore("white_label:customer-payments:")}));
app.use("/api/contact",rateLimit({windowMs:60*60*1000,limit:5,standardHeaders:"draft-8",legacyHeaders:false,store:redisStore("white_label:contact:")}));
const masterAuthLimiter=rateLimit({windowMs:15*60*1000,limit:10,standardHeaders:"draft-8",legacyHeaders:false,store:redisStore("white_label:master-auth:")});

type AuthRequest = Request & { staff?: { id: string; restaurantId: string; role: string; sessionId:string } };
type MasterAuthRequest = Request & { masterAdmin?: { id:string; sessionId:string; phone?:string|null; name:string } };
type TableRequest = Request & { tableSession?:{restaurantId:string;tableId:string} };
async function tableSessionIsActive(restaurantId:string,tableId:string){return Boolean(await prisma.table.findFirst({where:{id:tableId,restaurantId,isActive:true,deletedAt:null,restaurant:{isActive:true}},select:{id:true}}));}
async function authenticateTable(req:TableRequest,res:Response,next:NextFunction){const token=req.headers["x-table-token"];if(typeof token!=="string")return res.status(401).json({message:"Table session required"});try{const payload=jwt.verify(token,JWT_SECRET,{issuer:"white_label-table"})as {type:string;restaurantId:string;tableId:string};if(payload.type!=="table"||!await tableSessionIsActive(payload.restaurantId,payload.tableId))throw new Error("invalid");req.tableSession={restaurantId:payload.restaurantId,tableId:payload.tableId};next()}catch{return res.status(401).json({message:"Invalid, expired, or inactive table session"})}}
async function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace(/^Bearer /, "");
  if (!token) return res.status(401).json({ message: "Authentication required" });
  try {
    const payload = jwt.verify(token, JWT_SECRET, { issuer: "white-label-restaurant-platform" }) as NonNullable<AuthRequest["staff"]>;
    const session = await prisma.staffSession.findFirst({
      where: { id: payload.sessionId, staffUserId: payload.id, revokedAt: null, expiresAt: { gt: new Date() } },
      include: {
        staffUser: {
          select: {
            isActive: true,
            restaurantId: true,
            role: true,
            organizationMemberships: { where: { isActive: true }, select: { organizationId: true, role: true } },
          },
        },
      },
    });
    if (!session || !session.staffUser.isActive) return res.status(401).json({ message: "Session is no longer active" });
    const restaurant=await prisma.restaurant.findUnique({where:{id:payload.restaurantId},select:{organizationId:true,featuresLocked:true,featureLockReason:true,planStatus:true,trialEndsAt:true}});
    if(!restaurant)return res.status(401).json({message:"Location is no longer available"});
    const homeLocation=session.staffUser.restaurantId===payload.restaurantId;
    const membership=session.staffUser.organizationMemberships.find(item=>item.organizationId===restaurant.organizationId);
    const organizationRole=membership?organizationRoleForLocation(membership.role):null;
    const effectiveRole=homeLocation?(session.staffUser.role==="OWNER"?"OWNER":organizationRole||session.staffUser.role):organizationRole;
    if(!effectiveRole)return res.status(403).json({message:"You do not have access to this location",code:"LOCATION_ACCESS_DENIED"});
    req.staff = {...payload,role:effectiveRole};
    const trialExpired = restaurant.planStatus === "trialing" && !!restaurant.trialEndsAt && restaurant.trialEndsAt <= new Date();
    const billingPath =
      req.path === "/api/admin/billing"
      || req.path.startsWith("/api/admin/billing/")
      || req.path === "/api/admin/entitlements"
      || req.path === "/api/admin/settings"
      || req.path === "/api/auth/me"
      || req.path === "/api/auth/logout";
    if ((restaurant.featuresLocked || trialExpired) && !billingPath) {
      return res.status(423).json({ message: restaurant.featureLockReason || "Your restaurant features are locked. Continue your paid plan to restore access.", code: "FEATURES_LOCKED", planStatus: restaurant.planStatus, trialExpired });
    }
    return next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired session" });
  }
}
async function authenticateMaster(req:MasterAuthRequest,res:Response,next:NextFunction){const token=req.headers.authorization?.replace(/^Bearer /,"");if(!token)return res.status(401).json({message:"Master admin authentication required"});try{const payload=jwt.verify(token,JWT_SECRET,{issuer:"white_label-master"}) as {id:string;sessionId:string;phone?:string|null;name:string};const session=await prisma.platformAdminSession.findFirst({where:{id:payload.sessionId,adminId:payload.id,revokedAt:null,expiresAt:{gt:new Date()}},include:{admin:{select:{isActive:true}}}});if(!session||!session.admin.isActive)return res.status(401).json({message:"Master admin session is no longer active"});req.masterAdmin=payload;next()}catch{return res.status(401).json({message:"Invalid or expired master admin session"})}}
function emitPlatformSync(restaurantId:string|undefined,scope:string){io.to("platform-admins").emit("platform:sync",{restaurantId:restaurantId||null,scope,at:new Date().toISOString()});}
function emitRestaurantSync(restaurantId:string,scope:string){io.to(`restaurant:${restaurantId}`).emit("restaurant:sync",{restaurantId,scope,at:new Date().toISOString()});emitPlatformSync(restaurantId,scope);}
app.use((req:AuthRequest&MasterAuthRequest&TableRequest,res,next)=>{
  if(["GET","HEAD","OPTIONS"].includes(req.method))return next();
  res.on("finish",()=>{
    if(res.statusCode<200||res.statusCode>=400)return;
    const restaurantId=String(res.locals.syncRestaurantId||req.staff?.restaurantId||req.tableSession?.restaurantId||req.body?.restaurantId||"")||undefined;
    if(req.masterAdmin){
      if(restaurantId)emitRestaurantSync(restaurantId,req.path);
      else emitPlatformSync(undefined,req.path);
    }else if(restaurantId){
      emitPlatformSync(restaurantId,req.path);
    }else if(req.path.startsWith("/api/contact")||req.path.startsWith("/api/auth/signup")){
      emitPlatformSync(undefined,req.path);
    }
    const normalizedPath=normalizeMetricsPath(req.path);
    const segments=normalizedPath.split("/").filter(Boolean);
    const topic=restaurantId?integrationEventTopic(req.path,req.method):"platform.sync";
    void enqueueOutboxEvent(prisma,{
      restaurantId,
      topic,
      aggregateType:segments[2]||segments[1]||"api",
      aggregateId:res.locals.auditResourceId,
      payload:{scope:req.path,at:new Date().toISOString(),requestId:res.locals.requestId},
    }).catch(error=>req.log.error({error,requestId:res.locals.requestId},"domain event enqueue failed"));
    const actor=req.masterAdmin
      ? {type:AuditActorType.PLATFORM_ADMIN,id:req.masterAdmin.id,role:"PLATFORM_ADMIN"}
      : req.staff
        ? {type:AuditActorType.STAFF,id:req.staff.id,role:req.staff.role}
        : req.tableSession
          ? {type:AuditActorType.CUSTOMER,id:req.tableSession.tableId,role:"TABLE_SESSION"}
          : req.path.includes("/webhook")
            ? {type:AuditActorType.INTEGRATION,role:"WEBHOOK"}
            : {type:AuditActorType.SYSTEM,role:"PUBLIC_API"};
    void appendAuditEvent(prisma,{
      restaurantId,
      actor,
      action:`${req.method.toLowerCase()}:${normalizedPath}`,
      resourceType:segments[2]||segments[1]||"api",
      resourceId:res.locals.auditResourceId,
      requestId:res.locals.requestId,
      ipAddress:req.ip,
      userAgent:req.get("user-agent")?.slice(0,300),
      metadata:{statusCode:res.statusCode},
    }).catch(error=>req.log.error({error,requestId:res.locals.requestId},"enterprise audit append failed"));
  });
  next();
});
async function writePlatformAudit(adminId:string,data:{restaurantId?:string;action:string;targetType:string;targetId?:string;metadata?:unknown}){await prisma.platformAuditLog.create({data:{adminId,restaurantId:data.restaurantId,action:data.action,targetType:data.targetType,targetId:data.targetId,metadata:data.metadata as any}})}
function decodeImage(data:string){const match=data.match(/^data:image\/(png|jpeg|webp);base64,(.+)$/);if(!match)throw new Error("Invalid image");return{extension:match[1]==="jpeg"?"jpg":match[1],buffer:Buffer.from(match[2],"base64")}}
function authorize(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    return roleAllowedByRouteRoles(req.staff!.role,roles)?next():res.status(403).json({message:"You do not have permission for this action",code:"FORBIDDEN_ROLE",requiredRoles:roles});
  };
}
function authorizeCapability(capability:Capability){return(req:AuthRequest,res:Response,next:NextFunction)=>roleHasCapability(req.staff!.role,capability)?next():res.status(403).json({message:"You do not have permission for this action",code:"FORBIDDEN_CAPABILITY",requiredCapability:capability});}
async function requireEnterpriseAccess(req:AuthRequest,res:Response,next:NextFunction){
  const restaurant=await prisma.restaurant.findUnique({where:{id:req.staff!.restaurantId},select:{plan:true}});
  const organizationRoute=req.path.startsWith("/api/organization");
  if(restaurant&&(organizationRoute?enterpriseAccess(restaurant.plan):businessAccess(restaurant.plan)))return next();
  if(["GET","HEAD"].includes(req.method))return next();
  const requiredPlan=organizationRoute?"Enterprise":"Business";
  return res.status(403).json({message:`Editing this workspace requires the Restaurant Platform ${requiredPlan} plan.`,code:`${requiredPlan.toUpperCase()}_REQUIRED`,upgrade:{label:`Upgrade to ${requiredPlan}`,href:"https://dashboard.example.com/?page=billing"}});
}
async function toCustomerUpiPayment(payment:any){
  const upiPaymentLink=buildUpiPayload({merchantVpa:payment.merchantVpa,merchantName:payment.merchantName,transactionReference:payment.transactionReference,amountPaise:payment.amountPaise,note:`Restaurant Platform order ${payment.order.displayId}`});
  const qrImageData=await QRCode.toDataURL(upiPaymentLink,{type:"image/png",width:720,margin:2,errorCorrectionLevel:"M",color:{dark:"#102c22",light:"#ffffff"}});
  return {paymentId:payment.id,orderId:payment.order.displayId,transactionReference:payment.transactionReference,amountPaise:payment.amountPaise,currency:"INR",merchantName:payment.merchantName,merchantVpa:payment.merchantVpa,status:payment.status.toLowerCase(),selectedApp:payment.customerSelectedApp||null,customerReference:payment.customerReference||null,expiresAt:payment.expiresAt.toISOString(),qrImageData,launchOptions:buildUpiLaunchOptions(upiPaymentLink).map(({id,label})=>({id,label}))};
}
function buildStaffAuthResponse(staff:{name:string;phone?:string|null;role:string;restaurant:{id:string;name:string;slug:string;plan?:string;trialEndsAt?:Date|null}}){return {name:staff.name,phone:staff.phone||null,role:staff.role.toLowerCase(),restaurant:{id:staff.restaurant.id,name:staff.restaurant.name,slug:staff.restaurant.slug,plan:staff.restaurant.plan||"starter",trialEndsAt:staff.restaurant.trialEndsAt||null}}}
async function organizationContext(staffId:string,restaurantId:string){
  const [staff,location]=await Promise.all([
    prisma.staffUser.findUnique({
      where:{id:staffId},
      select:{
        id:true,name:true,phone:true,role:true,restaurantId:true,
        organizationMemberships:{
          where:{isActive:true},
          select:{
            organizationId:true,role:true,
            organization:{
              select:{
                id:true,name:true,slug:true,
                locations:{where:{isActive:true},select:{id:true,name:true,slug:true,locationCode:true,timezone:true,plan:true,planStatus:true},orderBy:{name:"asc"}},
              },
            },
          },
        },
      },
    }),
    prisma.restaurant.findUnique({where:{id:restaurantId},select:{id:true,name:true,slug:true,locationCode:true,timezone:true,plan:true,planStatus:true,trialEndsAt:true,featuresLocked:true,featureLockReason:true,organizationId:true}}),
  ]);
  if(!staff||!location)return null;
  const membership=staff.organizationMemberships.find(item=>item.organizationId===location.organizationId);
  if(staff.restaurantId!==location.id&&!membership)return null;
  const organization=membership?{...membership.organization,locations:membership.role==="MEMBER"?membership.organization.locations.filter(item=>item.id===staff.restaurantId):membership.organization.locations}:null;
  const organizationRole=membership?organizationRoleForLocation(membership.role):null;
  const effectiveRole=staff.restaurantId===location.id?(staff.role==="OWNER"?"OWNER":organizationRole||staff.role):organizationRole;
  if(!effectiveRole)return null;
  return {staff,location,membership,organization,effectiveRole};
}
const masterLoginInput=z.object({idToken:z.string().min(50)});
const phoneNumberInput=z.string().trim().regex(/^\+[1-9][0-9]{9,14}$/,{message:"Use an E.164 phone number such as +919876543210"});
const masterRestaurantUpdate=z.object({
  isActive:z.boolean().optional(),
  plan:z.enum(["starter","growth","business","pro","enterprise"]).optional(),
  planStatus:z.enum(["trialing","active","past_due","cancelled","expired"]).optional(),
  featuresLocked:z.boolean().optional(),
  featureLockReason:z.string().trim().max(240).nullable().optional(),
  orderingEnabled:z.boolean().optional(),
  orderPauseMessage:z.string().trim().max(240).nullable().optional(),
  taxPercent:z.number().int().min(0).max(100).optional(),
  serviceChargePercent:z.number().int().min(0).max(100).optional(),
  brandColor:z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  logoUrl:z.string().url().max(1000).or(z.literal("")).optional(),
  coverImageUrl:z.string().url().max(1000).or(z.literal("")).optional(),
  trialEndsAt:z.coerce.date().nullable().optional()
});
const masterStaffUpdate=z.object({
  name:z.string().trim().min(2).max(80).optional(),
  role:z.enum(["MANAGER","SUPERVISOR","CASHIER","WAITER","KITCHEN"]).optional(),
  isActive:z.boolean().optional(),
});
const firebaseLoginInput=z.object({idToken:z.string().min(50)});
const firebaseSignupInput=z.object({idToken:z.string().min(50),restaurantName:z.string().trim().min(2).max(80),ownerName:z.string().trim().min(2).max(80),plan:z.enum(["starter","growth","business","pro"]).default("starter"),mandateConsent:z.literal(true)});
const orderInput = z.object({ restaurantId:z.string(), tableId:z.string(), tableLabel:z.string(), paymentMethodId:z.string().optional(), paymentMode:z.enum(["upi","card","counter"]).optional(), items:z.array(z.object({menuItemId:z.string(),quantity:z.number().int().min(1).max(20),notes:z.string().trim().max(200).optional(),optionIds:z.array(z.string()).max(10).refine(ids=>new Set(ids).size===ids.length,{message:"Item options must be unique"}).default([])})).min(1).max(50) });
const itemInput = z.object({ categoryId:z.string(), name:z.string().trim().min(2).max(100), description:z.string().trim().max(300).default(""), price:z.number().int().min(1).max(1_000_000), isVeg:z.boolean(), isAvailable:z.boolean().default(true), tags:z.array(z.string().max(30)).max(5).default([]),imageUrl:z.string().url().max(1000).or(z.literal("")).default(""),prepMinutes:z.number().int().min(1).max(180).default(15),hsnCode:z.string().trim().regex(/^[0-9]{4,8}$/).optional().or(z.literal("")),gstRate:z.coerce.number().min(0).max(50).optional() });
const categoryInput = z.object({ name:z.string().trim().min(2).max(60), sortOrder:z.number().int().min(0).max(1000) });
const tableInput = z.object({ label:z.string().trim().min(2).max(60), code:z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{1,20}$/), isActive:z.boolean().default(true) });
const paymentMethodInput=z.object({provider:z.enum(["google_pay","phonepe","paytm","bhim","other"]),displayName:z.string().trim().min(2).max(60),upiId:z.string().trim().regex(/^[A-Za-z0-9._-]{2,}@[A-Za-z0-9.-]{2,}$/),phone:phoneNumberInput.optional(),qrImageData:z.string().regex(/^data:image\/(png|jpeg|webp);base64,/).max(1_500_000).optional(),isActive:z.boolean().default(true)});
const paymentMethodUpdateInput=z.object({provider:z.enum(["google_pay","phonepe","paytm","bhim","other"]).optional(),displayName:z.string().trim().min(2).max(60).optional(),upiId:z.string().trim().regex(/^[A-Za-z0-9._-]{2,}@[A-Za-z0-9.-]{2,}$/).optional(),phone:phoneNumberInput.optional(),isActive:z.boolean().optional()}).refine(data=>Object.keys(data).length>0,{message:"Add at least one payment method change"});
const cardMerchantInput=z.object({provider:z.literal("razorpay"),keyId:z.string().trim().regex(/^rzp_(?:test|live)_[A-Za-z0-9]+$/),keySecret:z.string().min(8).max(200)});
const assetInput=z.object({kind:z.enum(["logo","cover","menu-item"]),data:z.string().regex(/^data:image\/(png|jpeg|webp);base64,/).max(4_000_000)});
const optionInput=z.object({name:z.string().trim().min(1).max(60),priceDelta:z.number().int().min(-100000).max(100000),isAvailable:z.boolean().default(true)});
const settingsInput=z.object({orderingEnabled:z.boolean().optional(),orderPauseMessage:z.string().trim().max(200).optional(),taxPercent:z.number().int().min(0).max(100).optional(),serviceChargePercent:z.number().int().min(0).max(100).optional(),logoUrl:z.string().url().max(1000).or(z.literal("")).optional(),coverImageUrl:z.string().url().max(1000).or(z.literal("")).optional(),brandColor:z.string().regex(/^#[0-9a-fA-F]{6}$/).optional()});
const serviceRequestInput=z.object({type:z.enum(["WAITER","WATER","CUTLERY","BILL","HELP","OTHER"]),note:z.string().trim().max(200).optional()});
const feedbackInput=z.object({trackingToken:z.string().uuid(),rating:z.number().int().min(1).max(5),comment:z.string().trim().max(500).optional()});
const supportTicketInput=z.object({subject:z.string().trim().min(4).max(120),category:z.enum(["TECHNICAL","PAYMENTS","ACCOUNT","BILLING","OTHER"]),priority:z.enum(["NORMAL","HIGH","URGENT"]).default("NORMAL"),message:z.string().trim().min(10).max(2000)});
const counterOrderEditInput=z.object({tableLabel:z.string().trim().min(1).max(60),totalAmount:z.number().int().min(1).max(1_000_000)});
const contactInquiryInput=z.object({name:z.string().trim().min(2).max(100),email:z.string().trim().email().max(200),phone:z.string().trim().regex(/^\+?[0-9 ()-]{10,20}$/).optional().or(z.literal("")),message:z.string().trim().min(10).max(2000)});
const billingPlanInput=z.object({plan:z.enum(["starter","growth","business","pro"])});
const mandateVerificationInput=z.object({razorpay_payment_id:z.string().regex(/^pay_[A-Za-z0-9]+$/),razorpay_subscription_id:z.string().regex(/^sub_[A-Za-z0-9]+$/),razorpay_signature:z.string().regex(/^[a-f0-9]{64}$/i)});
const PLAN_LIMITS:Record<string,{tables:number;staff:number;menuItems:number;analyticsDays:number;locations:number}>={starter:{tables:5,staff:2,menuItems:15,analyticsDays:7,locations:1},growth:{tables:20,staff:6,menuItems:45,analyticsDays:30,locations:1},business:{tables:60,staff:20,menuItems:150,analyticsDays:90,locations:1},pro:{tables:60,staff:20,menuItems:150,analyticsDays:90,locations:1},enterprise:{tables:1000,staff:1000,menuItems:5000,analyticsDays:730,locations:1000}};
const PLAN_PRICES:Record<string,number>={starter:1499,growth:3499,business:7999,pro:7999};
const canonicalPlan=(plan:string)=>plan==="pro"?"business":plan;
const ENTERPRISE_CAPABILITY_PREFIXES=["organization.","inventory.","reservations.","finance.","growth.","integrations."];
const enterpriseAccess=(plan:string)=>canonicalPlan(plan)==="enterprise";
const businessAccess=(plan:string)=>["business","enterprise"].includes(canonicalPlan(plan));
const planFeatures=(plan:string)=>({enterprise:enterpriseAccess(plan),multiLocation:enterpriseAccess(plan),inventory:businessAccess(plan),reservations:businessAccess(plan),finance:businessAccess(plan),growth:businessAccess(plan),developerPlatform:businessAccess(plan)});
function dayKey(date:Date){return date.toISOString().slice(0,10)}
function startOfDay(date:Date){const value=new Date(date);value.setHours(0,0,0,0);return value}
function endOfDay(date:Date){const value=new Date(date);value.setHours(23,59,59,999);return value}
async function planEntitlements(restaurantId:string){const restaurant=await prisma.restaurant.findUnique({where:{id:restaurantId},select:{plan:true,planStatus:true,trialEndsAt:true,featuresLocked:true,featureLockReason:true}});const plan=canonicalPlan(restaurant?.plan||"starter"),trialExpired=restaurant?.planStatus==="trialing"&&!!restaurant?.trialEndsAt&&restaurant.trialEndsAt<=new Date();const limits=PLAN_LIMITS[plan]||PLAN_LIMITS.starter;return {plan,accessLevel:enterpriseAccess(plan)?"enterprise":"standard",features:planFeatures(plan),planStatus:restaurant?.planStatus||"trialing",trialEndsAt:restaurant?.trialEndsAt||null,featuresLocked:Boolean(restaurant?.featuresLocked||trialExpired),featureLockReason:restaurant?.featureLockReason||null,limits};}
async function enforcePlanCapacity(restaurantId:string,resource:"tables"|"staff"|"menuItems"){const entitlements=await planEntitlements(restaurantId);const count=resource==="tables"?await prisma.table.count({where:{restaurantId,deletedAt:null}}):resource==="staff"?await prisma.staffUser.count({where:{restaurantId,role:{not:"OWNER"}}}):await prisma.menuItem.count({where:{restaurantId,deletedAt:null}});return count<entitlements.limits[resource]?null:{message:`${resource} limit reached for the ${entitlements.plan} plan`,code:"PLAN_LIMIT_REACHED",entitlements};}
function razorpayBillingConfig(){const keyId=process.env.RAZORPAY_KEY_ID,keySecret=process.env.RAZORPAY_KEY_SECRET;return keyId&&keySecret?{keyId,keySecret}:null}
function razorpayPlanId(plan:string){const canonical=canonicalPlan(plan);return canonical==="starter"?process.env.RAZORPAY_PLAN_STARTER_ID:canonical==="growth"?process.env.RAZORPAY_PLAN_GROWTH_ID:process.env.RAZORPAY_PLAN_BUSINESS_ID||process.env.RAZORPAY_PLAN_PRO_ID}
async function razorpayBillingRequest(path:string,init:RequestInit={}){const config=razorpayBillingConfig();if(!config)return null;const response=await razorpayRequest(path,config.keyId,config.keySecret,init),data=await response.json().catch(()=>({})) as Record<string,unknown>;if(!response.ok){const description=typeof data.error==="object"&&data.error&&"description" in data.error?String((data.error as {description?:unknown}).description||""):"";throw new Error(description||`Razorpay billing request failed (${response.status})`)}return data}
async function createRazorpaySubscription(plan:string,restaurantId:string,startAt?:Date|null){const canonical=canonicalPlan(plan),planId=razorpayPlanId(canonical);if(!razorpayBillingConfig())return null;if(!planId)throw new Error(`Razorpay plan ID is missing for ${canonical}`);const body=buildRazorpaySubscriptionRequest({planId,restaurantId,plan:canonical,startAt});return await razorpayBillingRequest("/subscriptions",{method:"POST",body:JSON.stringify(body)}) as {id:string;short_url?:string;status?:string;current_start?:number;current_end?:number}}
async function fetchRazorpaySubscription(id:string){return await razorpayBillingRequest(`/subscriptions/${encodeURIComponent(id)}`) as null|{id:string;short_url?:string;status?:string;remaining_count?:number;current_start?:number;current_end?:number}}
async function cancelRazorpaySubscription(id:string,cancelAtCycleEnd:boolean){return await razorpayBillingRequest(`/subscriptions/${encodeURIComponent(id)}/cancel`,{method:"POST",body:JSON.stringify({cancel_at_cycle_end:cancelAtCycleEnd})})}
async function updateRazorpaySubscription(id:string,plan:string){const planId=razorpayPlanId(plan);if(!planId)throw new Error(`Razorpay plan ID is missing for ${canonicalPlan(plan)}`);const current=await fetchRazorpaySubscription(id);if(!current)throw new Error("Razorpay billing is not configured");if(current.status==="active"||current.status==="authenticated"){const remainingCount=Math.max(1,Number(current.remaining_count||12));return{mode:"updated" as const,subscription:await razorpayBillingRequest(`/subscriptions/${encodeURIComponent(id)}`,{method:"PATCH",body:JSON.stringify({plan_id:planId,quantity:1,remaining_count:remainingCount,schedule_change_at:"now",customer_notify:true})})}}
await cancelRazorpaySubscription(id,false);return{mode:"replaced" as const,subscription:null}}
async function razorpayRequest(path:string,keyId:string,keySecret:string,init:RequestInit={}){return fetch(`https://api.razorpay.com/v1${path}`,{...init,headers:{Authorization:`Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,"Content-Type":"application/json",...(init.headers||{})}})}
async function finalizeReconciledOrder(orderId:string,result:{status:string;kind:string}|null,previous:{paymentStatus:string;refundStatus?:string|null}){
  if(!result||result.status!=="MATCHED")return;
  const row=await prisma.order.findUnique({where:{id:orderId},include:{items:true,paymentMethod:true}});if(!row)return;
  if(result.kind==="PAYMENT"&&row.paymentStatus==="PAID"){
    await ensureKitchenTickets(prisma,row.id);await issueTaxInvoice(prisma,row.id);
  }else if(result.kind==="REFUND"&&row.paymentStatus==="REFUNDED"){
    await issueCreditNote(prisma,row.id,row.refundId||undefined,"Razorpay refund reconciled");
  }
  const order=toOrder(row);io.to(`restaurant:${row.restaurantId}`).emit("order:updated",order);io.to(`table:${row.tableId}`).emit("order:updated",order);
  if(result.kind==="PAYMENT"&&previous.paymentStatus!=="PAID"&&row.paymentStatus==="PAID")void sendRestaurantPush(prisma,row.restaurantId,{kind:"payment-confirmed",title:"Payment confirmed",body:`${order.tableLabel} · Payment for ${order.id} is confirmed.`,tag:`payment-confirmed-${order.id}`});
}
function secureSignatureEqual(received:string,expected:string){const left=Buffer.from(received),right=Buffer.from(expected);return left.length===right.length&&timingSafeEqual(left,right)}
function paymentApiOrigin(req:Request){return process.env.API_ORIGIN||`${req.protocol}://${req.get("host")}`}
async function buildMasterTrends(days:number){const safeDays=Math.max(7,Math.min(30,days||14));const today=startOfDay(new Date()),rangeStart=new Date(today);rangeStart.setDate(rangeStart.getDate()-(safeDays-1));const [orders,restaurants]=await Promise.all([prisma.order.findMany({where:{createdAt:{gte:rangeStart}},select:{createdAt:true,totalAmount:true,paymentStatus:true,status:true}}),prisma.restaurant.findMany({select:{createdAt:true,isActive:true}})]);const buckets=new Map<string,{date:string;orders:number;revenue:number;activeRestaurants:number;failures:number}>();for(let index=0;index<safeDays;index+=1){const day=new Date(rangeStart);day.setDate(day.getDate()+index);buckets.set(dayKey(day),{date:dayKey(day),orders:0,revenue:0,activeRestaurants:0,failures:0})}for(const row of orders){const bucket=buckets.get(dayKey(row.createdAt));if(!bucket)continue;bucket.orders+=1;if(row.paymentStatus==="PAID"||row.paymentStatus==="PAY_AT_COUNTER")bucket.revenue+=row.totalAmount;if(row.status==="CANCELLED"||row.paymentStatus==="REPORTED")bucket.failures+=1}for(const [key,bucket] of buckets){const day=new Date(`${key}T23:59:59.999Z`);bucket.activeRestaurants=restaurants.filter(restaurant=>restaurant.isActive&&restaurant.createdAt<=day).length}return Array.from(buckets.values())}
async function buildMasterSupportQueue(){const now=new Date(),trialCutoff=new Date(now.getTime()+3*86400000);const [openRequests,featureLocks,trialExpiringSoon,pastDue,contactInquiries]=await Promise.all([prisma.serviceRequest.findMany({where:{status:{in:["OPEN","ACKNOWLEDGED"]}},orderBy:{createdAt:"asc"},take:100,include:{restaurant:{select:{id:true,name:true,slug:true,plan:true,planStatus:true,featuresLocked:true,featureLockReason:true}},table:{select:{label:true,code:true}}}}),prisma.restaurant.findMany({where:{featuresLocked:true},orderBy:{updatedAt:"desc"},take:50,select:{id:true,name:true,slug:true,plan:true,planStatus:true,featureLockReason:true,trialEndsAt:true,updatedAt:true}}),prisma.restaurant.findMany({where:{planStatus:"trialing",trialEndsAt:{gt:now,lte:trialCutoff}},orderBy:{trialEndsAt:"asc"},take:50,select:{id:true,name:true,slug:true,plan:true,planStatus:true,trialEndsAt:true}}),prisma.subscription.findMany({where:{status:"PAST_DUE"},orderBy:{updatedAt:"desc"},take:50,select:{id:true,restaurantId:true,plan:true,status:true,currentPeriodEnd:true,cancelAtPeriodEnd:true,retryCount:true,lastPaymentError:true,nextRetryAt:true,restaurant:{select:{id:true,name:true,slug:true,isActive:true,featuresLocked:true}}}}),prisma.contactInquiry.findMany({where:{status:{in:["OPEN","ACKNOWLEDGED"]}},orderBy:{createdAt:"asc"},take:100})]);return {openRequests:openRequests.map(request=>({id:request.id,type:request.type,status:request.status,createdAt:request.createdAt.toISOString(),note:request.note||null,restaurant:request.restaurant,table:request.table})),contactInquiries:contactInquiries.map(inquiry=>({...inquiry,createdAt:inquiry.createdAt.toISOString(),updatedAt:inquiry.updatedAt.toISOString(),resolvedAt:inquiry.resolvedAt?.toISOString()||null})),featureLocks:featureLocks.map(restaurant=>({id:restaurant.id,name:restaurant.name,slug:restaurant.slug,plan:canonicalPlan(restaurant.plan),planStatus:restaurant.planStatus,featureLockReason:restaurant.featureLockReason||null,trialEndsAt:restaurant.trialEndsAt?.toISOString()||null,updatedAt:restaurant.updatedAt.toISOString()})),trialExpiringSoon:trialExpiringSoon.map(restaurant=>({id:restaurant.id,name:restaurant.name,slug:restaurant.slug,plan:canonicalPlan(restaurant.plan),planStatus:restaurant.planStatus,trialEndsAt:restaurant.trialEndsAt?.toISOString()||null})),pastDue:pastDue.map(subscription=>({id:subscription.id,restaurantId:subscription.restaurantId,restaurant:subscription.restaurant,plan:canonicalPlan(subscription.plan),status:subscription.status.toLowerCase(),currentPeriodEnd:subscription.currentPeriodEnd.toISOString(),cancelAtPeriodEnd:subscription.cancelAtPeriodEnd,retryCount:subscription.retryCount,lastPaymentError:subscription.lastPaymentError||null,nextRetryAt:subscription.nextRetryAt?.toISOString()||null}))}}
async function buildMasterRestaurantActivity(restaurantId:string){const [orders,staff,payments,subscription,requests,audits]=await Promise.all([prisma.order.findMany({where:{restaurantId},include:{items:true,paymentMethod:true},orderBy:{createdAt:"desc"},take:20}),prisma.staffUser.findMany({where:{restaurantId},select:{id:true,name:true,phone:true,firebaseUid:true,role:true,isActive:true,lastLoginAt:true},orderBy:{createdAt:"desc"}}),prisma.paymentMethod.findMany({where:{restaurantId},select:{id:true,provider:true,displayName:true,isActive:true,upiId:true,phone:true},orderBy:{createdAt:"desc"}}),prisma.subscription.findUnique({where:{restaurantId},select:{id:true,provider:true,providerSubscriptionId:true,plan:true,status:true,currentPeriodStart:true,currentPeriodEnd:true,createdAt:true,cancelAtPeriodEnd:true,retryCount:true,lastPaymentError:true,nextRetryAt:true,invoices:{select:{status:true,paidAt:true,createdAt:true},orderBy:{createdAt:"desc"},take:1}}}),prisma.serviceRequest.findMany({where:{restaurantId},select:{id:true,type:true,status:true,note:true,createdAt:true},orderBy:{createdAt:"desc"},take:20}),prisma.platformAuditLog.findMany({where:{restaurantId},select:{id:true,action:true,createdAt:true,admin:{select:{name:true,phone:true}}},orderBy:{createdAt:"desc"},take:12})]);return {orders:orders.map(order=>({id:order.displayId,status:order.status.toLowerCase(),tableLabel:order.tableLabel,totalAmount:order.totalAmount,paymentStatus:order.paymentStatus.toLowerCase(),paymentReference:order.paymentReference||null,estimatedReadyAt:order.estimatedReadyAt?.toISOString()||null,createdAt:order.createdAt.toISOString(),paymentMethod:order.paymentMethod?{id:order.paymentMethod.id,provider:order.paymentMethod.provider,displayName:order.paymentMethod.displayName}:null,items:order.items.map(item=>({id:item.id,name:item.name,quantity:item.quantity,unitPrice:item.unitPrice,notes:item.notes||null}))})),staff:staff.map(member=>({id:member.id,name:member.name,phone:member.phone||null,firebaseUid:member.firebaseUid||null,role:member.role,isActive:member.isActive,lastLoginAt:member.lastLoginAt?.toISOString()||null})),payments:payments.map(method=>({id:method.id,provider:method.provider,displayName:method.displayName,isActive:method.isActive,upiId:method.upiId||null,phone:method.phone||null})),subscription:subscription?{id:subscription.id,provider:subscription.provider,providerSubscriptionId:subscription.providerSubscriptionId||null,plan:canonicalPlan(subscription.plan),status:subscription.status.toLowerCase(),currentPeriodStart:subscription.currentPeriodStart.toISOString(),currentPeriodEnd:subscription.currentPeriodEnd.toISOString(),createdAt:subscription.createdAt.toISOString(),cancelAtPeriodEnd:subscription.cancelAtPeriodEnd,retryCount:subscription.retryCount,lastPaymentError:subscription.lastPaymentError||null,nextRetryAt:subscription.nextRetryAt?.toISOString()||null,latestInvoice:subscription.invoices[0]?{status:subscription.invoices[0].status,paidAt:subscription.invoices[0].paidAt?.toISOString()||null,createdAt:subscription.invoices[0].createdAt.toISOString()}:null}:null,requests:requests.map(request=>({id:request.id,type:request.type,status:request.status,createdAt:request.createdAt.toISOString(),note:request.note||null})),audits:audits.map(entry=>({id:entry.id,action:entry.action,createdAt:entry.createdAt.toISOString(),admin:entry.admin}))}}
async function buildMasterSupportQueueWithTickets(){const[queue,tickets]=await Promise.all([buildMasterSupportQueue(),prisma.restaurantSupportTicket.findMany({where:{status:{in:["OPEN","ACKNOWLEDGED"]}},orderBy:{createdAt:"asc"},take:100,include:{restaurant:{select:{id:true,name:true,slug:true}}}})]);return{...queue,restaurantTickets:tickets.map(ticket=>({...ticket,createdAt:ticket.createdAt.toISOString(),updatedAt:ticket.updatedAt.toISOString(),resolvedAt:ticket.resolvedAt?.toISOString()||null}))}}
const staffInput=z.object({name:z.string().trim().min(2).max(80),phone:phoneNumberInput,role:z.enum(["MANAGER","SUPERVISOR","CASHIER","WAITER","KITCHEN"])});
const statusMap: Record<OrderStatus,DbOrderStatus> = {new:"NEW",accepted:"ACCEPTED",preparing:"PREPARING",ready:"READY",served:"SERVED",cancelled:"CANCELLED"};
registerBillingHardening(app,prisma,authenticate,authorize,authenticateMaster,emitRestaurantSync);
app.use([
  "/api/organization",
  "/api/admin/inventory",
  "/api/admin/procurement",
  "/api/admin/reservations",
  "/api/admin/waitlist",
  "/api/admin/fiscal",
  "/api/admin/settlements",
  "/api/admin/accounting",
  "/api/admin/growth",
  "/api/admin/integrations",
],authenticate,requireEnterpriseAccess);
app.put("/api/admin/menu/items/:id/recipe",authenticate,requireEnterpriseAccess,(_req,_res,next)=>next());

registerOperationsPlatform(app,prisma,authenticate,authorizeCapability,emitRestaurantSync,async(orderId,notifyReady)=>{
  const row=await prisma.order.findUnique({where:{id:orderId},include:{items:true,paymentMethod:true}});
  if(!row)return;
  const order=toOrder(row);
  io.to(`restaurant:${order.restaurantId}`).emit("order:updated",order);
  io.to(`table:${order.tableId}`).emit("order:updated",order);
  if(notifyReady)void sendRestaurantPush(prisma,order.restaurantId,{kind:"order-ready",title:"Order ready",body:`${order.tableLabel} · ${order.id} is ready to serve.`,tag:`order-ready-${order.id}`});
});
registerGrowthPlatform(app,prisma,authenticate,authorizeCapability,PAYMENT_CREDENTIALS_SECRET);

app.get("/api/health", async (_req,res)=>{ try {
  await prisma.$queryRaw`SELECT 1`;if(redisClient&&!redisClient.isReady)throw new Error("Redis unavailable");await qrStorage.ensureReady();
  const[pendingOutbox,failedOutbox,pendingReconciliation,mismatchedReconciliation]=await Promise.all([
    prisma.domainEventOutbox.count({where:{status:"PENDING"}}),
    prisma.domainEventOutbox.count({where:{status:"FAILED"}}),
    prisma.paymentReconciliation.count({where:{status:"PENDING"}}),
    prisma.paymentReconciliation.count({where:{status:"MISMATCH"}}),
  ]);
  res.json({status:mismatchedReconciliation?"degraded":"ok",service:"Restaurant Platform API",database:"connected",redis:redisClient?"connected":"disabled",storage:"available",outbox:{pending:pendingOutbox,failed:failedOutbox},paymentReconciliation:{pending:pendingReconciliation,mismatched:mismatchedReconciliation}});
} catch(error){res.status(503).json({status:"degraded",service:"Restaurant Platform API",message:error instanceof Error?error.message:"dependency unavailable"}); } });
app.get("/api/metrics",async(_req,res)=>{
  const[pendingOutbox,processingOutbox,failedOutbox,reconciliationGroups]=await Promise.all([
    prisma.domainEventOutbox.count({where:{status:"PENDING"}}),
    prisma.domainEventOutbox.count({where:{status:"PROCESSING"}}),
    prisma.domainEventOutbox.count({where:{status:"FAILED"}}),
    prisma.paymentReconciliation.groupBy({by:["status"],_count:{_all:true}}),
  ]);
  res.type("text/plain; version=0.0.4");
  const lines=["# HELP white_label_http_requests_total Total HTTP responses","# TYPE white_label_http_requests_total counter"];
  for(const[key,value]of requestCounts){const[route,status]=key.split("|");lines.push(`white_label_http_requests_total{route=${JSON.stringify(route)},status=${JSON.stringify(status)}} ${value}`)}
  lines.push("# HELP white_label_outbox_events Number of durable domain events by state","# TYPE white_label_outbox_events gauge",`white_label_outbox_events{status="pending"} ${pendingOutbox}`,`white_label_outbox_events{status="processing"} ${processingOutbox}`,`white_label_outbox_events{status="failed"} ${failedOutbox}`,"# HELP white_label_payment_reconciliations Number of financial reconciliations by state","# TYPE white_label_payment_reconciliations gauge");
  for(const group of reconciliationGroups)lines.push(`white_label_payment_reconciliations{status="${group.status.toLowerCase()}"} ${group._count._all}`);
  res.send(`${lines.join("\n")}\n`);
});
app.post("/api/auth/firebase/login",async(req:Request,res:Response)=>{
  if(!isFirebaseAuthConfigured())return res.status(503).json({message:"Firebase phone auth is not configured yet"});
  const parsed=firebaseLoginInput.safeParse(req.body);if(!parsed.success)return res.status(400).json({message:"Provide a valid Firebase ID token"});
  let decoded;try{decoded=await verifyFirebaseIdToken(parsed.data.idToken)}catch{return res.status(401).json({message:"That phone verification expired or was invalid",code:"FIREBASE_AUTH_FAILED"})}
  const phone=getFirebasePhoneNumber(decoded);if(!phone)return res.status(400).json({message:"Firebase did not return a verified phone number"});
  const staff=await prisma.staffUser.findUnique({where:{phone},include:{restaurant:true}});
  if(!staff||!staff.isActive)return res.status(404).json({message:"No restaurant account is linked to this phone number",code:"PHONE_ACCOUNT_NOT_FOUND"});
  if(staff.firebaseUid&&staff.firebaseUid!==decoded.uid)return res.status(409).json({message:"This phone is linked to a different Firebase identity. Ask the owner to contact support.",code:"FIREBASE_IDENTITY_CONFLICT"});
  const updated=staff.firebaseUid===decoded.uid?staff:await prisma.staffUser.update({where:{id:staff.id},data:{firebaseUid:decoded.uid},include:{restaurant:true}});
  const expiresAt=new Date(Date.now()+12*60*60*1000),session=await prisma.staffSession.create({data:{staffUserId:updated.id,expiresAt,userAgent:req.get("user-agent")?.slice(0,300),ipAddress:req.ip}});
  await prisma.staffUser.update({where:{id:updated.id},data:{lastLoginAt:new Date()}});
  const token=jwt.sign({id:updated.id,restaurantId:updated.restaurantId,role:updated.role,sessionId:session.id},JWT_SECRET,{expiresIn:"12h",issuer:"white-label-restaurant-platform"});
  return res.json({token,user:buildStaffAuthResponse(updated)});
});
app.post("/api/auth/firebase/signup",async(req:Request,res:Response)=>{
  if(!isFirebaseAuthConfigured())return res.status(503).json({message:"Firebase phone auth is not configured yet"});
  const parsed=firebaseSignupInput.safeParse(req.body);
  if(!parsed.success)return res.status(400).json({message:"Accept the recurring mandate terms and provide the verified phone, restaurant, owner, and plan"});
  let decoded;
  try{decoded=await verifyFirebaseIdToken(parsed.data.idToken)}catch{return res.status(401).json({message:"That phone verification expired or was invalid",code:"FIREBASE_AUTH_FAILED"})}
  const phone=getFirebasePhoneNumber(decoded);
  if(!phone)return res.status(400).json({message:"Firebase did not return a verified phone number"});
  const existing=await prisma.staffUser.findFirst({where:{OR:[{firebaseUid:decoded.uid},{phone}]},select:{id:true}});
  if(existing)return res.status(409).json({message:"An account is already linked to this phone number"});
  const base=parsed.data.restaurantName.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")||"restaurant";
  let slug=base;
  for(let i=2;await prisma.restaurant.findUnique({where:{slug}});i++)slug=`${base}-${i}`;
  const selectedPlan=canonicalPlan(parsed.data.plan),now=new Date(),trialEndsAt=new Date(now.getTime()+14*86400000);
  const restaurant=await prisma.restaurant.create({
    data:{
      name:parsed.data.restaurantName,slug,locationCode:"HQ",trialEndsAt,plan:selectedPlan,planStatus:"trialing",
      organization:{create:{name:parsed.data.restaurantName,slug}},
      staff:{create:{name:parsed.data.ownerName,phone,firebaseUid:decoded.uid,role:"OWNER"}},
      tables:{create:{label:"Table 01",code:"T1"}},
      categories:{create:{name:"Popular",sortOrder:1}},
      subscription:{create:{provider:"internal",plan:selectedPlan,status:"TRIALING",currentPeriodStart:now,currentPeriodEnd:trialEndsAt}}
    },
    include:{staff:true}
  });
  let checkoutUrl:string|null=null,mandateSetupRequired=true;
  try{
    const providerSubscription=await createRazorpaySubscription(selectedPlan,restaurant.id,trialEndsAt);
    if(providerSubscription){
      checkoutUrl=providerSubscription.short_url||null;
      mandateSetupRequired=!checkoutUrl;
      await prisma.subscription.update({
        where:{restaurantId:restaurant.id},
        data:{provider:"razorpay",providerSubscriptionId:providerSubscription.id,status:"TRIALING"}
      });
    }
  }catch(error){
    console.error("Could not create trial mandate subscription",error);
  }
  const owner=restaurant.staff[0];
  await prisma.organizationMembership.create({data:{organizationId:restaurant.organizationId,staffUserId:owner.id,role:"OWNER"}});
  const session=await prisma.staffSession.create({data:{staffUserId:owner.id,expiresAt:new Date(Date.now()+12*60*60*1000),userAgent:req.get("user-agent")?.slice(0,300),ipAddress:req.ip}});
  const token=jwt.sign({id:owner.id,restaurantId:restaurant.id,role:owner.role,sessionId:session.id},JWT_SECRET,{expiresIn:"12h",issuer:"white-label-restaurant-platform"});
  return res.status(201).json({
    token,checkoutUrl,mandateSetupRequired,razorpayKeyId:checkoutUrl?razorpayBillingConfig()?.keyId||null:null,
    providerSubscriptionId:(await prisma.subscription.findUnique({where:{restaurantId:restaurant.id},select:{providerSubscriptionId:true}}))?.providerSubscriptionId||null,
    user:{...buildStaffAuthResponse({name:owner.name,phone:owner.phone,role:owner.role,restaurant:{id:restaurant.id,name:restaurant.name,slug:restaurant.slug,plan:restaurant.plan,trialEndsAt}}),trial:{days:14,endsAt:trialEndsAt}}
  });
});
app.post("/api/master/auth/login",masterAuthLimiter,async(req:Request,res:Response)=>{if(!isFirebaseAuthConfigured())return res.status(503).json({message:"Firebase phone auth is not configured yet"});const parsed=masterLoginInput.safeParse(req.body);if(!parsed.success)return res.status(400).json({message:"Provide a valid Firebase ID token"});let decoded;try{decoded=await verifyFirebaseIdToken(parsed.data.idToken)}catch{return res.status(401).json({message:"That phone verification expired or was invalid",code:"FIREBASE_AUTH_FAILED"})}const phone=getFirebasePhoneNumber(decoded);if(!phone)return res.status(400).json({message:"Firebase did not return a verified phone number"});let admin=await prisma.platformAdmin.findFirst({where:{phone}});if(!admin||!admin.isActive)return res.status(404).json({message:"No master operator account is linked to this phone number",code:"MASTER_ACCOUNT_NOT_FOUND"});if(admin.phone!==phone){admin=await prisma.platformAdmin.update({where:{id:admin.id},data:{phone}});}const expiresAt=new Date(Date.now()+8*60*60*1000),session=await prisma.platformAdminSession.create({data:{adminId:admin.id,expiresAt,userAgent:req.get("user-agent")?.slice(0,300),ipAddress:req.ip}});await prisma.platformAdmin.update({where:{id:admin.id},data:{lastLoginAt:new Date()}});const token=jwt.sign({id:admin.id,sessionId:session.id,phone:admin.phone||phone,name:admin.name},JWT_SECRET,{expiresIn:"8h",issuer:"white_label-master"});res.json({token,admin:{id:admin.id,phone:admin.phone||phone,name:admin.name}});});
app.get("/api/master/auth/me",authenticateMaster,async(req:MasterAuthRequest,res:Response)=>{res.json(req.masterAdmin);});
app.post("/api/master/auth/logout",authenticateMaster,async(req:MasterAuthRequest,res:Response)=>{await prisma.platformAdminSession.update({where:{id:req.masterAdmin!.sessionId},data:{revokedAt:new Date()}});res.status(204).end();});
app.get("/api/auth/me",authenticate,async(req:AuthRequest,res:Response)=>{
  const context=await organizationContext(req.staff!.id,req.staff!.restaurantId);
  if(!context)return res.status(404).json({message:"Account or location not found"});
  const capabilities=capabilitiesForRole(context.effectiveRole).filter(capability=>enterpriseAccess(context.location.plan)||!ENTERPRISE_CAPABILITY_PREFIXES.some(prefix=>capability.startsWith(prefix)));
  res.json({
    name:context.staff.name,phone:context.staff.phone||null,role:context.effectiveRole.toLowerCase(),capabilities,
    restaurant:{id:context.location.id,name:context.location.name,slug:context.location.slug,locationCode:context.location.locationCode,timezone:context.location.timezone,plan:context.location.plan,trialEndsAt:context.location.trialEndsAt?.toISOString()||null},
    organization:context.organization?{id:context.organization.id,name:context.organization.name,slug:context.organization.slug,role:context.membership?.role.toLowerCase(),locations:enterpriseAccess(context.location.plan)?context.organization.locations:context.organization.locations.filter(location=>location.id===context.location.id)}:null,
  });
});
app.post("/api/auth/switch-location",authenticate,async(req:AuthRequest,res:Response)=>{
  const parsed=z.object({restaurantId:z.string().min(1)}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({message:"Choose a valid location"});
  const currentLocation=await prisma.restaurant.findUnique({where:{id:req.staff!.restaurantId},select:{plan:true}});
  if(!currentLocation||!enterpriseAccess(currentLocation.plan))return res.status(403).json({message:"Multi-location switching requires the Restaurant Platform Enterprise plan.",code:"ENTERPRISE_REQUIRED"});
  const context=await organizationContext(req.staff!.id,parsed.data.restaurantId);
  if(!context)return res.status(403).json({message:"You do not have access to that location",code:"LOCATION_ACCESS_DENIED"});
  const token=jwt.sign({id:req.staff!.id,restaurantId:context.location.id,role:context.effectiveRole,sessionId:req.staff!.sessionId},JWT_SECRET,{expiresIn:"12h",issuer:"white-label-restaurant-platform"});
  await appendAuditEvent(prisma,{restaurantId:context.location.id,actor:{type:AuditActorType.STAFF,id:req.staff!.id,role:context.effectiveRole},action:"auth.location_switched",resourceType:"restaurant",resourceId:context.location.id,metadata:{fromRestaurantId:req.staff!.restaurantId}});
  res.json({token,restaurant:{id:context.location.id,name:context.location.name,slug:context.location.slug,locationCode:context.location.locationCode,timezone:context.location.timezone},role:context.effectiveRole.toLowerCase(),capabilities:capabilitiesForRole(context.effectiveRole).filter(capability=>enterpriseAccess(context.location.plan)||!ENTERPRISE_CAPABILITY_PREFIXES.some(prefix=>capability.startsWith(prefix)))});
});
app.get("/api/organization",authenticate,authorizeCapability("organization.read"),async(req:AuthRequest,res:Response)=>{
  const context=await organizationContext(req.staff!.id,req.staff!.restaurantId);
  if(!context?.organization)return res.status(404).json({message:"Organization not found"});
  const memberships=await prisma.organizationMembership.findMany({where:{organizationId:context.organization.id,isActive:true},select:{id:true,role:true,createdAt:true,staffUser:{select:{id:true,name:true,phone:true,isActive:true,restaurant:{select:{id:true,name:true,locationCode:true}}}}},orderBy:{createdAt:"asc"}});
  res.json({...context.organization,role:context.membership?.role.toLowerCase(),memberships});
});
app.put("/api/organization/members/:staffId",authenticate,authorizeCapability("organization.manage"),async(req:AuthRequest,res:Response)=>{
  const parsed=z.object({role:z.enum(["ADMIN","ANALYST","MEMBER"]),isActive:z.boolean().default(true)}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({message:"Choose a valid organization role"});
  const context=await organizationContext(req.staff!.id,req.staff!.restaurantId);
  if(!context?.organization||context.membership?.role!=="OWNER")return res.status(403).json({message:"Organization owner access is required"});
  const staff=await prisma.staffUser.findUnique({where:{id:String(req.params.staffId)},select:{id:true,restaurant:{select:{organizationId:true}}}});
  if(!staff||staff.restaurant.organizationId!==context.organization.id)return res.status(404).json({message:"Staff member not found in this organization"});
  const membership=await prisma.organizationMembership.upsert({where:{organizationId_staffUserId:{organizationId:context.organization.id,staffUserId:staff.id}},create:{organizationId:context.organization.id,staffUserId:staff.id,role:parsed.data.role,isActive:parsed.data.isActive},update:{role:parsed.data.role,isActive:parsed.data.isActive}});
  await prisma.staffSession.updateMany({where:{staffUserId:staff.id,revokedAt:null},data:{revokedAt:new Date()}});
  await appendAuditEvent(prisma,{restaurantId:req.staff!.restaurantId,actor:{type:AuditActorType.STAFF,id:req.staff!.id,role:req.staff!.role},action:"organization.membership_updated",resourceType:"organization-membership",resourceId:membership.id,metadata:{staffUserId:staff.id,role:membership.role,isActive:membership.isActive}});
  res.json(membership);
});
app.post("/api/organization/locations",authenticate,authorizeCapability("organization.manage"),async(req:AuthRequest,res:Response)=>{
  const parsed=z.object({name:z.string().trim().min(2).max(120),locationCode:z.string().trim().regex(/^[A-Za-z0-9_-]{2,16}$/),timezone:z.string().trim().min(3).max(80).default("Asia/Kolkata")}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({message:"Enter a valid location name, code, and timezone"});
  const context=await organizationContext(req.staff!.id,req.staff!.restaurantId);
  if(!context?.organization||!context.membership||!["OWNER","ADMIN"].includes(context.membership.role))return res.status(403).json({message:"Organization owner or admin access is required"});
  const locationLimit=(PLAN_LIMITS[canonicalPlan(context.location.plan)]||PLAN_LIMITS.starter).locations;
  const locationCount=await prisma.restaurant.count({where:{organizationId:context.organization.id}});
  if(locationCount>=locationLimit)return res.status(402).json({message:`The ${canonicalPlan(context.location.plan)} plan supports ${locationLimit} location${locationLimit===1?"":"s"}`,code:"PLAN_LIMIT_REACHED"});
  const base=parsed.data.name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")||"location";
  let slug=base;for(let suffix=2;await prisma.restaurant.findUnique({where:{slug}});suffix++)slug=`${base}-${suffix}`;
  try{
    const location=await prisma.restaurant.create({data:{organizationId:context.organization.id,name:parsed.data.name,slug,locationCode:parsed.data.locationCode.toUpperCase(),timezone:parsed.data.timezone,plan:context.location.plan,planStatus:context.location.planStatus,trialEndsAt:context.location.trialEndsAt,featuresLocked:context.location.featuresLocked,featureLockReason:context.location.featureLockReason,taxPercent:0,serviceChargePercent:0,tables:{create:{label:"Table 01",code:"T1"}},categories:{create:{name:"Popular",sortOrder:1}}}});
    await appendAuditEvent(prisma,{restaurantId:location.id,actor:{type:AuditActorType.STAFF,id:req.staff!.id,role:req.staff!.role},action:"organization.location_created",resourceType:"restaurant",resourceId:location.id,metadata:{organizationId:context.organization.id,locationCode:location.locationCode}});
    res.status(201).json(location);
  }catch(error){if((error as {code?:string}).code==="P2002")return res.status(409).json({message:"That location code is already used in this organization"});throw error}
});
app.get("/api/organization/analytics",authenticate,authorizeCapability("analytics.read"),async(req:AuthRequest,res:Response)=>{
  const context=await organizationContext(req.staff!.id,req.staff!.restaurantId);
  if(!context?.organization)return res.status(404).json({message:"Organization not found"});
  const parsed=z.object({from:z.coerce.date().optional(),to:z.coerce.date().optional()}).safeParse(req.query);
  if(!parsed.success)return res.status(400).json({message:"Invalid date range"});
  const from=parsed.data.from||new Date(Date.now()-30*86400000),to=parsed.data.to||new Date();
  if(from>to||to.getTime()-from.getTime()>366*86400000)return res.status(400).json({message:"Choose a range up to 366 days"});
  const locations=await prisma.restaurant.findMany({where:{organizationId:context.organization.id,isActive:true},select:{id:true,name:true,locationCode:true}});
  const orders=await prisma.order.findMany({where:{restaurantId:{in:locations.map(item=>item.id)},createdAt:{gte:from,lte:to},status:{not:"CANCELLED"}},select:{restaurantId:true,totalAmount:true,paymentStatus:true,status:true}});
  const byLocation=locations.map(location=>{const rows=orders.filter(order=>order.restaurantId===location.id),paid=rows.filter(order=>["PAID","PAY_AT_COUNTER"].includes(order.paymentStatus));return{...location,orders:rows.length,paidOrders:paid.length,revenue:paid.reduce((sum,order)=>sum+order.totalAmount,0),openOrders:rows.filter(order=>!["SERVED","CANCELLED"].includes(order.status)).length}});
  res.json({from:from.toISOString(),to:to.toISOString(),orders:orders.length,revenue:byLocation.reduce((sum,item)=>sum+item.revenue,0),locations:byLocation});
});
app.get("/api/organization/menu-templates",authenticate,authorizeCapability("organization.read"),async(req:AuthRequest,res:Response)=>{
  const context=await organizationContext(req.staff!.id,req.staff!.restaurantId);
  if(!context?.organization)return res.status(404).json({message:"Organization not found"});
  res.json(await prisma.organizationMenuTemplate.findMany({where:{organizationId:context.organization.id,isActive:true},select:{id:true,name:true,version:true,createdBy:true,createdAt:true,updatedAt:true},orderBy:[{name:"asc"},{version:"desc"}]}));
});
app.post("/api/organization/menu-templates/from-current",authenticate,authorizeCapability("organization.manage"),async(req:AuthRequest,res:Response)=>{
  const parsed=z.object({name:z.string().trim().min(2).max(100)}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({message:"Enter a template name"});
  const context=await organizationContext(req.staff!.id,req.staff!.restaurantId);
  if(!context?.organization)return res.status(404).json({message:"Organization not found"});
  const categories=await prisma.menuCategory.findMany({where:{restaurantId:req.staff!.restaurantId},orderBy:{sortOrder:"asc"},include:{items:{where:{deletedAt:null},orderBy:{name:"asc"},include:{options:{where:{isAvailable:true},orderBy:{name:"asc"}}}}}});
  const latest=await prisma.organizationMenuTemplate.findFirst({where:{organizationId:context.organization.id,name:parsed.data.name},orderBy:{version:"desc"},select:{version:true}});
  const content={categories:categories.map(category=>({name:category.name,sortOrder:category.sortOrder,items:category.items.map(item=>({name:item.name,description:item.description,price:item.price,isAvailable:item.isAvailable,isVeg:item.isVeg,tags:item.tags,imageUrl:item.imageUrl,prepMinutes:item.prepMinutes,hsnCode:item.hsnCode,gstRate:item.gstRate==null?null:Number(item.gstRate),options:item.options.map(option=>({name:option.name,priceDelta:option.priceDelta,isAvailable:option.isAvailable}))}))}))};
  const template=await prisma.organizationMenuTemplate.create({data:{organizationId:context.organization.id,name:parsed.data.name,version:(latest?.version||0)+1,content,createdBy:req.staff!.id}});
  await appendAuditEvent(prisma,{restaurantId:req.staff!.restaurantId,actor:{type:AuditActorType.STAFF,id:req.staff!.id,role:req.staff!.role},action:"organization.menu_template_created",resourceType:"organization-menu-template",resourceId:template.id,metadata:{organizationId:context.organization.id,name:template.name,version:template.version}});
  res.status(201).json(template);
});
app.post("/api/organization/menu-templates/:id/apply",authenticate,authorizeCapability("organization.manage"),async(req:AuthRequest,res:Response)=>{
  const parsed=z.object({restaurantId:z.string().min(1)}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({message:"Choose a target location"});
  const context=await organizationContext(req.staff!.id,req.staff!.restaurantId);
  if(!context?.organization)return res.status(404).json({message:"Organization not found"});
  const [template,target]=await Promise.all([
    prisma.organizationMenuTemplate.findFirst({where:{id:String(req.params.id),organizationId:context.organization.id,isActive:true}}),
    prisma.restaurant.findFirst({where:{id:parsed.data.restaurantId,organizationId:context.organization.id,isActive:true}}),
  ]);
  if(!template||!target)return res.status(404).json({message:"Template or target location not found"});
  const content=z.object({categories:z.array(z.object({name:z.string(),sortOrder:z.number().int(),items:z.array(z.object({name:z.string(),description:z.string(),price:z.number().int().nonnegative(),isAvailable:z.boolean(),isVeg:z.boolean(),tags:z.array(z.string()),imageUrl:z.string(),prepMinutes:z.number().int().positive(),hsnCode:z.string().nullable().optional(),gstRate:z.number().nullable().optional(),options:z.array(z.object({name:z.string(),priceDelta:z.number().int(),isAvailable:z.boolean()}))}))}))}).safeParse(template.content);
  if(!content.success)return res.status(409).json({message:"This template version is invalid and cannot be deployed"});
  const deployed=await prisma.$transaction(async tx=>{
    let categoryCount=0,itemCount=0;
    for(const categoryInput of content.data.categories){
      let category=await tx.menuCategory.findFirst({where:{restaurantId:target.id,name:categoryInput.name}});
      category=category?await tx.menuCategory.update({where:{id:category.id},data:{sortOrder:categoryInput.sortOrder}}):await tx.menuCategory.create({data:{restaurantId:target.id,name:categoryInput.name,sortOrder:categoryInput.sortOrder}});
      categoryCount++;
      for(const itemInput of categoryInput.items){
        const existing=await tx.menuItem.findFirst({where:{restaurantId:target.id,categoryId:category.id,name:itemInput.name,deletedAt:null}});
        const itemData={description:itemInput.description,price:itemInput.price,isAvailable:itemInput.isAvailable,isVeg:itemInput.isVeg,tags:itemInput.tags,imageUrl:itemInput.imageUrl,prepMinutes:itemInput.prepMinutes,hsnCode:itemInput.hsnCode||null,gstRate:itemInput.gstRate};
        const item=existing?await tx.menuItem.update({where:{id:existing.id},data:itemData}):await tx.menuItem.create({data:{...itemData,restaurantId:target.id,categoryId:category.id,name:itemInput.name}});
        await tx.menuItemOption.deleteMany({where:{menuItemId:item.id}});
        if(itemInput.options.length)await tx.menuItemOption.createMany({data:itemInput.options.map(option=>({...option,menuItemId:item.id}))});
        itemCount++;
      }
    }
    return{categoryCount,itemCount};
  });
  await appendAuditEvent(prisma,{restaurantId:target.id,actor:{type:AuditActorType.STAFF,id:req.staff!.id,role:req.staff!.role},action:"organization.menu_template_deployed",resourceType:"organization-menu-template",resourceId:template.id,metadata:{organizationId:context.organization.id,targetRestaurantId:target.id,version:template.version,...deployed}});
  emitRestaurantSync(target.id,"organization.menu-template");
  res.json({templateId:template.id,targetRestaurantId:target.id,version:template.version,...deployed});
});
app.get("/api/push/vapid-public-key",authenticate,(_req:AuthRequest,res:Response)=>{const key=pushPublicKey();if(!key)return res.status(503).json({message:"Web push is not configured"});res.json({publicKey:key});});
app.post("/api/push/subscriptions",authenticate,async(req:AuthRequest,res:Response)=>{const parsed=z.object({endpoint:z.string().url().max(2048),keys:z.object({p256dh:z.string().min(20).max(500),auth:z.string().min(8).max(200)})}).safeParse(req.body);if(!parsed.success)return res.status(400).json({message:"Invalid push subscription"});await prisma.pushSubscription.upsert({where:{endpoint:parsed.data.endpoint},create:{restaurantId:req.staff!.restaurantId,staffUserId:req.staff!.id,endpoint:parsed.data.endpoint,p256dh:parsed.data.keys.p256dh,auth:parsed.data.keys.auth,userAgent:req.get("user-agent")?.slice(0,300)},update:{restaurantId:req.staff!.restaurantId,staffUserId:req.staff!.id,p256dh:parsed.data.keys.p256dh,auth:parsed.data.keys.auth,userAgent:req.get("user-agent")?.slice(0,300)}});res.status(201).json({subscribed:true});});
app.delete("/api/push/subscriptions",authenticate,async(req:AuthRequest,res:Response)=>{const parsed=z.object({endpoint:z.string().url().max(2048)}).safeParse(req.body);if(!parsed.success)return res.status(400).json({message:"Invalid push endpoint"});await prisma.pushSubscription.deleteMany({where:{endpoint:parsed.data.endpoint,staffUserId:req.staff!.id}});res.status(204).end();});
app.get("/api/auth/table-session/:qrToken",async(req:Request,res:Response)=>{const table=await prisma.table.findUnique({where:{qrToken:String(req.params.qrToken)},include:{restaurant:true}});if(!table||!table.isActive||table.deletedAt||!table.restaurant.isActive)return res.status(404).json({message:"This QR code is not linked to an active table"});const tableToken=jwt.sign({type:"table",restaurantId:table.restaurantId,tableId:table.id},JWT_SECRET,{expiresIn:"6h",issuer:"white_label-table"});res.set("Cache-Control","no-store").json({tableToken,restaurant:{id:table.restaurant.id,name:table.restaurant.name,slug:table.restaurant.slug},table:{id:table.id,label:table.label}});});
app.post("/api/contact",async(req:Request,res:Response)=>{const parsed=contactInquiryInput.safeParse(req.body);if(!parsed.success)return res.status(400).json({message:"Add a valid name, email, and message",issues:parsed.error.issues});const inquiry=await prisma.contactInquiry.create({data:{name:parsed.data.name,email:parsed.data.email.toLowerCase(),phone:parsed.data.phone||null,message:parsed.data.message}});res.status(201).json({id:inquiry.id,message:"Your message has been received. Restaurant Platform support will follow up."});});
app.post("/api/auth/logout",authenticate,async(req:AuthRequest,res:Response)=>{await prisma.staffSession.updateMany({where:{id:req.staff!.sessionId,staffUserId:req.staff!.id},data:{revokedAt:new Date()}});res.status(204).end();});
app.get("/api/menu/:restaurantSlug", async (req,res)=>{
  const restaurant=await prisma.restaurant.findUnique({where:{slug:req.params.restaurantSlug},include:{categories:{orderBy:{sortOrder:"asc"},include:{items:{where:{isAvailable:true,deletedAt:null},orderBy:{name:"asc"},include:{options:{where:{isAvailable:true},orderBy:{name:"asc"}}}}}},tables:{where:{code:String(req.query.tableId||"T1"),isActive:true,deletedAt:null},take:1},paymentMethods:{where:{isActive:true,deletedAt:null},orderBy:{createdAt:"asc"}}}});
  if(!restaurant||!restaurant.tables[0])return res.status(404).json({message:"Restaurant or table not found"});
  const trialExpired=restaurant.planStatus==="trialing"&&!!restaurant.trialEndsAt&&restaurant.trialEndsAt<=new Date(),orderingEnabled=restaurant.orderingEnabled&&!restaurant.featuresLocked&&!trialExpired;
  const response:MenuResponse={
    restaurant:{id:restaurant.id,name:restaurant.name,slug:restaurant.slug,tagline:restaurant.tagline,currency:"INR",orderingEnabled,orderPauseMessage:restaurant.featureLockReason||restaurant.orderPauseMessage,taxPercent:restaurant.taxPercent,serviceChargePercent:restaurant.serviceChargePercent,logoUrl:restaurant.logoUrl,coverImageUrl:restaurant.coverImageUrl,brandColor:restaurant.brandColor,cardPaymentsEnabled:restaurant.cardPaymentsEnabled&&!!restaurant.cardMerchantVerifiedAt,cardPaymentKeyId:restaurant.cardPaymentsEnabled&&restaurant.cardMerchantVerifiedAt?restaurant.cardMerchantKeyId||undefined:undefined},
    table:{id:restaurant.tables[0].id,label:restaurant.tables[0].label},
    categories:restaurant.categories.map(c=>({id:c.id,name:c.name,sortOrder:c.sortOrder,items:c.items.map(i=>({id:i.id,categoryId:c.id,name:i.name,description:i.description,price:i.price,isAvailable:i.isAvailable,isVeg:i.isVeg,tags:i.tags,imageUrl:i.imageUrl,prepMinutes:i.prepMinutes,options:i.options}))})),
    paymentMethods:restaurant.paymentMethods.map(p=>({id:p.id,provider:p.provider,displayName:p.displayName,upiId:p.upiId||undefined,phone:p.phone||undefined,qrImageData:p.qrImageKey?`${req.protocol}://${req.get("host")}/api/payment-qr/${p.id}`:p.qrImageData||""}))
  };
  return res.json(response);
});
app.get("/api/menu/by-token/:qrToken",async(req:Request,res:Response)=>{const table=await prisma.table.findUnique({where:{qrToken:String(req.params.qrToken)},include:{restaurant:{include:{categories:{orderBy:{sortOrder:"asc"},include:{items:{where:{isAvailable:true,deletedAt:null},orderBy:{name:"asc"},include:{options:{where:{isAvailable:true},orderBy:{name:"asc"}}}}}},paymentMethods:{where:{isActive:true,deletedAt:null},orderBy:{createdAt:"asc"}}}}}});if(!table||!table.isActive||table.deletedAt)return res.status(404).json({message:"Restaurant or table not found"});const restaurant=table.restaurant,trialExpired=restaurant.planStatus==="trialing"&&!!restaurant.trialEndsAt&&restaurant.trialEndsAt<=new Date(),orderingEnabled=restaurant.orderingEnabled&&!restaurant.featuresLocked&&!trialExpired;res.json({restaurant:{id:restaurant.id,name:restaurant.name,slug:restaurant.slug,tagline:restaurant.tagline,currency:"INR",orderingEnabled,orderPauseMessage:restaurant.featureLockReason||restaurant.orderPauseMessage,taxPercent:restaurant.taxPercent,serviceChargePercent:restaurant.serviceChargePercent,logoUrl:restaurant.logoUrl,coverImageUrl:restaurant.coverImageUrl,brandColor:restaurant.brandColor,cardPaymentsEnabled:restaurant.cardPaymentsEnabled&&!!restaurant.cardMerchantVerifiedAt,cardPaymentKeyId:restaurant.cardPaymentsEnabled&&restaurant.cardMerchantVerifiedAt?restaurant.cardMerchantKeyId||undefined:undefined},table:{id:table.id,label:table.label,qrToken:table.qrToken},categories:restaurant.categories.map(c=>({id:c.id,name:c.name,sortOrder:c.sortOrder,items:c.items.map(i=>({id:i.id,categoryId:c.id,name:i.name,description:i.description,price:i.price,isAvailable:i.isAvailable,isVeg:i.isVeg,tags:i.tags,imageUrl:i.imageUrl,prepMinutes:i.prepMinutes,options:i.options}))})),paymentMethods:restaurant.paymentMethods.map(p=>({id:p.id,provider:p.provider,displayName:p.displayName,upiId:p.upiId||undefined,phone:p.phone||undefined,qrImageData:p.qrImageKey?`${req.protocol}://${req.get("host")}/api/payment-qr/${p.id}`:p.qrImageData||""}))});});
app.get("/api/payment-qr/:id",async(req:Request,res:Response)=>{const method=await prisma.paymentMethod.findFirst({where:{id:String(req.params.id),isActive:true,deletedAt:null}});if(!method)return res.status(404).end();if(method.qrImageKey){const publicUrl=qrStorage.publicUrl(method.qrImageKey);if(publicUrl)return res.redirect(publicUrl);try{const asset=await qrStorage.get(method.qrImageKey);if(!asset)return res.status(404).end();res.type(asset.contentType).set("Cache-Control","public, max-age=3600").send(asset.buffer)}catch{return res.status(404).end()}}else if(method.qrImageData){res.redirect(method.qrImageData)}else res.status(404).end();});
app.get("/api/media",async(req:Request,res:Response)=>{const key=String(req.query.key||"");if(!key||key.includes(".."))return res.status(404).end();try{const persisted=await prisma.mediaAsset.findUnique({where:{key},select:{contentType:true,data:true}});if(persisted)return res.type(persisted.contentType).set("Cache-Control","public, max-age=31536000, immutable").send(Buffer.from(persisted.data));const asset=await qrStorage.get(key);if(!asset)return res.status(404).end();res.type(asset.contentType).set("Cache-Control","public, max-age=86400").send(asset.buffer)}catch{return res.status(404).end()}});
app.post("/api/orders",authenticateTable,async(req:TableRequest,res:Response)=>{
  const parsed=orderInput.safeParse(req.body),idempotencyKey=z.string().uuid().safeParse(req.header("Idempotency-Key"));
  if(!parsed.success)return res.status(400).json({message:"Invalid order",issues:parsed.error.issues});
  if(!idempotencyKey.success)return res.status(400).json({message:"A valid Idempotency-Key header is required"});
  if(parsed.data.restaurantId!==req.tableSession!.restaurantId||parsed.data.tableId!==req.tableSession!.tableId)return res.status(403).json({message:"Order does not belong to this table session"});

  const duplicate=await prisma.order.findFirst({where:{restaurantId:parsed.data.restaurantId,idempotencyKey:idempotencyKey.data},include:{items:true,paymentMethod:true}});
  if(duplicate){if(duplicate.paymentStatus!=="PENDING")await ensureKitchenTickets(prisma,duplicate.id);return res.json(toOrder(duplicate));}

  const table=await prisma.table.findFirst({where:{id:parsed.data.tableId,restaurantId:parsed.data.restaurantId,isActive:true,deletedAt:null},include:{restaurant:true}});
  if(!table)return res.status(400).json({message:"Invalid table"});
  const trialExpired=table.restaurant.planStatus==="trialing"&&!!table.restaurant.trialEndsAt&&table.restaurant.trialEndsAt<=new Date();
  if(table.restaurant.featuresLocked||trialExpired)return res.status(423).json({message:table.restaurant.featureLockReason||"Online ordering is locked until the restaurant continues its plan",code:"FEATURES_LOCKED"});
  if(!table.restaurant.orderingEnabled)return res.status(409).json({message:table.restaurant.orderPauseMessage||"Online ordering is temporarily paused"});

  const paymentSelection=validatePaymentSelection(parsed.data);
  if(!paymentSelection.ok)return res.status(400).json({message:paymentSelection.message});
  const paymentMode=paymentSelection.mode;
  const paymentMethod=paymentMode==="upi"&&parsed.data.paymentMethodId?await prisma.paymentMethod.findFirst({where:{id:parsed.data.paymentMethodId,restaurantId:parsed.data.restaurantId,isActive:true,deletedAt:null}}):null;
  if(paymentMode==="upi"&&!paymentMethod?.upiId)return res.status(400).json({message:"The selected UPI payment method is unavailable"});
  const cardPayment=paymentMode==="card";
  if(cardPayment&&(!table.restaurant.cardPaymentsEnabled||!table.restaurant.cardMerchantVerifiedAt||!table.restaurant.cardMerchantKeyId||!table.restaurant.cardMerchantSecretCiphertext))return res.status(409).json({message:"Card payment is not enabled for this restaurant"});

  const ids=parsed.data.items.map(i=>i.menuItemId),dbItems=await prisma.menuItem.findMany({where:{id:{in:ids},restaurantId:parsed.data.restaurantId,isAvailable:true,deletedAt:null},include:{options:{where:{isAvailable:true}}}});
  if(dbItems.length!==new Set(ids).size)return res.status(400).json({message:"One or more items are unavailable"});

  const lookup=new Map(dbItems.map(i=>[i.id,i]));
  for(const input of parsed.data.items){const item=lookup.get(input.menuItemId)!;const options=item.options.filter(option=>input.optionIds.includes(option.id));if(options.length!==input.optionIds.length)return res.status(400).json({message:`One or more options for ${item.name} are unavailable`});const unitPrice=item.price+options.reduce((sum,option)=>sum+option.priceDelta,0);if(unitPrice<1)return res.status(400).json({message:`The selected options for ${item.name} produce an invalid price`});}
  const selections=parsed.data.items.map(input=>{const item=lookup.get(input.menuItemId)!;const options=item.options.filter(option=>input.optionIds.includes(option.id));const unitPrice=item.price+options.reduce((sum,option)=>sum+option.priceDelta,0),taxRate=item.gstRate==null?table.restaurant.taxPercent:Number(item.gstRate);return {input,item,options,unitPrice,taxRate,taxAmount:Math.round(unitPrice*input.quantity*taxRate/100)};});

  const subtotal=selections.reduce((sum,i)=>sum+i.unitPrice*i.input.quantity,0),taxAmount=selections.reduce((sum,item)=>sum+item.taxAmount,0),serviceChargeAmount=Math.round(subtotal*table.restaurant.serviceChargePercent/100),total=subtotal+taxAmount+serviceChargeAmount;
  if(!Number.isSafeInteger(total)||total<1||total>1_000_000)return res.status(400).json({message:"Order total must be between ₹1 and ₹10,00,000"});
  const prepMinutes=Math.max(1,...selections.map(selection=>selection.item.prepMinutes||15)),estimatedReadyAt=new Date(Date.now()+prepMinutes*60_000);

  try {
    const row=await prisma.$transaction(async tx=>{
      const restaurant=await tx.restaurant.update({where:{id:parsed.data.restaurantId},data:{nextOrderNumber:{increment:1}},select:{nextOrderNumber:true}});
      const sequence=restaurant.nextOrderNumber-1;
      return tx.order.create({
        data:{
          displayId:`ORD-${String(sequence).padStart(4,"0")}`,
          idempotencyKey:idempotencyKey.data,
          restaurantId:parsed.data.restaurantId,
          tableId:table.id,
          tableLabel:table.label,
          totalAmount:total,
          subtotalAmount:subtotal,
          taxAmount,
          serviceChargeAmount,
          estimatedReadyAt,
          paymentMethodId:paymentMethod?.id,
          paymentStatus:paymentMode==="counter"?PaymentStatus.PAY_AT_COUNTER:PaymentStatus.PENDING,
          paymentMode,
          items:{create:selections.map(i=>({menuItemId:i.item.id,name:i.item.name,quantity:i.input.quantity,unitPrice:i.unitPrice,taxableAmount:i.unitPrice*i.input.quantity,taxRate:i.taxRate,taxAmount:i.taxAmount,hsnCode:i.item.hsnCode||null,notes:i.input.notes,options:i.options}))}
        },
        include:{items:true,paymentMethod:true}
      });
    });
    const order=toOrder(row);
    if(order.paymentStatus!=="pending"){
      await ensureKitchenTickets(prisma,row.id);
      io.to(`restaurant:${order.restaurantId}`).emit("order:new",order);
      if(order.paymentStatus==="pay_at_counter")void sendRestaurantPush(prisma,order.restaurantId,{kind:"new-order",title:"New Pay at Counter order",body:`${order.tableLabel} · ${order.id} is ready to accept.`,tag:`new-order-${order.id}`});
    }
    io.to(`table:${order.tableId}`).emit("order:updated",order);
    return res.status(201).json({...order,taxAmount,serviceChargeAmount});
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      const existing = await prisma.order.findFirst({ where: { restaurantId: parsed.data.restaurantId, idempotencyKey: idempotencyKey.data }, include: { items: true, paymentMethod: true } });
      if (existing) {if(existing.paymentStatus!=="PENDING")await ensureKitchenTickets(prisma,existing.id);return res.json(toOrder(existing));}
    }
    throw error;
  }
});
app.post("/api/customer/orders/:orderId/payments/upi",authenticateTable,async(req:TableRequest,res:Response)=>{
  res.set("Cache-Control","no-store");
  const parsed=z.object({trackingToken:z.string().uuid(),paymentMethodId:z.string()}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({message:"A valid order token and UPI payment method are required"});
  const order=await prisma.order.findFirst({where:{displayId:String(req.params.orderId),trackingToken:parsed.data.trackingToken,restaurantId:req.tableSession!.restaurantId,tableId:req.tableSession!.tableId,paymentMode:"upi",paymentStatus:{in:["PENDING","REPORTED"]}},include:{restaurant:true,paymentMethod:true}});
  if(!order||order.status==="CANCELLED"||order.status==="SERVED")return res.status(404).json({message:"Eligible UPI order not found"});
  const method=order.paymentMethod?.id===parsed.data.paymentMethodId&&order.paymentMethod.deletedAt===null?order.paymentMethod:await prisma.paymentMethod.findFirst({where:{id:parsed.data.paymentMethodId,restaurantId:order.restaurantId,isActive:true,deletedAt:null}});
  if(!method?.upiId)return res.status(409).json({message:"This restaurant has not configured a valid UPI ID for dynamic payments"});
  const now=new Date();
  let payment=await prisma.upiPaymentAttempt.findFirst({where:{orderId:order.id,status:{in:["CREATED","PENDING","PROCESSING","REQUIRES_REVIEW"]},expiresAt:{gt:now}},include:{order:true}});
  if(!payment){
    payment=await prisma.upiPaymentAttempt.create({data:{restaurantId:order.restaurantId,orderId:order.id,paymentMethodId:method.id,status:"PENDING",amountPaise:order.totalAmount*100,currency:"INR",transactionReference:createUpiTransactionReference(),merchantVpa:method.upiId,merchantName:order.restaurant.name,expiresAt:new Date(now.getTime()+15*60*1000),events:{create:{eventType:"payment_created",source:"customer",sanitizedPayload:{orderId:order.displayId,amountPaise:order.totalAmount*100,currency:"INR"}}}},include:{order:true}});
  }
  res.status(201).json(await toCustomerUpiPayment(payment));
});
app.get("/api/customer/orders/:orderId/payments/:paymentId",authenticateTable,async(req:TableRequest,res:Response)=>{
  res.set("Cache-Control","no-store");
  let payment=await prisma.upiPaymentAttempt.findFirst({where:{id:String(req.params.paymentId),order:{displayId:String(req.params.orderId),restaurantId:req.tableSession!.restaurantId,tableId:req.tableSession!.tableId}},include:{order:true}});
  if(!payment)return res.status(404).json({message:"Payment not found"});
  if(payment.expiresAt<=new Date()&&["CREATED","PENDING","PROCESSING"].includes(payment.status))payment=await prisma.upiPaymentAttempt.update({where:{id:payment.id},data:{status:"EXPIRED"},include:{order:true}});
  res.json(await toCustomerUpiPayment(payment));
});
app.post("/api/customer/orders/:orderId/payments/:paymentId/retry-launch",authenticateTable,async(req:TableRequest,res:Response)=>{
  res.set("Cache-Control","no-store");
  const parsed=z.object({app:z.enum(["google_pay","phonepe","paytm","generic_upi"])}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({message:"Choose a supported UPI app"});
  const existing=await prisma.upiPaymentAttempt.findFirst({where:{id:String(req.params.paymentId),order:{displayId:String(req.params.orderId),restaurantId:req.tableSession!.restaurantId,tableId:req.tableSession!.tableId},status:{in:["CREATED","PENDING","PROCESSING"]},expiresAt:{gt:new Date()}},include:{order:true}});
  if(!existing)return res.status(404).json({message:"Active payment attempt not found"});
  const payment=await prisma.upiPaymentAttempt.update({where:{id:existing.id},data:{customerSelectedApp:parsed.data.app,status:"PROCESSING",events:{create:{eventType:"payment_launch_attempted",source:"customer",sanitizedPayload:{app:parsed.data.app}}}},include:{order:true}});
  const upiPaymentLink=buildUpiPayload({merchantVpa:payment.merchantVpa,merchantName:payment.merchantName,transactionReference:payment.transactionReference,amountPaise:payment.amountPaise,note:`Restaurant Platform order ${payment.order.displayId}`});
  const launchUrl=buildUpiLaunchOptions(upiPaymentLink).find(option=>option.id===parsed.data.app)?.launchUrl;
  if(!launchUrl)return res.status(400).json({message:"The selected UPI app is unavailable"});
  res.json({...await toCustomerUpiPayment(payment),launchUrl});
});
app.post("/api/customer/orders/:orderId/payments/:paymentId/report-paid",authenticateTable,async(req:TableRequest,res:Response)=>{
  const existing=await prisma.upiPaymentAttempt.findFirst({where:{id:String(req.params.paymentId),order:{displayId:String(req.params.orderId),restaurantId:req.tableSession!.restaurantId,tableId:req.tableSession!.tableId}},include:{order:{include:{items:true,paymentMethod:true}}}});
  if(!existing)return res.status(404).json({message:"Payment not found"});
  if(existing.status==="PAID"||existing.status==="REQUIRES_REVIEW")return res.json({payment:await toCustomerUpiPayment(existing),order:toOrder(existing.order)});
  if(existing.expiresAt<=new Date())return res.status(409).json({message:"This payment request expired. Start a new payment attempt."});
  const result=await prisma.$transaction(async tx=>{
    const payment=await tx.upiPaymentAttempt.update({where:{id:existing.id},data:{status:"REQUIRES_REVIEW",customerReference:null,events:{create:{eventType:"payment_reported",source:"customer",sanitizedPayload:{verification:"restaurant_manual"}}}},include:{order:true}});
    const order=await tx.order.update({where:{id:existing.orderId},data:{paymentStatus:"REPORTED",paymentReference:null,paymentReportedAt:new Date()},include:{items:true,paymentMethod:true}});
    return {payment,order};
  });
  await recordManualUpiReview(prisma,{restaurantId:result.order.restaurantId,orderId:result.order.id,paymentAttemptId:result.payment.id,expectedAmount:result.order.totalAmount*100,localStatus:"REPORTED"});
  await ensureKitchenTickets(prisma,result.order.id);
  const publicOrder=toOrder(result.order);io.to(`restaurant:${publicOrder.restaurantId}`).emit("order:new",publicOrder);io.to(`table:${publicOrder.tableId}`).emit("order:updated",publicOrder);void sendRestaurantPush(prisma,publicOrder.restaurantId,{kind:"payment-reported",title:"Customer submitted payment",body:`${publicOrder.tableLabel} · ${publicOrder.id} is ready to verify.`,tag:`payment-reported-${publicOrder.id}`});
  res.json({payment:await toCustomerUpiPayment(result.payment),order:publicOrder});
});
app.post("/api/customer/orders/:orderId/payments/:paymentId/verify",authenticateTable,async(req:TableRequest,res:Response)=>{
  const payment=await prisma.upiPaymentAttempt.findFirst({where:{id:String(req.params.paymentId),order:{displayId:String(req.params.orderId),restaurantId:req.tableSession!.restaurantId,tableId:req.tableSession!.tableId}},include:{order:true}});
  if(!payment)return res.status(404).json({message:"Payment not found"});
  const result=await manualUpiProvider.verifyPayment(payment.id);
  await prisma.upiPaymentEvent.create({data:{paymentId:payment.id,eventType:"payment_verification_requested",source:"customer",sanitizedPayload:{result:result.status}}});
  res.status(202).json({status:result.status,message:result.message,payment:await toCustomerUpiPayment(payment)});
});
app.post("/api/orders/:id/card-checkout",authenticateTable,async(req:TableRequest,res:Response)=>{
  const parsed=z.object({trackingToken:z.string().uuid()}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({message:"A valid order token is required"});
  const order=await prisma.order.findFirst({where:{displayId:String(req.params.id),trackingToken:parsed.data.trackingToken,restaurantId:req.tableSession!.restaurantId,tableId:req.tableSession!.tableId,paymentMode:"card",paymentStatus:"PENDING"},include:{restaurant:true}});
  if(!order)return res.status(404).json({message:"Eligible card order not found"});
  const restaurant=order.restaurant;
  if(!restaurant.cardPaymentsEnabled||!restaurant.cardMerchantKeyId||!restaurant.cardMerchantSecretCiphertext)return res.status(409).json({message:"Card payments are unavailable"});
  let providerOrderId=order.providerOrderId;
  if(!providerOrderId){
    const secret=decryptMerchantSecret(restaurant.cardMerchantSecretCiphertext);
    let response:globalThis.Response;
    try{response=await razorpayRequest("/orders",restaurant.cardMerchantKeyId,secret,{method:"POST",body:JSON.stringify({amount:order.totalAmount*100,currency:"INR",receipt:order.displayId,notes:{restaurantId:restaurant.id,orderId:order.id,tableId:order.tableId}})})}catch{return res.status(502).json({message:"Could not reach Razorpay. Please try again."})}
    const result=await response.json().catch(()=>({})) as {id?:string;error?:{description?:string}};
    if(!response.ok||!result.id)return res.status(502).json({message:result.error?.description||"Razorpay could not create this payment"});
    providerOrderId=result.id;
    await prisma.order.update({where:{id:order.id},data:{providerOrderId}});
  }
  return res.json({keyId:restaurant.cardMerchantKeyId,razorpayOrderId:providerOrderId,amount:order.totalAmount*100,currency:"INR",restaurantName:restaurant.name,orderId:order.displayId});
});
app.post("/api/orders/:id/card-confirm",authenticateTable,async(req:TableRequest,res:Response)=>{
  const parsed=z.object({trackingToken:z.string().uuid(),razorpay_payment_id:z.string().min(4),razorpay_order_id:z.string().min(4),razorpay_signature:z.string().regex(/^[a-f0-9]{64}$/i)}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({message:"Invalid payment confirmation"});
  const order=await prisma.order.findFirst({where:{displayId:String(req.params.id),trackingToken:parsed.data.trackingToken,restaurantId:req.tableSession!.restaurantId,tableId:req.tableSession!.tableId,paymentMode:"card"},include:{restaurant:true,items:true,paymentMethod:true}});
  if(!order||!order.providerOrderId||order.providerOrderId!==parsed.data.razorpay_order_id)return res.status(404).json({message:"Payment order not found"});
  if(order.paymentStatus==="PAID")return res.json(toOrder(order));
  const encrypted=order.restaurant.cardMerchantSecretCiphertext,keyId=order.restaurant.cardMerchantKeyId;
  if(!encrypted||!keyId)return res.status(409).json({message:"Merchant connection is unavailable"});
  const secret=decryptMerchantSecret(encrypted),expected=createHmac("sha256",secret).update(`${order.providerOrderId}|${parsed.data.razorpay_payment_id}`).digest("hex");
  if(!secureSignatureEqual(parsed.data.razorpay_signature,expected))return res.status(400).json({message:"Payment signature verification failed"});
  let providerPayment:{id?:string;order_id?:string;amount?:number;currency?:string;status?:string;error_description?:string};
  try{const response=await razorpayRequest(`/payments/${encodeURIComponent(parsed.data.razorpay_payment_id)}`,keyId,secret);providerPayment=await response.json() as typeof providerPayment;if(!response.ok)throw new Error()}catch{return res.status(202).json({message:"Payment verified and is awaiting capture",paymentStatus:"pending"})}
  const preflight=await recordProviderReconciliation(prisma,{restaurantId:order.restaurantId,orderId:order.id,kind:"PAYMENT",provider:"razorpay",expectedAmount:order.totalAmount*100,expectedCurrency:"INR",expectedOrderReference:order.providerOrderId,localStatus:order.paymentStatus,providerState:{reference:parsed.data.razorpay_payment_id,orderReference:providerPayment.order_id,amount:providerPayment.amount,currency:providerPayment.currency,status:providerPayment.status,error:providerPayment.error_description},source:"checkout"});
  if(preflight.status==="MISMATCH"){
    await appendAuditEvent(prisma,{restaurantId:order.restaurantId,actor:{type:AuditActorType.INTEGRATION,id:"razorpay"},action:"payment.reconciliation_mismatch",resourceType:"order",resourceId:order.id,metadata:{reconciliationId:preflight.id,mismatchCode:preflight.mismatchCode}});
    return res.status(409).json({message:"The provider payment does not match this order. Restaurant support has been alerted.",code:preflight.mismatchCode});
  }
  if(providerPayment.status==="authorized")try{const captureResponse=await razorpayRequest(`/payments/${encodeURIComponent(parsed.data.razorpay_payment_id)}/capture`,keyId,secret,{method:"POST",body:JSON.stringify({amount:order.totalAmount*100,currency:"INR"})});if(captureResponse.ok)providerPayment=await captureResponse.json() as typeof providerPayment}catch{/* The webhook or a later reconciliation can confirm capture. */}
  const captured=providerPayment.status==="captured";
  const reconciliation=await recordProviderReconciliation(prisma,{restaurantId:order.restaurantId,orderId:order.id,kind:"PAYMENT",provider:"razorpay",expectedAmount:order.totalAmount*100,expectedCurrency:"INR",expectedOrderReference:order.providerOrderId,localStatus:order.paymentStatus,providerState:{reference:parsed.data.razorpay_payment_id,orderReference:providerPayment.order_id,amount:providerPayment.amount,currency:providerPayment.currency,status:providerPayment.status,error:providerPayment.error_description},source:"checkout"});
  if(reconciliation.status==="MISMATCH"){
    await appendAuditEvent(prisma,{restaurantId:order.restaurantId,actor:{type:AuditActorType.INTEGRATION,id:"razorpay"},action:"payment.reconciliation_mismatch",resourceType:"order",resourceId:order.id,metadata:{reconciliationId:reconciliation.id,mismatchCode:reconciliation.mismatchCode}});
    return res.status(409).json({message:"The provider payment does not match this order. Restaurant support has been alerted.",code:reconciliation.mismatchCode});
  }
  const updated=await prisma.order.update({where:{id:order.id},data:{providerPaymentId:parsed.data.razorpay_payment_id,paymentReference:parsed.data.razorpay_payment_id,paymentStatus:captured?"PAID":"PENDING",paymentConfirmedAt:captured?new Date():null,lastPaymentError:providerPayment.error_description||null},include:{items:true,paymentMethod:true}}),publicOrder=toOrder(updated);
  if(captured){await ensureKitchenTickets(prisma,order.id);await issueTaxInvoice(prisma,order.id)}
  io.to(`restaurant:${order.restaurantId}`).emit("order:updated",publicOrder);io.to(`table:${order.tableId}`).emit("order:updated",publicOrder);if(captured)void sendRestaurantPush(prisma,order.restaurantId,{kind:"payment-confirmed",title:"Payment confirmed",body:`${publicOrder.tableLabel} · Payment for ${publicOrder.id} is confirmed.`,tag:`payment-confirmed-${publicOrder.id}`});
  return res.status(captured?200:202).json(publicOrder);
});
app.post("/api/payments/razorpay/webhook/:restaurantId",async(req:Request&{rawBody?:Buffer},res:Response)=>{
  const restaurant=await prisma.restaurant.findUnique({where:{id:String(req.params.restaurantId)},select:{cardWebhookSecretCiphertext:true}});
  const received=req.header("x-razorpay-signature"),raw=req.rawBody;
  if(!restaurant?.cardWebhookSecretCiphertext||!received||!raw)return res.status(401).json({message:"Webhook verification failed"});
  res.locals.syncRestaurantId=String(req.params.restaurantId);
  const secret=decryptMerchantSecret(restaurant.cardWebhookSecretCiphertext),expected=createHmac("sha256",secret).update(raw).digest("hex");
  if(!secureSignatureEqual(received,expected))return res.status(401).json({message:"Webhook signature verification failed"});
  const event=req.body as any,payment=event?.payload?.payment?.entity,refund=event?.payload?.refund?.entity,providerOrderId=payment?.order_id||event?.payload?.order?.entity?.id;
  if(!providerOrderId&&!refund?.payment_id)return res.status(200).json({received:true});
  const order=await prisma.order.findFirst({where:{restaurantId:String(req.params.restaurantId),...(providerOrderId?{providerOrderId}:{providerPaymentId:refund.payment_id})},include:{items:true,paymentMethod:true}});
  if(!order)return res.status(200).json({received:true});
  const data:any={};
  const paymentReconciliation=payment?.id?await recordProviderReconciliation(prisma,{restaurantId:order.restaurantId,orderId:order.id,kind:"PAYMENT",provider:"razorpay",expectedAmount:order.totalAmount*100,expectedCurrency:"INR",expectedOrderReference:order.providerOrderId,localStatus:order.paymentStatus,providerState:{reference:payment.id,orderReference:payment.order_id,amount:payment.amount,currency:payment.currency,status:payment.status,error:payment.error_description},source:"webhook"}):null;
  const refundReconciliation=refund?.id?await recordProviderReconciliation(prisma,{restaurantId:order.restaurantId,orderId:order.id,kind:"REFUND",provider:"razorpay",expectedAmount:order.totalAmount*100,expectedCurrency:"INR",expectedOrderReference:order.providerPaymentId,localStatus:order.refundStatus||"pending",providerState:{reference:refund.id,orderReference:refund.payment_id,amount:refund.amount,currency:refund.currency,status:refund.status},source:"webhook"}):null;
  const mismatch=paymentReconciliation?.status==="MISMATCH"?paymentReconciliation:refundReconciliation?.status==="MISMATCH"?refundReconciliation:null;
  if(mismatch)await appendAuditEvent(prisma,{restaurantId:order.restaurantId,actor:{type:AuditActorType.INTEGRATION,id:"razorpay"},action:"payment.reconciliation_mismatch",resourceType:"order",resourceId:order.id,metadata:{reconciliationId:mismatch.id,mismatchCode:mismatch.mismatchCode,event:event.event}});
  if((event.event==="payment.captured"||event.event==="order.paid")&&paymentReconciliation?.status==="MATCHED"){data.paymentStatus="PAID";data.paymentConfirmedAt=new Date();data.providerPaymentId=payment.id;data.paymentReference=payment.id;data.lastPaymentError=null}
  else if(event.event==="payment.failed"){data.lastPaymentError=payment?.error_description||"Payment failed"}
  else if(event.event==="refund.processed"&&refundReconciliation?.status==="MATCHED"){data.paymentStatus="REFUNDED";data.refundId=event?.payload?.refund?.entity?.id||order.refundId;data.refundStatus="processed"}
  if(Object.keys(data).length){const updated=await prisma.order.update({where:{id:order.id},data,include:{items:true,paymentMethod:true}}),publicOrder=toOrder(updated);if(data.paymentStatus==="PAID"){await ensureKitchenTickets(prisma,order.id);await issueTaxInvoice(prisma,order.id)}if(data.paymentStatus==="REFUNDED")await issueCreditNote(prisma,order.id,data.refundId||order.refundId||undefined,String(refund?.notes?.reason||"Payment provider refund"));io.to(`restaurant:${order.restaurantId}`).emit("order:updated",publicOrder);io.to(`table:${order.tableId}`).emit("order:updated",publicOrder);if(data.paymentStatus==="PAID"&&order.paymentStatus!=="PAID")void sendRestaurantPush(prisma,order.restaurantId,{kind:"payment-confirmed",title:"Payment confirmed",body:`${publicOrder.tableLabel} · Payment for ${publicOrder.id} is confirmed.`,tag:`payment-confirmed-${publicOrder.id}`})}
  return res.status(200).json({received:true});
});
app.get("/api/orders/active",authenticate,async(req:AuthRequest,res:Response)=>{ const rows=await prisma.order.findMany({where:{restaurantId:req.staff!.restaurantId,status:{notIn:["SERVED","CANCELLED"]},paymentStatus:{not:"PENDING"}},include:{items:true,paymentMethod:true},orderBy:{createdAt:"desc"}}); return res.json(rows.map(toOrder)); });
app.patch("/api/orders/:id/status",authenticate,idempotentMutation,async(req:AuthRequest,res:Response)=>{
  const parsed=z.enum(["new","accepted","preparing","ready","served","cancelled"]).safeParse(req.body.status);if(!parsed.success)return res.status(400).json({message:"Invalid status"});
  const requiredCapability:Capability=parsed.data==="accepted"?"orders.accept":parsed.data==="preparing"?"orders.prepare":parsed.data==="ready"?"orders.ready":parsed.data==="served"?"orders.serve":parsed.data==="cancelled"?"orders.reject":"orders.edit";
  if(!roleHasCapability(req.staff!.role,requiredCapability))return res.status(403).json({message:"Your role cannot move orders to this status",code:"FORBIDDEN_CAPABILITY",requiredCapability});
  const existing=await prisma.order.findFirst({where:{displayId:String(req.params.id),restaurantId:req.staff!.restaurantId}});if(!existing)return res.status(404).json({message:"Order not found"});
  const current=existing.status.toLowerCase();if(parsed.data==="cancelled"&&current!=="new")return res.status(409).json({message:"Only new orders can be rejected"});
  if(req.staff!.role==="KITCHEN"&&!((current==="accepted"&&parsed.data==="preparing")||(current==="preparing"&&parsed.data==="ready")))return res.status(409).json({message:"Kitchen orders must move forward one stage at a time"});
  if(req.staff!.role==="WAITER"&&!((current==="new"&&parsed.data==="accepted")||(current==="ready"&&parsed.data==="served")))return res.status(409).json({message:"Waiters can accept new orders or serve ready orders"});
  const row=await prisma.order.update({where:{id:existing.id},data:{status:statusMap[parsed.data]},include:{items:true,paymentMethod:true}});
  if(parsed.data==="accepted"){await ensureKitchenTickets(prisma,existing.id);await consumeInventoryForOrder(prisma,existing.id,req.staff!.id)}
  const order=toOrder(row);io.to(`restaurant:${order.restaurantId}`).emit("order:updated",order);io.to(`table:${order.tableId}`).emit("order:updated",order);
  if(parsed.data==="ready"&&current!=="ready")void sendRestaurantPush(prisma,order.restaurantId,{kind:"order-ready",title:"Order ready",body:`${order.tableLabel} · ${order.id} is ready to serve.`,tag:`order-ready-${order.id}`});
  return res.json(order);
});
app.post("/api/orders/:id/payment-report",authenticateTable,async(req:TableRequest,res:Response)=>{const parsed=z.object({trackingToken:z.string().uuid()}).safeParse(req.body);if(!parsed.success)return res.status(400).json({message:"Invalid payment report"});const existing=await prisma.order.findFirst({where:{displayId:String(req.params.id),trackingToken:parsed.data.trackingToken,restaurantId:req.tableSession!.restaurantId,tableId:req.tableSession!.tableId,paymentMode:"upi",paymentStatus:"PENDING",status:{notIn:["SERVED","CANCELLED"]}}});if(!existing)return res.status(404).json({message:"Eligible UPI order not found"});res.locals.syncRestaurantId=existing.restaurantId;const row=await prisma.order.update({where:{id:existing.id},data:{paymentStatus:"REPORTED",paymentReference:null,paymentReportedAt:new Date()},include:{items:true,paymentMethod:true}});await recordManualUpiReview(prisma,{restaurantId:row.restaurantId,orderId:row.id,expectedAmount:row.totalAmount*100,localStatus:"REPORTED"});await ensureKitchenTickets(prisma,row.id);const order=toOrder(row);io.to(`restaurant:${order.restaurantId}`).emit("order:new",order);io.to(`table:${order.tableId}`).emit("order:updated",order);void sendRestaurantPush(prisma,order.restaurantId,{kind:"payment-reported",title:"Customer submitted payment",body:`${order.tableLabel} · ${order.id} is ready to verify.`,tag:`payment-reported-${order.id}`});res.json(order);});
app.patch("/api/orders/:id/payment-status",authenticate,authorizeCapability("payments.confirm"),async(req:AuthRequest,res:Response)=>{
  const parsed=z.enum(["paid","pending"]).safeParse(req.body.status);if(!parsed.success)return res.status(400).json({message:"Invalid payment status"});
  const existing=await prisma.order.findFirst({where:{displayId:String(req.params.id),restaurantId:req.staff!.restaurantId,paymentMode:{in:["upi","counter"]},paymentStatus:{not:"REFUNDED"},status:{not:"CANCELLED"}}});if(!existing)return res.status(404).json({message:"Manually confirmable order not found"});
  if(parsed.data==="pending"&&existing.paymentMode!=="upi")return res.status(409).json({message:"Pay-at-counter orders cannot be moved to pending"});
  const now=new Date();
  const row=await prisma.$transaction(async tx=>{
    const order=await tx.order.update({where:{id:existing.id},data:{paymentStatus:parsed.data==="paid"?"PAID":"PENDING",paymentConfirmedAt:parsed.data==="paid"?now:null},include:{items:true,paymentMethod:true}});
    const attempt=existing.paymentMode==="upi"?await tx.upiPaymentAttempt.findFirst({where:{orderId:existing.id,status:{in:["REQUIRES_REVIEW","PROCESSING","PENDING"]}},orderBy:{createdAt:"desc"}}):null;
    if(attempt)await tx.upiPaymentAttempt.update({where:{id:attempt.id},data:{status:parsed.data==="paid"?"PAID":"PENDING",verifiedAt:parsed.data==="paid"?now:null,paidAt:parsed.data==="paid"?now:null,providerTransactionId:parsed.data==="paid"?attempt.customerReference:null,events:{create:{eventType:parsed.data==="paid"?"payment_paid":"payment_reopened",source:"restaurant",sanitizedPayload:{staffId:req.staff!.id}}}}});
    if(parsed.data==="pending")await tx.kitchenTicket.deleteMany({where:{orderId:existing.id}});
    return order;
  });
  if(existing.paymentMode==="upi")await resolveManualUpiReview(prisma,{orderId:existing.id,status:parsed.data,resolvedBy:req.staff!.id});
  if(parsed.data==="paid"){await ensureKitchenTickets(prisma,existing.id);await issueTaxInvoice(prisma,existing.id)}
  const order=toOrder(row);io.to(`restaurant:${order.restaurantId}`).emit("order:updated",order);io.to(`table:${order.tableId}`).emit(`order:updated`,order);if(parsed.data==="paid"&&existing.paymentStatus!=="PAID")void sendRestaurantPush(prisma,order.restaurantId,{kind:"payment-confirmed",title:"Payment confirmed",body:`${order.tableLabel} · Payment for ${order.id} is confirmed.`,tag:`payment-confirmed-${order.id}`});res.json(order);
});
app.patch("/api/admin/orders/:id/counter",authenticate,authorize("OWNER","MANAGER","CASHIER"),async(req:AuthRequest,res:Response)=>{const parsed=counterOrderEditInput.safeParse(req.body);if(!parsed.success)return res.status(400).json({message:"Enter a valid table label and order total"});const existing=await prisma.order.findFirst({where:{displayId:String(req.params.id),restaurantId:req.staff!.restaurantId,paymentMode:"counter",paymentStatus:"PAY_AT_COUNTER"}});if(!existing)return res.status(404).json({message:"Editable pay-at-counter order not found"});const row=await prisma.order.update({where:{id:existing.id},data:parsed.data,include:{items:true,paymentMethod:true}});const order=toOrder(row);io.to(`restaurant:${order.restaurantId}`).emit("order:updated",order);io.to(`table:${order.tableId}`).emit("order:updated",order);res.json(order);});
app.get("/api/master/overview",authenticateMaster,async(_req:MasterAuthRequest,res)=>{const[restaurants,activeRestaurants,staff,orders,revenue,openRequests,subscriptions]=await Promise.all([prisma.restaurant.count(),prisma.restaurant.count({where:{isActive:true}}),prisma.staffUser.count(),prisma.order.count({where:{createdAt:{gte:new Date(Date.now()-86400000)}}}),prisma.order.aggregate({where:{createdAt:{gte:new Date(Date.now()-86400000)},paymentStatus:{in:["PAID","PAY_AT_COUNTER"]}},_sum:{totalAmount:true}}),prisma.serviceRequest.count({where:{status:{in:["OPEN","ACKNOWLEDGED"]}}}),prisma.subscription.count({where:{status:"PAST_DUE"}})]);res.json({restaurants,activeRestaurants,staff,ordersLast24h:orders,revenueLast24h:revenue._sum.totalAmount||0,openRequests,pastDueSubscriptions:subscriptions});});
app.get("/api/master/trends",authenticateMaster,async(req:MasterAuthRequest,res:Response)=>{const days=Math.max(7,Math.min(30,Number(req.query.days)||14));res.json(await buildMasterTrends(days));});
app.get("/api/master/support-queue",authenticateMaster,async(_req:MasterAuthRequest,res)=>{res.json(await buildMasterSupportQueueWithTickets());});
app.patch("/api/master/support-tickets/:id",authenticateMaster,async(req:MasterAuthRequest,res:Response)=>{const parsed=z.enum(["ACKNOWLEDGED","RESOLVED"]).safeParse(req.body.status);if(!parsed.success)return res.status(400).json({message:"Invalid ticket status"});const ticket=await prisma.restaurantSupportTicket.findUnique({where:{id:String(req.params.id)}});if(!ticket)return res.status(404).json({message:"Support ticket not found"});res.locals.syncRestaurantId=ticket.restaurantId;const updated=await prisma.restaurantSupportTicket.update({where:{id:ticket.id},data:{status:parsed.data,resolvedAt:parsed.data==="RESOLVED"?new Date():null}});await writePlatformAudit(req.masterAdmin!.id,{restaurantId:ticket.restaurantId,action:`support-ticket.${parsed.data.toLowerCase()}`,targetType:"support-ticket",targetId:ticket.id});res.json(updated);});
app.patch("/api/master/contact-inquiries/:id",authenticateMaster,async(req:MasterAuthRequest,res:Response)=>{const parsed=z.enum(["ACKNOWLEDGED","RESOLVED"]).safeParse(req.body.status);if(!parsed.success)return res.status(400).json({message:"Invalid inquiry status"});const inquiry=await prisma.contactInquiry.findUnique({where:{id:String(req.params.id)}});if(!inquiry)return res.status(404).json({message:"Inquiry not found"});const updated=await prisma.contactInquiry.update({where:{id:inquiry.id},data:{status:parsed.data,resolvedAt:parsed.data==="RESOLVED"?new Date():null}});await writePlatformAudit(req.masterAdmin!.id,{action:`CONTACT_INQUIRY_${parsed.data}`,targetType:"contact-inquiry",targetId:updated.id});res.json(updated);});
app.get("/api/master/restaurants",authenticateMaster,async(req:MasterAuthRequest,res:Response)=>{const search=String(req.query.search||"").trim();const rows=await prisma.restaurant.findMany({where:search?{OR:[{name:{contains:search,mode:"insensitive"}},{slug:{contains:search,mode:"insensitive"}}]}:undefined,orderBy:{createdAt:"desc"},include:{_count:{select:{staff:true,orders:true,tables:true,menuItems:true}},subscription:{select:{plan:true,status:true,currentPeriodStart:true,currentPeriodEnd:true,createdAt:true,cancelAtPeriodEnd:true,retryCount:true,lastPaymentError:true,nextRetryAt:true,invoices:{select:{status:true,paidAt:true,createdAt:true},orderBy:{createdAt:"desc"},take:1}}}}});res.json(rows.map(row=>({...row,plan:canonicalPlan(row.plan),subscription:row.subscription?{...row.subscription,latestInvoice:row.subscription.invoices[0]||null,invoices:undefined}:null})));});
app.get("/api/master/restaurants/:id",authenticateMaster,async(req:MasterAuthRequest,res:Response)=>{const restaurant=await prisma.restaurant.findUnique({where:{id:String(req.params.id)},include:{staff:{select:{id:true,name:true,phone:true,role:true,isActive:true,lastLoginAt:true}},subscription:true,paymentMethods:{select:{id:true,provider:true,displayName:true,isActive:true}},_count:{select:{staff:true,orders:true,tables:true,menuItems:true}}}});if(!restaurant)return res.status(404).json({message:"Restaurant not found"});res.json({...restaurant,plan:canonicalPlan(restaurant.plan)});});
app.get("/api/master/restaurants/:id/orders",authenticateMaster,async(req:MasterAuthRequest,res:Response)=>{const orders=await prisma.order.findMany({where:{restaurantId:String(req.params.id)},include:{items:true,paymentMethod:true},orderBy:{createdAt:"desc"},take:100});res.json(orders.map(toOrder));});
app.get("/api/master/payment-reconciliation",authenticateMaster,async(req:MasterAuthRequest,res:Response)=>{const status=z.enum(["PENDING","MATCHED","MISMATCH","MANUAL_REVIEW","FAILED","RESOLVED"]).optional().safeParse(req.query.status);if(!status.success)return res.status(400).json({message:"Invalid reconciliation status"});const rows=await prisma.paymentReconciliation.findMany({where:status.data?{status:status.data}:undefined,include:{restaurant:{select:{id:true,name:true,slug:true}},order:{select:{displayId:true,tableLabel:true}}},orderBy:{updatedAt:"desc"},take:250});res.json(rows);});
app.post("/api/master/payment-reconciliation/:id/resolve",authenticateMaster,async(req:MasterAuthRequest,res:Response)=>{
  const parsed=z.object({note:z.string().trim().min(8).max(500)}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({message:"A resolution note of at least 8 characters is required"});
  const existing=await prisma.paymentReconciliation.findUnique({where:{id:String(req.params.id)}});
  if(!existing)return res.status(404).json({message:"Reconciliation record not found"});
  if(!["MISMATCH","FAILED"].includes(existing.status))return res.status(409).json({message:"Only mismatched or failed provider reconciliations can be administratively resolved"});
  const updated=await prisma.paymentReconciliation.update({where:{id:existing.id},data:{status:"RESOLVED",resolvedAt:new Date(),resolvedBy:req.masterAdmin!.id,nextCheckAt:null,details:{manualResolutionNote:parsed.data.note,previousStatus:existing.status,previousMismatchCode:existing.mismatchCode}}});
  await writePlatformAudit(req.masterAdmin!.id,{restaurantId:existing.restaurantId,action:"payment-reconciliation.resolved",targetType:"payment-reconciliation",targetId:existing.id,metadata:{note:parsed.data.note,previousStatus:existing.status,previousMismatchCode:existing.mismatchCode}});
  await appendAuditEvent(prisma,{restaurantId:existing.restaurantId,actor:{type:AuditActorType.PLATFORM_ADMIN,id:req.masterAdmin!.id},action:"payment.reconciliation_resolved",resourceType:"payment-reconciliation",resourceId:existing.id,metadata:{note:parsed.data.note,previousStatus:existing.status,previousMismatchCode:existing.mismatchCode}});
  res.json(updated);
});
app.get("/api/master/restaurants/:id/activity",authenticateMaster,async(req:MasterAuthRequest,res:Response)=>{const activity=await buildMasterRestaurantActivity(String(req.params.id));res.json(activity);});
app.patch("/api/master/restaurants/:id",authenticateMaster,async(req:MasterAuthRequest,res:Response)=>{
  const parsed=masterRestaurantUpdate.safeParse(req.body);
  if(!parsed.success)return res.status(400).json({message:"Invalid platform restaurant update"});
  const restaurant=await prisma.restaurant.findUnique({where:{id:String(req.params.id)}});
  if(!restaurant)return res.status(404).json({message:"Restaurant not found"});
  res.locals.syncRestaurantId=restaurant.id;
  const data: Record<string, unknown> = {};
  const input = parsed.data as Record<string, unknown>;
  for (const key of ["isActive","planStatus","featuresLocked","featureLockReason","orderingEnabled","taxPercent","serviceChargePercent","brandColor","trialEndsAt"] as const) {
    if (input[key] !== undefined) data[key] = input[key];
  }
  if (parsed.data.orderPauseMessage !== undefined) data.orderPauseMessage = parsed.data.orderPauseMessage ?? "";
  if (parsed.data.logoUrl !== undefined) data.logoUrl = parsed.data.logoUrl ?? "";
  if (parsed.data.coverImageUrl !== undefined) data.coverImageUrl = parsed.data.coverImageUrl ?? "";
  if (parsed.data.plan) {
    data.plan = canonicalPlan(parsed.data.plan);
    data.featuresLocked = false;
    data.featureLockReason = null;
  }
  if (parsed.data.isActive === false) {
    data.featuresLocked = true;
    data.featureLockReason = "Restaurant suspended by master admin";
  }
  if (parsed.data.trialEndsAt) {
    data.planStatus = "trialing";
    data.featuresLocked = false;
    data.featureLockReason = null;
  }
  const updated=await prisma.$transaction(async tx=>{
    const row=await tx.restaurant.update({where:{id:restaurant.id},data});
    if(parsed.data.plan||parsed.data.planStatus){
      const subscriptionData:Record<string,unknown>={};
      if(parsed.data.plan)subscriptionData.plan=canonicalPlan(parsed.data.plan);
      if(parsed.data.planStatus)subscriptionData.status=parsed.data.planStatus.toUpperCase();
      await tx.subscription.updateMany({where:{restaurantId:restaurant.id},data:subscriptionData});
    }
    return row;
  });
  await writePlatformAudit(req.masterAdmin!.id,{restaurantId:restaurant.id,action:"restaurant.updated",targetType:"restaurant",targetId:restaurant.id,metadata:data});
  res.json(updated);
});
app.post("/api/master/restaurants/:id/trial",authenticateMaster,async(req:MasterAuthRequest,res:Response)=>{const parsed=z.object({days:z.number().int().min(1).max(30).default(14),reason:z.string().trim().max(240).optional()}).safeParse(req.body);if(!parsed.success)return res.status(400).json({message:"Invalid trial extension"});const restaurant=await prisma.restaurant.findUnique({where:{id:String(req.params.id)},include:{subscription:true}});if(!restaurant)return res.status(404).json({message:"Restaurant not found"});res.locals.syncRestaurantId=restaurant.id;const trialEndsAt=new Date(Date.now()+parsed.data.days*86400000);const updated=await prisma.$transaction(async tx=>{const row=await tx.restaurant.update({where:{id:restaurant.id},data:{planStatus:"trialing",trialEndsAt,featuresLocked:false,featureLockReason:null}});await tx.subscription.upsert({where:{restaurantId:restaurant.id},create:{restaurantId:restaurant.id,provider:"internal",plan:canonicalPlan(restaurant.plan),status:"TRIALING",currentPeriodStart:new Date(),currentPeriodEnd:trialEndsAt,retryCount:0,lastPaymentError:null,nextRetryAt:null},update:{plan:canonicalPlan(restaurant.plan),status:"TRIALING",currentPeriodStart:new Date(),currentPeriodEnd:trialEndsAt,cancelAtPeriodEnd:false,retryCount:0,lastPaymentError:null,nextRetryAt:null}});return row});await writePlatformAudit(req.masterAdmin!.id,{restaurantId:restaurant.id,action:"restaurant.trial_extended",targetType:"restaurant",targetId:restaurant.id,metadata:{days:parsed.data.days,reason:parsed.data.reason||null,trialEndsAt:trialEndsAt.toISOString()}});res.json(updated);});
app.post("/api/master/restaurants/:id/billing/retry",authenticateMaster,async(req:MasterAuthRequest,res:Response)=>{const restaurant=await prisma.restaurant.findUnique({where:{id:String(req.params.id)},include:{subscription:true}});if(!restaurant)return res.status(404).json({message:"Restaurant not found"});res.locals.syncRestaurantId=restaurant.id;const updated=await prisma.$transaction(async tx=>{const row=await tx.restaurant.update({where:{id:restaurant.id},data:{planStatus:"active",featuresLocked:false,featureLockReason:null}});await tx.subscription.updateMany({where:{restaurantId:restaurant.id},data:{status:"ACTIVE",retryCount:0,lastPaymentError:null,nextRetryAt:null,cancelAtPeriodEnd:false}});return row});await writePlatformAudit(req.masterAdmin!.id,{restaurantId:restaurant.id,action:"restaurant.billing_retried",targetType:"restaurant",targetId:restaurant.id,metadata:{subscriptionId:restaurant.subscription?.id||null}});res.json(updated);});
app.patch("/api/master/restaurants/:restaurantId/staff/:staffId",authenticateMaster,async(req:MasterAuthRequest,res:Response)=>{const parsed=masterStaffUpdate.safeParse(req.body);if(!parsed.success)return res.status(400).json({message:"Invalid staff update"});const restaurantId=String(req.params.restaurantId),staffId=String(req.params.staffId);const staff=await prisma.staffUser.findFirst({where:{id:staffId,restaurantId,role:{not:"OWNER"}}});if(!staff)return res.status(404).json({message:"Staff account not found"});res.locals.syncRestaurantId=restaurantId;const data=parsed.data;const updated=await prisma.$transaction(async tx=>{const row=await tx.staffUser.update({where:{id:staff.id},data,select:{id:true,name:true,phone:true,role:true,isActive:true,createdAt:true,lastLoginAt:true}});if(data.role||data.isActive===false)await tx.staffSession.updateMany({where:{staffUserId:staff.id,revokedAt:null},data:{revokedAt:new Date()}});return row});await writePlatformAudit(req.masterAdmin!.id,{restaurantId,action:"staff.updated",targetType:"staff-user",targetId:staff.id,metadata:data});res.json(updated);});
app.patch("/api/master/service-requests/:id",authenticateMaster,async(req:MasterAuthRequest,res:Response)=>{const parsed=z.enum(["OPEN","ACKNOWLEDGED","RESOLVED","CANCELLED"]).safeParse(req.body.status);if(!parsed.success)return res.status(400).json({message:"Invalid request status"});const request=await prisma.serviceRequest.findUnique({where:{id:String(req.params.id)},include:{restaurant:{select:{id:true}}}});if(!request)return res.status(404).json({message:"Service request not found"});const updated=await prisma.serviceRequest.update({where:{id:request.id},data:{status:parsed.data,resolvedAt:parsed.data==="RESOLVED"?new Date():null}});await writePlatformAudit(req.masterAdmin!.id,{restaurantId:request.restaurantId,action:`service-request.${parsed.data.toLowerCase()}`,targetType:"service-request",targetId:request.id,metadata:{status:parsed.data}});io.to(`restaurant:${updated.restaurantId}`).emit("service-request:updated",updated);io.to(`table:${updated.tableId}`).emit("service-request:updated",updated);res.json(updated);});
app.get("/api/master/audit-logs",authenticateMaster,async(req:MasterAuthRequest,res:Response)=>{const rows=await prisma.platformAuditLog.findMany({orderBy:{createdAt:"desc"},take:200,include:{admin:{select:{name:true,phone:true}},restaurant:{select:{name:true,slug:true}}}});res.json(rows);});
app.get("/api/admin/menu",authenticate,async(req:AuthRequest,res:Response)=>{ const categories=await prisma.menuCategory.findMany({where:{restaurantId:req.staff!.restaurantId},orderBy:{sortOrder:"asc"},include:{items:{where:{deletedAt:null},orderBy:{name:"asc"}}}});res.json(categories); });
app.post("/api/admin/assets",authenticate,authorize("OWNER","MANAGER","SUPERVISOR"),async(req:AuthRequest,res:Response)=>{const parsed=assetInput.safeParse(req.body);if(!parsed.success)return res.status(400).json({message:"Upload a PNG, JPEG, or WebP image under 3 MB"});const{extension,buffer}=decodeImage(parsed.data.data);if(buffer.length>3_000_000)return res.status(400).json({message:"Image must be under 3 MB"});const key=`${req.staff!.restaurantId}/assets/${parsed.data.kind}-${randomUUID()}.${extension}`,contentType=`image/${extension==="jpg"?"jpeg":extension}`;await prisma.mediaAsset.create({data:{key,restaurantId:req.staff!.restaurantId,kind:parsed.data.kind,contentType,data:buffer}});res.status(201).json({key,url:`${paymentApiOrigin(req)}/api/media?key=${encodeURIComponent(key)}`});});
app.post("/api/admin/menu/categories",authenticate,authorize("OWNER","MANAGER","SUPERVISOR"),async(req:AuthRequest,res:Response)=>{const parsed=categoryInput.safeParse(req.body);if(!parsed.success)return res.status(400).json({message:"Invalid category",issues:parsed.error.issues});res.status(201).json(await prisma.menuCategory.create({data:{...parsed.data,restaurantId:req.staff!.restaurantId}}));});
app.patch("/api/admin/menu/categories/:id",authenticate,authorize("OWNER","MANAGER","SUPERVISOR"),async(req:AuthRequest,res:Response)=>{const parsed=categoryInput.partial().safeParse(req.body);if(!parsed.success)return res.status(400).json({message:"Invalid category"});const category=await prisma.menuCategory.findFirst({where:{id:String(req.params.id),restaurantId:req.staff!.restaurantId}});if(!category)return res.status(404).json({message:"Category not found"});res.json(await prisma.menuCategory.update({where:{id:category.id},data:parsed.data}));});
app.post("/api/admin/menu/items",authenticate,authorize("OWNER","MANAGER","SUPERVISOR"),async(req:AuthRequest,res:Response)=>{ const parsed=itemInput.safeParse(req.body);if(!parsed.success)return res.status(400).json({message:"Invalid menu item",issues:parsed.error.issues});const capacity=await enforcePlanCapacity(req.staff!.restaurantId,"menuItems");if(capacity)return res.status(402).json(capacity);const category=await prisma.menuCategory.findFirst({where:{id:parsed.data.categoryId,restaurantId:req.staff!.restaurantId}});if(!category)return res.status(404).json({message:"Category not found"});const item=await prisma.menuItem.create({data:{...parsed.data,restaurantId:req.staff!.restaurantId}});res.status(201).json(item); });
app.patch("/api/admin/menu/items/:id",authenticate,authorize("OWNER","MANAGER","SUPERVISOR"),async(req:AuthRequest,res:Response)=>{ const parsed=itemInput.partial().safeParse(req.body);if(!parsed.success)return res.status(400).json({message:"Invalid menu item"});const item=await prisma.menuItem.findFirst({where:{id:String(req.params.id),restaurantId:req.staff!.restaurantId}});if(!item)return res.status(404).json({message:"Menu item not found"});if(parsed.data.categoryId){const category=await prisma.menuCategory.findFirst({where:{id:parsed.data.categoryId,restaurantId:req.staff!.restaurantId}});if(!category)return res.status(404).json({message:"Category not found"});}res.json(await prisma.menuItem.update({where:{id:item.id},data:parsed.data})); });
app.delete("/api/admin/menu/items/:id",authenticate,authorize("OWNER","MANAGER","SUPERVISOR"),async(req:AuthRequest,res:Response)=>{const item=await prisma.menuItem.findFirst({where:{id:String(req.params.id),restaurantId:req.staff!.restaurantId,deletedAt:null}});if(!item)return res.status(404).json({message:"Menu item not found"});await prisma.menuItem.update({where:{id:item.id},data:{isAvailable:false,deletedAt:new Date()}});res.status(204).end();});
app.get("/api/admin/menu/items/:id/options",authenticate,async(req:AuthRequest,res:Response)=>{const item=await prisma.menuItem.findFirst({where:{id:String(req.params.id),restaurantId:req.staff!.restaurantId}});if(!item)return res.status(404).json({message:"Menu item not found"});res.json(await prisma.menuItemOption.findMany({where:{menuItemId:item.id},orderBy:{name:"asc"}}));});
app.post("/api/admin/menu/items/:id/options",authenticate,authorize("OWNER","MANAGER","SUPERVISOR"),async(req:AuthRequest,res:Response)=>{const parsed=optionInput.safeParse(req.body);if(!parsed.success)return res.status(400).json({message:"Invalid option"});const item=await prisma.menuItem.findFirst({where:{id:String(req.params.id),restaurantId:req.staff!.restaurantId}});if(!item)return res.status(404).json({message:"Menu item not found"});res.status(201).json(await prisma.menuItemOption.create({data:{...parsed.data,menuItemId:item.id}}));});
app.patch("/api/admin/menu/options/:id",authenticate,authorize("OWNER","MANAGER","SUPERVISOR"),async(req:AuthRequest,res:Response)=>{const parsed=optionInput.partial().safeParse(req.body);if(!parsed.success)return res.status(400).json({message:"Invalid option"});const option=await prisma.menuItemOption.findFirst({where:{id:String(req.params.id),menuItem:{restaurantId:req.staff!.restaurantId}}});if(!option)return res.status(404).json({message:"Option not found"});res.json(await prisma.menuItemOption.update({where:{id:option.id},data:parsed.data}));});
app.delete("/api/admin/menu/options/:id",authenticate,authorize("OWNER","MANAGER","SUPERVISOR"),async(req:AuthRequest,res:Response)=>{const option=await prisma.menuItemOption.findFirst({where:{id:String(req.params.id),menuItem:{restaurantId:req.staff!.restaurantId}}});if(!option)return res.status(404).json({message:"Option not found"});await prisma.menuItemOption.delete({where:{id:option.id}});res.status(204).end();});
app.get("/api/admin/settings",authenticate,authorize("OWNER","MANAGER","SUPERVISOR"),async(req:AuthRequest,res:Response)=>{const restaurant=await prisma.restaurant.findUnique({where:{id:req.staff!.restaurantId},select:{orderingEnabled:true,orderPauseMessage:true,taxPercent:true,serviceChargePercent:true,plan:true,planStatus:true,trialEndsAt:true,featuresLocked:true,featureLockReason:true,logoUrl:true,coverImageUrl:true,brandColor:true}});res.json(restaurant);});
app.get("/api/admin/entitlements",authenticate,async(req:AuthRequest,res:Response)=>{res.json(await planEntitlements(req.staff!.restaurantId));});
app.get("/api/admin/audit-events",authenticate,authorizeCapability("audit.read"),async(req:AuthRequest,res:Response)=>{
  const parsed=z.object({cursor:z.string().uuid().optional(),limit:z.coerce.number().int().min(1).max(100).default(50),action:z.string().trim().max(160).optional(),resourceType:z.string().trim().max(80).optional()}).safeParse(req.query);
  if(!parsed.success)return res.status(400).json({message:"Invalid audit filters"});
  const rows=await prisma.enterpriseAuditEvent.findMany({
    where:{restaurantId:req.staff!.restaurantId,...(parsed.data.action?{action:parsed.data.action}:{}),...(parsed.data.resourceType?{resourceType:parsed.data.resourceType}:{})},
    orderBy:[{occurredAt:"desc"},{id:"desc"}],
    take:parsed.data.limit+1,
    ...(parsed.data.cursor?{cursor:{id:parsed.data.cursor},skip:1}:{}),
  });
  const hasMore=rows.length>parsed.data.limit,items=hasMore?rows.slice(0,parsed.data.limit):rows;
  res.json({items,nextCursor:hasMore?items.at(-1)?.id:null});
});
app.get("/api/admin/audit-events/verify",authenticate,authorizeCapability("audit.read"),async(req:AuthRequest,res:Response)=>{
  res.json(await verifyAuditChain(prisma,req.staff!.restaurantId));
});
app.get("/api/admin/billing",authenticate,authorize("OWNER"),async(req:AuthRequest,res:Response)=>{const[subscription,restaurant]=await Promise.all([prisma.subscription.findUnique({where:{restaurantId:req.staff!.restaurantId}}),prisma.restaurant.findUnique({where:{id:req.staff!.restaurantId},select:{plan:true}})]);const invoices=await prisma.invoice.findMany({where:{restaurantId:req.staff!.restaurantId},orderBy:{createdAt:"desc"},take:24});let mandateAuthorized=false;if(subscription?.status==="TRIALING"&&subscription.provider==="razorpay"&&subscription.providerSubscriptionId){try{const provider=await fetchRazorpaySubscription(subscription.providerSubscriptionId);mandateAuthorized=provider?.status==="authenticated"||provider?.status==="active"}catch{mandateAuthorized=false}}res.json({subscription,currentPlan:canonicalPlan(restaurant?.plan||subscription?.plan||"starter"),mandateAuthorized,invoices,plans:Object.entries(PLAN_PRICES).filter(([plan])=>plan!=="pro").map(([plan,amount])=>({plan,amount,currency:"INR",limits:PLAN_LIMITS[plan]}))});});
app.post("/api/admin/billing/verify-mandate",authenticate,authorize("OWNER"),async(req:AuthRequest,res:Response)=>{
  const parsed=mandateVerificationInput.safeParse(req.body);
  if(!parsed.success)return res.status(400).json({message:"Razorpay returned an invalid mandate confirmation"});
  const subscription=await prisma.subscription.findUnique({where:{restaurantId:req.staff!.restaurantId}});
  if(!subscription?.providerSubscriptionId||subscription.providerSubscriptionId!==parsed.data.razorpay_subscription_id)return res.status(409).json({message:"That mandate does not belong to this restaurant"});
  const config=razorpayBillingConfig();
  if(!config)return res.status(503).json({message:"Razorpay billing is not configured"});
  const expected=createMandateSignature(parsed.data.razorpay_payment_id,subscription.providerSubscriptionId,config.keySecret);
  if(!secureSignatureEqual(parsed.data.razorpay_signature,expected))return res.status(401).json({message:"Razorpay mandate signature verification failed"});
  let provider:null|{status?:string}=null;
  try{provider=await fetchRazorpaySubscription(subscription.providerSubscriptionId)}catch{provider=null}
  await prisma.subscription.update({where:{id:subscription.id},data:{provider:"razorpay",status:subscription.currentPeriodEnd>new Date()?"TRIALING":"PAST_DUE",cancelAtPeriodEnd:false,retryCount:0,lastPaymentError:null,nextRetryAt:null}});
  await prisma.restaurant.update({where:{id:req.staff!.restaurantId},data:subscription.currentPeriodEnd>new Date()?{planStatus:"trialing",featuresLocked:false,featureLockReason:null}:{planStatus:"past_due"}});
  res.json({verified:true,subscriptionId:subscription.providerSubscriptionId,status:provider?.status||"authenticated"});
});
app.post("/api/admin/billing/checkout",authenticate,authorize("OWNER"),async(req:AuthRequest,res:Response)=>{
  const parsed=billingPlanInput.safeParse(req.body);
  if(!parsed.success)return res.status(400).json({message:"Choose a valid plan"});
  const plan=canonicalPlan(parsed.data.plan),current=await prisma.subscription.findUnique({where:{restaurantId:req.staff!.restaurantId}}),now=new Date(),trialActive=Boolean(current?.status==="TRIALING"&&current.currentPeriodEnd>now),periodEnd=new Date(now.getTime()+30*86400000);
  if(trialActive){
    let providerSubscriptionId=current!.providerSubscriptionId;
    let checkoutUrl:string|null=null;
    let mandateAuthorized=false;
    try{
      if(current!.provider==="razorpay"&&providerSubscriptionId&&current!.plan!==plan){
        await cancelRazorpaySubscription(providerSubscriptionId,false);
        providerSubscriptionId=null;
      }
      if(providerSubscriptionId){
        const provider=await fetchRazorpaySubscription(providerSubscriptionId);
        if(provider?.status==="cancelled"||provider?.status==="completed"||provider?.status==="expired")providerSubscriptionId=null;
        else{
          checkoutUrl=provider?.short_url||null;
          mandateAuthorized=provider?.status==="authenticated"||provider?.status==="active";
        }
      }
      if(!providerSubscriptionId){
        const provider=await createRazorpaySubscription(plan,req.staff!.restaurantId,current!.currentPeriodEnd);
        if(!provider)return res.status(503).json({message:"Razorpay recurring billing is not configured yet. Your free trial remains active."});
        providerSubscriptionId=provider.id;
        checkoutUrl=provider.short_url||null;
      }
    }catch(error){return res.status(502).json({message:error instanceof Error?error.message:"Razorpay could not prepare the recurring mandate"})}
    const subscription=await prisma.subscription.update({where:{id:current!.id},data:{provider:"razorpay",providerSubscriptionId,plan,status:"TRIALING",cancelAtPeriodEnd:false}});
    await prisma.restaurant.update({where:{id:req.staff!.restaurantId},data:{plan,planStatus:"trialing",featuresLocked:false,featureLockReason:null}});
    return res.status(201).json({checkoutUrl,subscriptionId:subscription.id,providerSubscriptionId,plan,amount:PLAN_PRICES[plan],currency:"INR",mandateAuthorized,message:mandateAuthorized?`Mandate authorized. Your first charge is scheduled for ${current!.currentPeriodEnd.toISOString()}`:`Authorize the recurring mandate now. You will not be charged before ${current!.currentPeriodEnd.toISOString()}`});
  }
  if(current?.provider==="razorpay"&&current.providerSubscriptionId){
    try{
      const change=await updateRazorpaySubscription(current.providerSubscriptionId,plan);
      if(change.mode==="updated"){
        const provider=change.subscription as {current_start?:number;current_end?:number};
        const subscription=await prisma.subscription.update({where:{id:current.id},data:{plan,status:"ACTIVE",currentPeriodStart:provider.current_start?new Date(provider.current_start*1000):current.currentPeriodStart,currentPeriodEnd:provider.current_end?new Date(provider.current_end*1000):current.currentPeriodEnd,cancelAtPeriodEnd:false,retryCount:0,lastPaymentError:null,nextRetryAt:null}});
        await prisma.restaurant.update({where:{id:req.staff!.restaurantId},data:{plan,planStatus:"active",featuresLocked:false,featureLockReason:null,trialEndsAt:null}});
        return res.status(201).json({checkoutUrl:null,subscriptionId:subscription.id,providerSubscriptionId:current.providerSubscriptionId,plan,amount:PLAN_PRICES[plan],currency:"INR",message:"Razorpay updated the subscription plan"});
      }
    }catch(error){return res.status(502).json({message:error instanceof Error?error.message:"Razorpay could not change the subscription"})}
  }
  let providerSubscription;
  try{providerSubscription=await createRazorpaySubscription(plan,req.staff!.restaurantId)}catch(error){return res.status(502).json({message:error instanceof Error?error.message:"Razorpay could not create the subscription"})}
  if(process.env.NODE_ENV==="production"&&!providerSubscription)return res.status(503).json({message:"Razorpay billing is required to activate paid plans in production"});
  if(providerSubscription){
    const subscription=await prisma.subscription.upsert({
      where:{restaurantId:req.staff!.restaurantId},
      create:{restaurantId:req.staff!.restaurantId,provider:"razorpay",providerSubscriptionId:providerSubscription.id,plan,status:"PAST_DUE",currentPeriodStart:now,currentPeriodEnd:periodEnd,retryCount:0,lastPaymentError:null,nextRetryAt:null},
      update:{provider:"razorpay",providerSubscriptionId:providerSubscription.id,plan,status:"PAST_DUE",currentPeriodStart:now,currentPeriodEnd:periodEnd,cancelAtPeriodEnd:false,retryCount:0,lastPaymentError:null,nextRetryAt:null}
    });
    await prisma.restaurant.update({where:{id:req.staff!.restaurantId},data:{plan,planStatus:"past_due",featuresLocked:true,featureLockReason:"Complete payment in Razorpay to activate this plan",trialEndsAt:null}});
    return res.status(201).json({checkoutUrl:providerSubscription.short_url||null,subscriptionId:subscription.id,providerSubscriptionId:providerSubscription.id,plan,amount:PLAN_PRICES[plan],currency:"INR",message:"Complete payment in the Razorpay checkout"});
  }
  const subscription=await prisma.subscription.upsert({
    where:{restaurantId:req.staff!.restaurantId},
    create:{restaurantId:req.staff!.restaurantId,provider:"internal",plan,status:"ACTIVE",currentPeriodStart:now,currentPeriodEnd:periodEnd,cancelAtPeriodEnd:false},
    update:{provider:"internal",plan,status:"ACTIVE",currentPeriodStart:now,currentPeriodEnd:periodEnd,cancelAtPeriodEnd:false}
  });
  await prisma.restaurant.update({where:{id:req.staff!.restaurantId},data:{plan,planStatus:"active",featuresLocked:false,featureLockReason:null,trialEndsAt:null}});
  res.status(201).json({checkoutUrl:null,subscriptionId:subscription.id,plan,amount:PLAN_PRICES[plan],currency:"INR",message:"Plan activated"});
});
app.post("/api/admin/billing/change-plan",authenticate,authorize("OWNER"),async(req:AuthRequest,res:Response)=>{
  const parsed=billingPlanInput.safeParse(req.body);
  if(!parsed.success)return res.status(400).json({message:"Choose a valid plan"});
  const current=await prisma.subscription.findUnique({where:{restaurantId:req.staff!.restaurantId}});
  if(!current)return res.status(404).json({message:"No subscription checkout has been started"});
  const plan=canonicalPlan(parsed.data.plan),now=new Date(),end=new Date(now.getTime()+30*86400000),trialActive=current.status==="TRIALING"&&current.currentPeriodEnd>now;
  if(trialActive){
    const subscription=await prisma.subscription.update({where:{id:current.id},data:{plan,status:"TRIALING",currentPeriodStart:now,currentPeriodEnd:current.currentPeriodEnd,cancelAtPeriodEnd:false}});
    await prisma.restaurant.update({where:{id:req.staff!.restaurantId},data:{plan,planStatus:"trialing",featuresLocked:false,featureLockReason:null,trialEndsAt:current.currentPeriodEnd}});
    return res.json(subscription);
  }
  if(current.provider==="razorpay"&&current.providerSubscriptionId){
    try{
      const change=await updateRazorpaySubscription(current.providerSubscriptionId,plan);
      if(change.mode==="updated"){
        const provider=change.subscription as {current_start?:number;current_end?:number};
        const subscription=await prisma.subscription.update({where:{id:current.id},data:{plan,status:"ACTIVE",currentPeriodStart:provider.current_start?new Date(provider.current_start*1000):current.currentPeriodStart,currentPeriodEnd:provider.current_end?new Date(provider.current_end*1000):current.currentPeriodEnd,cancelAtPeriodEnd:false,retryCount:0,lastPaymentError:null,nextRetryAt:null}});
        await prisma.restaurant.update({where:{id:req.staff!.restaurantId},data:{plan,planStatus:"active",featuresLocked:false,featureLockReason:null,trialEndsAt:null}});
        return res.json(subscription);
      }
    }catch(error){return res.status(502).json({message:error instanceof Error?error.message:"Razorpay could not change the subscription"})}
  }
  let providerSubscription;
  try{providerSubscription=await createRazorpaySubscription(plan,req.staff!.restaurantId)}catch(error){return res.status(502).json({message:error instanceof Error?error.message:"Razorpay could not create the subscription"})}
  if(process.env.NODE_ENV==="production"&&!providerSubscription)return res.status(503).json({message:"Razorpay billing is required to change plans in production"});
  if(providerSubscription){
    const subscription=await prisma.subscription.update({where:{id:current.id},data:{provider:"razorpay",providerSubscriptionId:providerSubscription.id,plan,status:"PAST_DUE",currentPeriodStart:now,currentPeriodEnd:end,cancelAtPeriodEnd:false}});
    await prisma.restaurant.update({where:{id:req.staff!.restaurantId},data:{plan,planStatus:"past_due",featuresLocked:true,featureLockReason:"Complete payment in Razorpay to activate this plan",trialEndsAt:null}});
    return res.json(subscription);
  }
  const subscription=await prisma.subscription.update({where:{id:current.id},data:{provider:"internal",plan,status:"ACTIVE",currentPeriodStart:now,currentPeriodEnd:end,cancelAtPeriodEnd:false}});
  await prisma.restaurant.update({where:{id:req.staff!.restaurantId},data:{plan,planStatus:"active",featuresLocked:false,featureLockReason:null,trialEndsAt:null}});
  res.json(subscription);
});
app.post("/api/admin/billing/cancel",authenticate,authorize("OWNER"),async(req:AuthRequest,res:Response)=>{const subscription=await prisma.subscription.findUnique({where:{restaurantId:req.staff!.restaurantId}});if(!subscription)return res.status(404).json({message:"No active subscription"});if(subscription.cancelAtPeriodEnd)return res.json(subscription);const cancelImmediately=subscription.status==="TRIALING";if(subscription.provider==="razorpay"&&subscription.providerSubscriptionId){try{await cancelRazorpaySubscription(subscription.providerSubscriptionId,!cancelImmediately)}catch(error){return res.status(502).json({message:error instanceof Error?error.message:"Razorpay could not schedule cancellation"})}}const updated=await prisma.subscription.update({where:{id:subscription.id},data:{cancelAtPeriodEnd:true}});res.json(updated);});
app.patch("/api/admin/settings",authenticate,authorize("OWNER","MANAGER","SUPERVISOR"),async(req:AuthRequest,res:Response)=>{const parsed=settingsInput.safeParse(req.body);if(!parsed.success)return res.status(400).json({message:"Invalid restaurant settings"});res.json(await prisma.restaurant.update({where:{id:req.staff!.restaurantId},data:parsed.data,select:{orderingEnabled:true,orderPauseMessage:true,taxPercent:true,serviceChargePercent:true,plan:true,planStatus:true,trialEndsAt:true,featuresLocked:true,featureLockReason:true,logoUrl:true,coverImageUrl:true,brandColor:true}}));});
app.get("/api/admin/support-tickets",authenticate,authorize("OWNER","MANAGER","SUPERVISOR"),async(req:AuthRequest,res:Response)=>{const rows=await prisma.restaurantSupportTicket.findMany({where:{restaurantId:req.staff!.restaurantId},orderBy:{createdAt:"desc"},take:20});res.json(rows.map(row=>({...row,createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString(),resolvedAt:row.resolvedAt?.toISOString()||null})));});
app.post("/api/admin/support-tickets",authenticate,authorize("OWNER","MANAGER","SUPERVISOR"),async(req:AuthRequest,res:Response)=>{const parsed=supportTicketInput.safeParse(req.body);if(!parsed.success)return res.status(400).json({message:"Complete the support ticket details",issues:parsed.error.issues});const ticket=await prisma.restaurantSupportTicket.create({data:{...parsed.data,restaurantId:req.staff!.restaurantId}});res.status(201).json({...ticket,createdAt:ticket.createdAt.toISOString(),updatedAt:ticket.updatedAt.toISOString()});});
app.post("/api/table/service-requests",authenticateTable,async(req:TableRequest,res:Response)=>{const parsed=serviceRequestInput.safeParse(req.body);if(!parsed.success)return res.status(400).json({message:"Invalid service request"});const restaurant=await prisma.restaurant.findUnique({where:{id:req.tableSession!.restaurantId},select:{featuresLocked:true,featureLockReason:true}});if(restaurant?.featuresLocked)return res.status(423).json({message:restaurant.featureLockReason||"Restaurant features are locked",code:"FEATURES_LOCKED"});const created=await prisma.serviceRequest.create({data:{restaurantId:req.tableSession!.restaurantId,tableId:req.tableSession!.tableId,type:parsed.data.type,note:parsed.data.note},include:{table:{select:{label:true,code:true}}}});const{table,...request}=created,publicRequest={...request,tableLabel:table.label,tableCode:table.code};io.to(`restaurant:${request.restaurantId}`).emit("service-request:new",publicRequest);void sendRestaurantPush(prisma,request.restaurantId,{kind:"waiter-call",title:`Waiter requested · ${table.label}`,body:request.note?`${table.label} needs service: ${request.note}`:`${table.label} has called for service.`,tag:`waiter-call-${request.id}`});res.status(201).json(publicRequest);});
app.get("/api/table/service-requests",authenticateTable,async(req:TableRequest,res:Response)=>{const rows=await prisma.serviceRequest.findMany({where:{restaurantId:req.tableSession!.restaurantId,tableId:req.tableSession!.tableId,type:"WAITER",status:{in:["OPEN","ACKNOWLEDGED"]}},orderBy:{createdAt:"asc"}});res.setHeader("Cache-Control","no-store");res.json(rows);});
app.get("/api/admin/service-requests",authenticate,authorize("OWNER","MANAGER","SUPERVISOR","WAITER"),async(req:AuthRequest,res:Response)=>{const rows=await prisma.serviceRequest.findMany({where:{restaurantId:req.staff!.restaurantId,status:{in:["OPEN","ACKNOWLEDGED"]}},include:{table:{select:{label:true,code:true}}},orderBy:{createdAt:"asc"}});res.json(rows.map(({table,...request})=>({...request,tableLabel:table.label,tableCode:table.code})));});
app.patch("/api/admin/service-requests/:id",authenticate,authorize("OWNER","MANAGER","SUPERVISOR","WAITER"),idempotentMutation,async(req:AuthRequest,res:Response)=>{const status=z.enum(["ACKNOWLEDGED","RESOLVED"]).safeParse(req.body.status);if(!status.success)return res.status(400).json({message:'Choose "Acknowledged" or "Taken Care"'});const request=await prisma.serviceRequest.findFirst({where:{id:String(req.params.id),restaurantId:req.staff!.restaurantId,status:{in:["OPEN","ACKNOWLEDGED"]}}});if(!request)return res.status(404).json({message:"Open service request not found"});if(status.data==="ACKNOWLEDGED"&&request.status!=="OPEN")return res.status(409).json({message:"Only open requests can be acknowledged"});const row=await prisma.serviceRequest.update({where:{id:request.id},data:{status:status.data,resolvedAt:status.data==="RESOLVED"?new Date():null},include:{table:{select:{label:true,code:true}}}});const{table,...updated}=row,publicRequest={...updated,tableLabel:table.label,tableCode:table.code};io.to(`restaurant:${updated.restaurantId}`).emit("service-request:updated",publicRequest);io.to(`table:${updated.tableId}`).emit("service-request:updated",publicRequest);res.json(publicRequest);});
app.post("/api/orders/:id/feedback",async(req:Request,res:Response)=>{const parsed=feedbackInput.safeParse(req.body);if(!parsed.success)return res.status(400).json({message:"Submit a rating from 1 to 5"});const order=await prisma.order.findFirst({where:{displayId:String(req.params.id),trackingToken:parsed.data.trackingToken,status:"SERVED",paymentMode:"upi",paymentStatus:"PAID"}});if(!order)return res.status(404).json({message:"Feedback is available after a confirmed UPI order is served"});res.locals.syncRestaurantId=order.restaurantId;const feedback=await prisma.feedback.upsert({where:{orderId:order.id},create:{restaurantId:order.restaurantId,orderId:order.id,rating:parsed.data.rating,comment:parsed.data.comment},update:{rating:parsed.data.rating,comment:parsed.data.comment}});void sendRestaurantPush(prisma,order.restaurantId,{kind:"feedback-received",title:`New ${parsed.data.rating}-star feedback`,body:parsed.data.comment?`${order.tableLabel} · ${parsed.data.comment.slice(0,120)}`:`${order.tableLabel} · Order ${order.displayId}`,tag:`feedback-${order.displayId}`,url:"/?page=history"});res.status(201).json(feedback);});
app.get("/api/admin/feedback",authenticate,authorize("OWNER","MANAGER","SUPERVISOR"),async(req:AuthRequest,res:Response)=>{const rows=await prisma.feedback.findMany({where:{restaurantId:req.staff!.restaurantId},orderBy:{createdAt:"desc"},take:100});const summary=rows.reduce((acc,row)=>{acc.count++;acc.total+=row.rating;return acc},{count:0,total:0});res.json({averageRating:summary.count?Number((summary.total/summary.count).toFixed(2)):0,count:summary.count,items:rows});});
app.get("/api/admin/tables",authenticate,authorize("OWNER","MANAGER","SUPERVISOR","WAITER"),async(req:AuthRequest,res:Response)=>{
  const restaurantId=req.staff!.restaurantId;
  const[tables,activeOrders,servedOrders]=await Promise.all([
    prisma.table.findMany({where:{restaurantId,deletedAt:null},orderBy:{label:"asc"},select:{id:true,label:true,code:true,isActive:true,lastClearedAt:true,_count:{select:{orders:{where:{paymentStatus:{not:"PENDING"}}}}}}}),
    prisma.order.findMany({where:{restaurantId,status:{in:["NEW","ACCEPTED","PREPARING","READY"]},paymentStatus:{not:"PENDING"}},orderBy:{createdAt:"desc"},select:{displayId:true,tableId:true,status:true,createdAt:true}}),
    prisma.order.findMany({where:{restaurantId,status:"SERVED",paymentStatus:{not:"PENDING"}},orderBy:{createdAt:"desc"},distinct:["tableId"],select:{displayId:true,tableId:true,status:true,createdAt:true}}),
  ]);
  res.json(tables.map(table=>{const active=activeOrders.filter(order=>order.tableId===table.id),latest=active[0]||servedOrders.find(order=>order.tableId===table.id)||null,needsClearing=!active.length&&!!latest&&latest.status==="SERVED"&&(!table.lastClearedAt||latest.createdAt>table.lastClearedAt);return{id:table.id,label:table.label,code:table.code,isActive:table.isActive,_count:table._count,serviceStatus:!table.isActive?"DISABLED":active.length?"OCCUPIED":needsClearing?"READY_TO_CLEAR":"AVAILABLE",activeOrderCount:active.length,latestOrder:latest?{id:latest.displayId,status:latest.status.toLowerCase(),createdAt:latest.createdAt.toISOString()}:null};}));
});
app.post("/api/admin/tables",authenticate,authorize("OWNER","MANAGER","SUPERVISOR"),async(req:AuthRequest,res:Response)=>{const parsed=tableInput.safeParse(req.body);if(!parsed.success)return res.status(400).json({message:"Invalid table",issues:parsed.error.issues});const capacity=await enforcePlanCapacity(req.staff!.restaurantId,"tables");if(capacity)return res.status(402).json(capacity);const exists=await prisma.table.findFirst({where:{restaurantId:req.staff!.restaurantId,code:parsed.data.code}});if(exists){if(exists.deletedAt)return res.status(201).json(await prisma.table.update({where:{id:exists.id},data:{label:parsed.data.label,isActive:true,deletedAt:null}}));return res.status(409).json({message:"That table code already exists"});}res.status(201).json(await prisma.table.create({data:{...parsed.data,restaurantId:req.staff!.restaurantId}}));});
app.patch("/api/admin/tables/:id",authenticate,authorize("OWNER","MANAGER","SUPERVISOR"),async(req:AuthRequest,res:Response)=>{const parsed=tableInput.partial().safeParse(req.body);if(!parsed.success)return res.status(400).json({message:"Invalid table"});const table=await prisma.table.findFirst({where:{id:String(req.params.id),restaurantId:req.staff!.restaurantId,deletedAt:null}});if(!table)return res.status(404).json({message:"Table not found"});if(parsed.data.code){const duplicate=await prisma.table.findFirst({where:{restaurantId:req.staff!.restaurantId,code:parsed.data.code,deletedAt:null,id:{not:table.id}},select:{id:true}});if(duplicate)return res.status(409).json({message:"That table code is already in use"});}res.json(await prisma.table.update({where:{id:table.id},data:parsed.data}));});
app.delete("/api/admin/tables/:id",authenticate,authorize("OWNER","MANAGER","SUPERVISOR"),async(req:AuthRequest,res:Response)=>{const table=await prisma.table.findFirst({where:{id:String(req.params.id),restaurantId:req.staff!.restaurantId,deletedAt:null}});if(!table)return res.status(404).json({message:"Table not found"});if(table.isActive)return res.status(409).json({message:"Disable this table before deleting it"});await prisma.table.update({where:{id:table.id},data:{deletedAt:new Date()}});res.status(204).end();});
app.post("/api/admin/tables/:id/clear",authenticate,authorize("OWNER","MANAGER","SUPERVISOR","WAITER"),idempotentMutation,async(req:AuthRequest,res:Response)=>{const table=await prisma.table.findFirst({where:{id:String(req.params.id),restaurantId:req.staff!.restaurantId}});if(!table)return res.status(404).json({message:"Table not found"});const activeOrders=await prisma.order.count({where:{tableId:table.id,restaurantId:req.staff!.restaurantId,status:{in:["NEW","ACCEPTED","PREPARING","READY"]},paymentStatus:{not:"PENDING"}}});if(activeOrders)return res.status(409).json({message:"This table still has active orders. Serve or reject them before clearing the table."});await prisma.table.update({where:{id:table.id},data:{lastClearedAt:new Date()}});res.json({id:table.id,serviceStatus:"AVAILABLE"});});
app.get("/api/admin/tables/:id/qr",authenticate,authorize("OWNER","MANAGER","SUPERVISOR"),async(req:AuthRequest,res:Response)=>{const table=await prisma.table.findFirst({where:{id:String(req.params.id),restaurantId:req.staff!.restaurantId}});if(!table)return res.status(404).json({message:"Table not found"});const base=process.env.CUSTOMER_ORIGIN||"http://localhost:5173",url=`${base}/t/${table.qrToken}`,options={margin:2,width:1024,color:{dark:"#17372b",light:"#ffffff"}};res.json({url,svg:await QRCode.toString(url,{...options,type:"svg"}),pngDataUrl:await QRCode.toDataURL(url,{...options,type:"image/png"})});});
app.get("/api/admin/payment-methods",authenticate,authorize("OWNER","MANAGER","SUPERVISOR","CASHIER"),async(req:AuthRequest,res:Response)=>{const methods=await prisma.paymentMethod.findMany({where:{restaurantId:req.staff!.restaurantId,deletedAt:null},orderBy:{createdAt:"asc"}});res.json(methods.map(method=>({...method,qrImageData:method.qrImageKey?`${req.protocol}://${req.get("host")}/api/payment-qr/${method.id}`:method.qrImageData||""})));});
app.post("/api/admin/payment-methods",authenticate,authorize("OWNER","MANAGER"),async(req:AuthRequest,res:Response)=>{const parsed=paymentMethodInput.safeParse(req.body);if(!parsed.success)return res.status(400).json({message:"Enter a valid receiving UPI ID",issues:parsed.error.issues});const{qrImageData,...data}=parsed.data;let qrImageKey:string|null=null;if(qrImageData){const{extension,buffer}=decodeImage(qrImageData);if(buffer.length>1_000_000)return res.status(400).json({message:"QR image must be under 1 MB"});qrImageKey=`${req.staff!.restaurantId}-${randomUUID()}.${extension}`;await qrStorage.put(qrImageKey,{buffer,contentType:`image/${extension==="jpg"?"jpeg":extension}`});}const method=await prisma.paymentMethod.create({data:{...data,qrImageKey,restaurantId:req.staff!.restaurantId}});res.status(201).json({...method,qrImageData:qrImageKey?`${req.protocol}://${req.get("host")}/api/payment-qr/${method.id}`:""});});
app.patch("/api/admin/payment-methods/:id",authenticate,authorize("OWNER","MANAGER"),async(req:AuthRequest,res:Response)=>{const parsed=paymentMethodUpdateInput.safeParse(req.body);if(!parsed.success)return res.status(400).json({message:"Invalid payment method update",issues:parsed.error.issues});const method=await prisma.paymentMethod.findFirst({where:{id:String(req.params.id),restaurantId:req.staff!.restaurantId}});if(!method)return res.status(404).json({message:"Payment method not found"});res.json(await prisma.paymentMethod.update({where:{id:method.id},data:parsed.data}));});
app.get("/api/admin/card-merchant",authenticate,authorize("OWNER","MANAGER"),async(req:AuthRequest,res:Response)=>{const restaurant=await prisma.restaurant.findUnique({where:{id:req.staff!.restaurantId},select:{cardPaymentProvider:true,cardMerchantKeyId:true,cardPaymentsEnabled:true,cardMerchantVerifiedAt:true}});res.json({provider:restaurant?.cardPaymentProvider||"razorpay",maskedKeyId:maskMerchantKey(restaurant?.cardMerchantKeyId||null),connected:!!restaurant?.cardMerchantVerifiedAt,enabled:!!restaurant?.cardPaymentsEnabled,testMode:restaurant?.cardMerchantKeyId?.startsWith("rzp_test_")||false,webhookUrl:`${paymentApiOrigin(req)}/api/payments/razorpay/webhook/${req.staff!.restaurantId}`,verifiedAt:restaurant?.cardMerchantVerifiedAt?.toISOString()||null});});
app.put("/api/admin/card-merchant",authenticate,authorize("OWNER"),async(req:AuthRequest,res:Response)=>{const parsed=cardMerchantInput.safeParse(req.body);if(!parsed.success)return res.status(400).json({message:"Enter a valid Razorpay Key ID and Key Secret",issues:parsed.error.issues});let verification:globalThis.Response;try{verification=await razorpayRequest("/payments?count=1",parsed.data.keyId,parsed.data.keySecret)}catch{return res.status(502).json({message:"Could not reach Razorpay. Try again shortly."})}if(!verification.ok)return res.status(400).json({message:"Razorpay rejected those API keys. Check the mode and regenerate the secret if needed."});const webhookSecret=randomBytes(32).toString("hex"),live=parsed.data.keyId.startsWith("rzp_live_");const restaurant=await prisma.restaurant.update({where:{id:req.staff!.restaurantId},data:{cardPaymentProvider:"razorpay",cardMerchantKeyId:parsed.data.keyId,cardMerchantSecretCiphertext:encryptMerchantSecret(parsed.data.keySecret),cardWebhookSecretCiphertext:encryptMerchantSecret(webhookSecret),cardPaymentsEnabled:live,cardMerchantVerifiedAt:new Date()},select:{cardPaymentProvider:true,cardMerchantKeyId:true,cardPaymentsEnabled:true,cardMerchantVerifiedAt:true}});res.json({provider:restaurant.cardPaymentProvider,maskedKeyId:maskMerchantKey(restaurant.cardMerchantKeyId),connected:true,enabled:restaurant.cardPaymentsEnabled,testMode:!live,webhookUrl:`${paymentApiOrigin(req)}/api/payments/razorpay/webhook/${req.staff!.restaurantId}`,webhookSecret,verifiedAt:restaurant.cardMerchantVerifiedAt?.toISOString()||null});});
app.delete("/api/admin/card-merchant",authenticate,authorize("OWNER"),async(req:AuthRequest,res:Response)=>{await prisma.restaurant.update({where:{id:req.staff!.restaurantId},data:{cardPaymentProvider:null,cardMerchantKeyId:null,cardMerchantSecretCiphertext:null,cardWebhookSecretCiphertext:null,cardPaymentsEnabled:false,cardMerchantVerifiedAt:null}});res.status(204).end();});
app.post("/api/admin/orders/:id/refund",authenticate,authorize("OWNER","MANAGER","SUPERVISOR"),async(req:AuthRequest,res:Response)=>{
  const refundReason=z.string().trim().min(4).max(300).safeParse(req.body?.reason);if(!refundReason.success)return res.status(400).json({message:"Enter a refund reason"});
  const order=await prisma.order.findFirst({where:{displayId:String(req.params.id),restaurantId:req.staff!.restaurantId,paymentStatus:"PAID",paymentMode:"card"},include:{restaurant:true,items:true,paymentMethod:true}});
  if(!order?.providerPaymentId||!order.restaurant.cardMerchantKeyId||!order.restaurant.cardMerchantSecretCiphertext)return res.status(404).json({message:"Refundable card payment not found"});
  const secret=decryptMerchantSecret(order.restaurant.cardMerchantSecretCiphertext);
  let response:globalThis.Response;
  try{response=await razorpayRequest(`/payments/${encodeURIComponent(order.providerPaymentId)}/refund`,order.restaurant.cardMerchantKeyId,secret,{method:"POST",body:JSON.stringify({amount:order.totalAmount*100,notes:{orderId:order.displayId,restaurantId:order.restaurantId,reason:refundReason.data}})})}catch{return res.status(502).json({message:"Could not reach Razorpay"})}
  const refund=await response.json().catch(()=>({})) as {id?:string;payment_id?:string;amount?:number;currency?:string;status?:string;error?:{description?:string}};
  if(!response.ok||!refund.id)return res.status(502).json({message:refund.error?.description||"Razorpay rejected the refund"});
  const reconciliation=await recordProviderReconciliation(prisma,{restaurantId:order.restaurantId,orderId:order.id,kind:"REFUND",provider:"razorpay",expectedAmount:order.totalAmount*100,expectedCurrency:"INR",expectedOrderReference:order.providerPaymentId,localStatus:"requested",providerState:{reference:refund.id,orderReference:refund.payment_id||order.providerPaymentId,amount:refund.amount??order.totalAmount*100,currency:refund.currency||"INR",status:refund.status||"pending"},source:"manual"});
  if(reconciliation.status==="MISMATCH")return res.status(409).json({message:"Razorpay returned refund details that do not match this order",code:reconciliation.mismatchCode});
  const updated=await prisma.order.update({where:{id:order.id},data:{refundId:refund.id,refundStatus:refund.status||"pending",paymentStatus:refund.status==="processed"?"REFUNDED":"PAID",nextRetryAt:reconciliation.nextCheckAt},include:{items:true,paymentMethod:true}});
  if(refund.status==="processed")await issueCreditNote(prisma,order.id,refund.id,refundReason.data);
  const publicOrder=toOrder(updated);io.to(`restaurant:${publicOrder.restaurantId}`).emit("order:updated",publicOrder);io.to(`table:${publicOrder.tableId}`).emit("order:updated",publicOrder);res.json(publicOrder);
});
app.get("/api/admin/payment-reconciliation",authenticate,authorizeCapability("payments.read"),async(req:AuthRequest,res:Response)=>{
  const parsed=z.object({status:z.enum(["PENDING","MATCHED","MISMATCH","MANUAL_REVIEW","FAILED","RESOLVED"]).optional(),limit:z.coerce.number().int().min(1).max(250).default(100)}).safeParse(req.query);
  if(!parsed.success)return res.status(400).json({message:"Invalid reconciliation filters"});
  const rows=await prisma.paymentReconciliation.findMany({where:{restaurantId:req.staff!.restaurantId,...(parsed.data.status?{status:parsed.data.status}:{})},include:{order:{select:{displayId:true,tableLabel:true,paymentStatus:true,paymentMode:true}}},orderBy:{updatedAt:"desc"},take:parsed.data.limit});
  res.json(rows);
});
app.post("/api/admin/payment-reconciliation/:orderId/run",authenticate,authorizeCapability("payments.confirm"),async(req:AuthRequest,res:Response)=>{
  const order=await prisma.order.findFirst({where:{displayId:String(req.params.orderId),restaurantId:req.staff!.restaurantId},include:{restaurant:true}});
  if(!order)return res.status(404).json({message:"Order not found"});
  if(order.paymentMode==="upi")return res.status(409).json({message:"Manual UPI payments are reconciled only when restaurant staff confirms the external payment"});
  if(!order.restaurant.cardMerchantKeyId||!order.restaurant.cardMerchantSecretCiphertext)return res.status(409).json({message:"Razorpay merchant connection is unavailable"});
  const result=await reconcileRazorpayOrder(prisma,{orderId:order.id,keyId:order.restaurant.cardMerchantKeyId,secret:decryptMerchantSecret(order.restaurant.cardMerchantSecretCiphertext),request:razorpayRequest,source:"manual"});
  if(!result)return res.status(409).json({message:"This order has no provider payment or refund reference"});
  res.json(result);
});
app.delete("/api/admin/payment-methods/:id",authenticate,authorize("OWNER","MANAGER"),async(req:AuthRequest,res:Response)=>{const method=await prisma.paymentMethod.findFirst({where:{id:String(req.params.id),restaurantId:req.staff!.restaurantId,deletedAt:null}});if(!method)return res.status(404).json({message:"Payment method not found"});if(method.isActive)return res.status(409).json({message:"Disable this payment method before deleting it"});await prisma.paymentMethod.update({where:{id:method.id},data:{deletedAt:new Date()}});if(method.qrImageKey)await qrStorage.delete(method.qrImageKey).catch(()=>{});res.status(204).end();});
app.get("/api/admin/staff",authenticate,authorize("OWNER"),async(req:AuthRequest,res:Response)=>{res.json(await prisma.staffUser.findMany({where:{restaurantId:req.staff!.restaurantId},select:{id:true,name:true,phone:true,firebaseUid:true,role:true,isActive:true,createdAt:true,lastLoginAt:true},orderBy:{createdAt:"asc"}}));});
app.post("/api/admin/staff",authenticate,authorize("OWNER"),async(req:AuthRequest,res:Response)=>{
  const parsed=staffInput.safeParse(req.body);if(!parsed.success)return res.status(400).json({message:"Invalid staff account",issues:parsed.error.issues});
  const capacity=await enforcePlanCapacity(req.staff!.restaurantId,"staff");if(capacity)return res.status(402).json(capacity);
  const phone=parsed.data.phone.trim(),phoneExists=await prisma.staffUser.findUnique({where:{phone}});if(phoneExists)return res.status(409).json({message:"That phone number is already linked to a staff account"});
  const location=await prisma.restaurant.findUnique({where:{id:req.staff!.restaurantId},select:{organizationId:true}});
  if(!location)return res.status(404).json({message:"Location not found"});
  const staff=await prisma.staffUser.create({data:{restaurantId:req.staff!.restaurantId,name:parsed.data.name,phone,role:parsed.data.role,organizationMemberships:{create:{organizationId:location.organizationId,role:"MEMBER"}}},select:{id:true,name:true,phone:true,firebaseUid:true,role:true,isActive:true,createdAt:true,lastLoginAt:true}});
  res.status(201).json(staff);
});
app.patch("/api/admin/staff/:id",authenticate,authorize("OWNER"),async(req:AuthRequest,res:Response)=>{const parsed=z.object({name:z.string().trim().min(2).max(80).optional(),role:z.enum(["MANAGER","SUPERVISOR","CASHIER","WAITER","KITCHEN"]).optional(),isActive:z.boolean().optional()}).safeParse(req.body);if(!parsed.success)return res.status(400).json({message:"Invalid staff update"});const staff=await prisma.staffUser.findFirst({where:{id:String(req.params.id),restaurantId:req.staff!.restaurantId,role:{not:"OWNER"}}});if(!staff)return res.status(404).json({message:"Staff account not found"});const updated=await prisma.$transaction(async tx=>{const member=await tx.staffUser.update({where:{id:staff.id},data:parsed.data,select:{id:true,name:true,phone:true,firebaseUid:true,role:true,isActive:true,createdAt:true,lastLoginAt:true}});if(parsed.data.isActive===false||parsed.data.role)await tx.staffSession.updateMany({where:{staffUserId:staff.id,revokedAt:null},data:{revokedAt:new Date()}});return member});res.json(updated);});
app.get("/api/admin/orders/history",authenticate,authorize("OWNER","MANAGER","SUPERVISOR","CASHIER","WAITER"),async(req:AuthRequest,res:Response)=>{const query=z.object({page:z.coerce.number().int().min(1).default(1),limit:z.coerce.number().int().min(1).max(100).default(25),status:z.enum(["NEW","ACCEPTED","PREPARING","READY","SERVED","CANCELLED"]).optional(),from:z.coerce.date().optional(),to:z.coerce.date().optional()}).safeParse(req.query);if(!query.success)return res.status(400).json({message:"Invalid history filters"});const where={restaurantId:req.staff!.restaurantId,paymentStatus:{not:"PENDING" as const},...(query.data.status?{status:query.data.status}:{}),...((query.data.from||query.data.to)?{createdAt:{...(query.data.from?{gte:query.data.from}:{}),...(query.data.to?{lte:query.data.to}:{})}}:{})};const[rows,total]=await prisma.$transaction([prisma.order.findMany({where,include:{items:true,paymentMethod:true},orderBy:{createdAt:"desc"},skip:(query.data.page-1)*query.data.limit,take:query.data.limit}),prisma.order.count({where})]);res.json({orders:rows.map(toOrder),total,page:query.data.page,pages:Math.ceil(total/query.data.limit)});});
app.get("/api/admin/analytics/summary",authenticate,authorize("OWNER","MANAGER","SUPERVISOR"),async(req:AuthRequest,res:Response)=>{const entitlements=await planEntitlements(req.staff!.restaurantId),query=z.object({days:z.coerce.number().int().min(1).optional(),from:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),to:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()}).safeParse(req.query);if(!query.success)return res.status(400).json({message:"Invalid analytics date range"});const to=query.data.to?new Date(`${query.data.to}T23:59:59.999`):endOfDay(new Date()),requestedDays=query.data.days||7,from=query.data.from?new Date(`${query.data.from}T00:00:00`):new Date(to.getTime()-(requestedDays-1)*86400000);if(Number.isNaN(from.getTime())||Number.isNaN(to.getTime())||from>to)return res.status(400).json({message:"Choose a valid analytics date range"});const days=Math.floor((startOfDay(to).getTime()-startOfDay(from).getTime())/86400000)+1;if(days>entitlements.limits.analyticsDays)return res.status(403).json({message:`Your plan supports analytics ranges up to ${entitlements.limits.analyticsDays} days`,code:"ANALYTICS_RANGE_LIMIT"});const orders=await prisma.order.findMany({where:{restaurantId:req.staff!.restaurantId,createdAt:{gte:from,lte:to},status:{not:"CANCELLED"},paymentStatus:{not:"PENDING"}},include:{items:true}});const daily=new Map<string,{date:string;orders:number;revenue:number}>(),items=new Map<string,{name:string;quantity:number;revenue:number}>();for(let index=0;index<days;index++){const date=new Date(from);date.setDate(date.getDate()+index);const key=date.toISOString().slice(0,10);daily.set(key,{date:key,orders:0,revenue:0})}for(const order of orders){const date=order.createdAt.toISOString().slice(0,10),day=daily.get(date)||{date,orders:0,revenue:0};day.orders++;if(order.paymentStatus==="PAID"||order.paymentStatus==="PAY_AT_COUNTER")day.revenue+=order.totalAmount;daily.set(date,day);for(const item of order.items){const stat=items.get(item.menuItemId)||{name:item.name,quantity:0,revenue:0};stat.quantity+=item.quantity;stat.revenue+=item.quantity*item.unitPrice;items.set(item.menuItemId,stat)}}res.json({days,from:query.data.from||from.toISOString().slice(0,10),to:query.data.to||to.toISOString().slice(0,10),totalOrders:orders.length,revenue:[...daily.values()].reduce((sum,d)=>sum+d.revenue,0),daily:[...daily.values()].sort((a,b)=>a.date.localeCompare(b.date)),topItems:[...items.values()].sort((a,b)=>b.quantity-a.quantity).slice(0,5)});});
io.use(async(socket,next)=>{
  const token=socket.handshake.auth.token;
  if(!token)return next();
  try{
    const issuer=(jwt.decode(token)as {iss?:string}|null)?.iss;
    if(issuer==="white_label-master"){
      const master=jwt.verify(token,JWT_SECRET,{issuer:"white_label-master"})as {id:string;sessionId:string};
      const session=await prisma.platformAdminSession.findFirst({where:{id:master.sessionId,adminId:master.id,revokedAt:null,expiresAt:{gt:new Date()}},include:{admin:{select:{isActive:true}}}});
      if(!session?.admin.isActive)throw new Error("Invalid master session");
      socket.data.master=master;
      return next();
    }
    if(issuer==="white_label-table"){
      const tablePayload=jwt.verify(token,JWT_SECRET,{issuer:"white_label-table"})as {type?:string;restaurantId:string;tableId:string};
      if(tablePayload.type!=="table")throw new Error("Invalid table session");
      socket.data.table=tablePayload;
      return next();
    }
    if(issuer!=="white-label-restaurant-platform")throw new Error("Invalid token issuer");
    const payload=jwt.verify(token,JWT_SECRET,{issuer:"white-label-restaurant-platform"})as NonNullable<AuthRequest["staff"]>;
    const session=await prisma.staffSession.findFirst({
      where:{id:payload.sessionId,staffUserId:payload.id,revokedAt:null,expiresAt:{gt:new Date()}},
      include:{staffUser:{select:{isActive:true}}}
    });
    if(!session||!session.staffUser.isActive)return next(new Error("Invalid session"));
    const context=await organizationContext(payload.id,payload.restaurantId);
    if(!context)return next(new Error("Location access denied"));
    socket.data.staff={...payload,role:context.effectiveRole};
    return next();
  }catch{return next(new Error("Invalid session"))}
});
io.on("connection",async socket=>{
  if(socket.data.master)await socket.join("platform-admins");
  if(socket.data.staff?.restaurantId)await socket.join(`restaurant:${socket.data.staff.restaurantId}`);
  if(socket.data.table?.tableId)await socket.join(`table:${socket.data.table.tableId}`);
  socket.emit("sync:ready",{master:Boolean(socket.data.master),restaurantId:socket.data.staff?.restaurantId||null,tableId:socket.data.table?.tableId||null});
  socket.on("join:platform",async(ack?:(joined:boolean)=>void)=>{const allowed=Boolean(socket.data.master);if(allowed)await socket.join("platform-admins");ack?.(allowed)});
  socket.on("join:restaurant",async(id:string,ack?:(joined:boolean)=>void)=>{const allowed=socket.data.staff?.restaurantId===id;if(allowed)await socket.join(`restaurant:${id}`);ack?.(allowed)});
  socket.on("join:table",async(id:string,ack?:(joined:boolean)=>void)=>{const allowed=socket.data.table?.tableId===id;if(allowed)await socket.join(`table:${id}`);ack?.(allowed)});
});
const outboxTimer=setInterval(()=>{
  void processOutboxBatch(prisma,async event=>{
    const payload={...(event.payload as Record<string,unknown>),eventId:event.id,durable:true};
    if(event.restaurantId){
      io.to(`restaurant:${event.restaurantId}`).emit("restaurant:sync",{restaurantId:event.restaurantId,...payload});
      io.to("platform-admins").emit("platform:sync",{restaurantId:event.restaurantId,...payload});
      await deliverDeveloperWebhooks(prisma,event,PAYMENT_CREDENTIALS_SECRET);
      return;
    }
    io.to("platform-admins").emit("platform:sync",{restaurantId:event.restaurantId,...payload});
  }).catch(error=>console.error("Outbox processing failed",error));
},1_000);
outboxTimer.unref();
const idempotencyCleanupTimer=setInterval(()=>{
  void prisma.mutationIdempotencyKey.deleteMany({where:{expiresAt:{lt:new Date()}}}).catch(error=>console.error("Idempotency cleanup failed",error));
},60*60*1_000);
idempotencyCleanupTimer.unref();
const paymentReconciliationTimer=setInterval(()=>{
  void (async()=>{
    const candidates=await prisma.order.findMany({
      where:{
        paymentMode:"card",
        OR:[
          {providerOrderId:{not:null},paymentStatus:"PENDING",refundId:null},
          {refundId:{not:null},refundStatus:{not:"processed"}},
        ],
        restaurant:{cardPaymentsEnabled:true,cardMerchantKeyId:{not:null},cardMerchantSecretCiphertext:{not:null}},
        AND:[{OR:[{nextRetryAt:null},{nextRetryAt:{lte:new Date()}}]}],
      },
      include:{restaurant:{select:{cardMerchantKeyId:true,cardMerchantSecretCiphertext:true}}},
      orderBy:{updatedAt:"asc"},
      take:25,
    });
    for(const order of candidates){
      const keyId=order.restaurant.cardMerchantKeyId,encrypted=order.restaurant.cardMerchantSecretCiphertext;
      if(!keyId||!encrypted)continue;
      await reconcileRazorpayOrder(prisma,{orderId:order.id,keyId,secret:decryptMerchantSecret(encrypted),request:razorpayRequest}).catch(error=>console.error("Payment reconciliation failed",order.displayId,error));
    }
  })().catch(error=>console.error("Payment reconciliation worker failed",error));
},30_000);
paymentReconciliationTimer.unref();
app.use((error:unknown,_req:Request,res:Response,_next:NextFunction)=>{console.error(error);res.status(500).json({message:"Unexpected server error"});});
const masterAdminPhone = process.env.MASTER_ADMIN_PHONE?.trim();
if (masterAdminPhone) {
  const existingMasterAdmin = await prisma.platformAdmin.findFirst({ where: { phone: masterAdminPhone } });
  if (!existingMasterAdmin) {
    await prisma.platformAdmin.create({
      data: { phone: masterAdminPhone, name: "Restaurant Platform Platform Admin" },
    });
  }
}

server.listen(PORT,()=>console.log(`Restaurant Platform API running at http://localhost:${PORT}`));
async function shutdown(){clearInterval(outboxTimer);clearInterval(idempotencyCleanupTimer);clearInterval(paymentReconciliationTimer);await Promise.all([prisma.$disconnect(),redisSubscriber?.quit(),redisClient?.quit()]);server.close(()=>process.exit(0));} process.on("SIGINT",shutdown);process.on("SIGTERM",shutdown);

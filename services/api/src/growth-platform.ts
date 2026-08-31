import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import type { Express, NextFunction, Request, Response } from "express";
import { AuditActorType, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { appendAuditEvent } from "./enterprise-audit.js";

type AuthRequest=Request&{staff?:{id:string;restaurantId:string;role:string;sessionId:string}};
type Auth=(req:AuthRequest,res:Response,next:NextFunction)=>unknown;
type CapabilityAuth=(capability:any)=>Auth;
const DEVELOPER_SCOPES=["menu.read","orders.read","loyalty.read"] as const;
const WEBHOOK_EVENTS=["restaurant.sync","order.created","order.updated","payment.updated","inventory.updated","reservation.updated"] as const;

export function calculateEarnedPoints(totalAmountRupees:number,pointsPerRupee:number){
  if(!Number.isFinite(totalAmountRupees)||totalAmountRupees<0||!Number.isFinite(pointsPerRupee)||pointsPerRupee<0)throw new Error("Loyalty values must be non-negative numbers");
  return Math.floor(totalAmountRupees*pointsPerRupee);
}

export function hashDeveloperKey(value:string){return createHash("sha256").update(value).digest("hex")}
export function signWebhookPayload(secret:string,timestamp:string,payload:string){return createHmac("sha256",secret).update(`${timestamp}.${payload}`).digest("hex")}
export function integrationEventTopic(pathname:string,method:string){
  if(pathname==="/api/orders"&&method==="POST")return"order.created";
  if(pathname.includes("/payment")||pathname.includes("/refund")||pathname.includes("/card-"))return"payment.updated";
  if(pathname.includes("/inventory")||pathname.includes("/procurement"))return"inventory.updated";
  if(pathname.includes("/reservations")||pathname.includes("/waitlist"))return"reservation.updated";
  if(pathname.includes("/orders/"))return"order.updated";
  return"restaurant.sync";
}

export function isBlockedWebhookHostname(hostname:string){
  const value=hostname.toLowerCase().replace(/\.$/,"");
  if(value==="localhost"||value.endsWith(".localhost")||value.endsWith(".local")||value.endsWith(".internal"))return true;
  const ip=isIP(value);if(!ip)return false;
  if(ip===4){
    const parts=value.split(".").map(Number);
    return parts[0]===10||parts[0]===127||parts[0]===0||parts[0]===169&&parts[1]===254||parts[0]===172&&parts[1]>=16&&parts[1]<=31||parts[0]===192&&parts[1]===168||parts[0]>=224;
  }
  return value==="::1"||value==="::"||value.startsWith("fc")||value.startsWith("fd")||value.startsWith("fe8")||value.startsWith("fe9")||value.startsWith("fea")||value.startsWith("feb");
}

async function assertPublicWebhookUrl(raw:string){
  const url=new URL(raw);if(url.protocol!=="https:"||url.username||url.password||url.port&&url.port!=="443"||isBlockedWebhookHostname(url.hostname))throw new Error("Webhook URL must be a public HTTPS endpoint");
  const addresses=await lookup(url.hostname,{all:true,verbatim:true});if(!addresses.length||addresses.some(entry=>isBlockedWebhookHostname(entry.address)))throw new Error("Webhook URL resolved to a private or unavailable address");
  return{url,address:addresses[0]};
}

async function postWebhook(rawUrl:string,headers:Record<string,string>,payload:string){
  const{url,address}=await assertPublicWebhookUrl(rawUrl);
  return new Promise<{status:number;body:string}>((resolve,reject)=>{
    const request=httpsRequest(url,{method:"POST",headers:{...headers,"content-length":Buffer.byteLength(payload)},lookup:(_hostname,_options,callback)=>callback(null,address.address,address.family)},response=>{
      const chunks:Buffer[]=[];let size=0;
      response.on("data",(chunk:Buffer)=>{if(size<1000){chunks.push(chunk.subarray(0,1000-size));size+=chunk.length}});
      response.on("end",()=>resolve({status:response.statusCode||0,body:Buffer.concat(chunks).toString("utf8")}));
    });
    request.setTimeout(10_000,()=>request.destroy(new Error("Webhook delivery timed out")));
    request.on("error",reject);request.end(payload);
  });
}

function encryptSecret(value:string,encryptionSecret:string){
  const key=createHash("sha256").update(encryptionSecret).digest(),iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",key,iv),encrypted=Buffer.concat([cipher.update(value,"utf8"),cipher.final()]);
  return[iv.toString("base64"),cipher.getAuthTag().toString("base64"),encrypted.toString("base64")].join(".");
}
function decryptSecret(value:string,encryptionSecret:string){
  const[iv,tag,encrypted]=value.split("."),key=createHash("sha256").update(encryptionSecret).digest(),decipher=createDecipheriv("aes-256-gcm",key,Buffer.from(iv,"base64"));decipher.setAuthTag(Buffer.from(tag,"base64"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted,"base64")),decipher.final()]).toString("utf8");
}

export async function awardLoyaltyForOrder(prisma:PrismaClient,orderId:string,guestId:string){
  const order=await prisma.order.findUnique({where:{id:orderId},include:{restaurant:{include:{loyaltyProgram:true}}}});
  const program=order?.restaurant.loyaltyProgram;if(!order||!program?.isActive||!["PAID","PAY_AT_COUNTER"].includes(order.paymentStatus))return null;
  const guest=await prisma.guestProfile.findFirst({where:{id:guestId,restaurantId:order.restaurantId}});
  if(!guest)return null;
  const points=calculateEarnedPoints(order.totalAmount,Number(program.pointsPerRupee));if(points<=0)return null;
  return prisma.$transaction(async tx=>{
    const existing=await tx.loyaltyTransaction.findUnique({where:{restaurantId_idempotencyKey:{restaurantId:order.restaurantId,idempotencyKey:`order:${order.id}:earn`}}});if(existing)return existing;
    const account=await tx.loyaltyAccount.upsert({where:{guestId:guest.id},create:{restaurantId:order.restaurantId,guestId:guest.id},update:{}});
    const updated=await tx.loyaltyAccount.update({where:{id:account.id},data:{pointsBalance:{increment:points},lifetimeEarned:{increment:points}}});
    return tx.loyaltyTransaction.create({data:{restaurantId:order.restaurantId,loyaltyAccountId:account.id,orderId:order.id,type:"EARN",points,balanceAfter:updated.pointsBalance,reason:`Order ${order.displayId}`,idempotencyKey:`order:${order.id}:earn`}});
  });
}

export async function deliverDeveloperWebhooks(prisma:PrismaClient,event:{id:string;restaurantId:string|null;topic:string;aggregateType:string;aggregateId:string|null;payload:unknown;createdAt:Date},encryptionSecret:string){
  if(!event.restaurantId)return{endpoints:0,failed:0};
  const endpoints=await prisma.webhookEndpoint.findMany({where:{restaurantId:event.restaurantId,isActive:true,OR:[{subscribedEvents:{has:event.topic}},{subscribedEvents:{has:"restaurant.sync"}}]}});
  let failed=0;
  for(const endpoint of endpoints){
    const existing=await prisma.webhookDelivery.findUnique({where:{endpointId_outboxEventId:{endpointId:endpoint.id,outboxEventId:event.id}}});
    if(existing?.status==="DELIVERED")continue;
    const delivery=existing||await prisma.webhookDelivery.create({data:{restaurantId:event.restaurantId,endpointId:endpoint.id,outboxEventId:event.id,eventType:event.topic}});
    try{
      const payload=JSON.stringify({id:event.id,type:event.topic,createdAt:event.createdAt.toISOString(),restaurantId:event.restaurantId,data:event.payload}),timestamp=Math.floor(Date.now()/1000).toString(),signature=signWebhookPayload(decryptSecret(endpoint.secretCiphertext,encryptionSecret),timestamp,payload);
      const response=await postWebhook(endpoint.url,{"content-type":"application/json","user-agent":"Restaurant Platform-Webhooks/1.0","x-white_label-event":event.topic,"x-white_label-delivery":delivery.id,"x-white_label-timestamp":timestamp,"x-white_label-signature":`v1=${signature}`},payload);
      if(response.status<200||response.status>=300)throw Object.assign(new Error(`Webhook returned HTTP ${response.status}`),response);
      await prisma.$transaction([prisma.webhookDelivery.update({where:{id:delivery.id},data:{status:"DELIVERED",attemptCount:{increment:1},responseStatus:response.status,responseBody:response.body,lastError:null,deliveredAt:new Date()}}),prisma.webhookEndpoint.update({where:{id:endpoint.id},data:{consecutiveFailures:0,lastDeliveredAt:new Date()}})]);
    }catch(error){
      failed++;const details=error as Error&{status?:number;body?:string};
      await prisma.$transaction([prisma.webhookDelivery.update({where:{id:delivery.id},data:{status:"FAILED",attemptCount:{increment:1},responseStatus:details.status,responseBody:details.body,lastError:(details.message||"Delivery failed").slice(0,1000)}}),prisma.webhookEndpoint.update({where:{id:endpoint.id},data:{consecutiveFailures:{increment:1},lastFailedAt:new Date()}})]);
    }
  }
  if(failed)throw new Error(`${failed} integration webhook delivery attempt(s) failed`);
  return{endpoints:endpoints.length,failed};
}

export function registerGrowthPlatform(app:Express,prisma:PrismaClient,authenticate:Auth,authorizeCapability:CapabilityAuth,encryptionSecret:string){
  app.get("/api/admin/growth/loyalty",authenticate,authorizeCapability("growth.read"),async(req:AuthRequest,res)=>{
    const[program,accounts]=await Promise.all([prisma.loyaltyProgram.findUnique({where:{restaurantId:req.staff!.restaurantId}}),prisma.loyaltyAccount.findMany({where:{restaurantId:req.staff!.restaurantId},include:{guest:true},orderBy:{pointsBalance:"desc"},take:300})]);res.json({program,accounts});
  });
  app.put("/api/admin/growth/loyalty",authenticate,authorizeCapability("growth.manage"),async(req:AuthRequest,res)=>{
    const parsed=z.object({name:z.string().trim().min(2).max(100),pointsPerRupee:z.coerce.number().min(0).max(100),redemptionValuePaise:z.number().int().min(1).max(100000),minimumRedeemPoints:z.number().int().min(1).max(1000000),isActive:z.boolean()}).safeParse(req.body);if(!parsed.success)return res.status(400).json({message:"Enter a valid loyalty program"});
    res.json(await prisma.loyaltyProgram.upsert({where:{restaurantId:req.staff!.restaurantId},create:{...parsed.data,restaurantId:req.staff!.restaurantId},update:parsed.data}));
  });
  app.post("/api/admin/growth/loyalty/members",authenticate,authorizeCapability("growth.manage"),async(req:AuthRequest,res)=>{
    const parsed=z.object({name:z.string().trim().min(2).max(100),phone:z.string().trim().regex(/^\+?[0-9]{10,15}$/),email:z.string().email().optional(),consent:z.literal(true)}).safeParse(req.body);if(!parsed.success)return res.status(400).json({message:"Explicit guest consent and valid contact details are required"});
    const guest=await prisma.guestProfile.upsert({where:{restaurantId_phone:{restaurantId:req.staff!.restaurantId,phone:parsed.data.phone}},create:{restaurantId:req.staff!.restaurantId,name:parsed.data.name,phone:parsed.data.phone,email:parsed.data.email,consentAt:new Date(),tags:["loyalty"]},update:{name:parsed.data.name,email:parsed.data.email,consentAt:new Date(),tags:{push:"loyalty"}}});
    res.status(201).json(await prisma.loyaltyAccount.upsert({where:{guestId:guest.id},create:{restaurantId:req.staff!.restaurantId,guestId:guest.id},update:{},include:{guest:true}}));
  });
  app.post("/api/admin/growth/loyalty/accounts/:id/earn-order",authenticate,authorizeCapability("growth.manage"),async(req:AuthRequest,res)=>{
    const parsed=z.object({orderDisplayId:z.string().trim().min(3)}).safeParse(req.body);if(!parsed.success)return res.status(400).json({message:"Enter an order number"});
    const[account,order]=await Promise.all([prisma.loyaltyAccount.findFirst({where:{id:String(req.params.id),restaurantId:req.staff!.restaurantId}}),prisma.order.findFirst({where:{displayId:parsed.data.orderDisplayId,restaurantId:req.staff!.restaurantId}})]);if(!account||!order)return res.status(404).json({message:"Member or order not found"});
    const transaction=await awardLoyaltyForOrder(prisma,order.id,account.guestId);if(!transaction)return res.status(409).json({message:"The loyalty program must be active and the order financially confirmed"});
    res.status(201).json(transaction);
  });
  app.post("/api/admin/growth/loyalty/accounts/:id/adjust",authenticate,authorizeCapability("growth.manage"),async(req:AuthRequest,res)=>{
    const parsed=z.object({points:z.number().int().min(-1000000).max(1000000).refine(value=>value!==0),reason:z.string().trim().min(4).max(300),idempotencyKey:z.string().uuid()}).safeParse(req.body);if(!parsed.success)return res.status(400).json({message:"Enter a non-zero adjustment and reason"});
    const account=await prisma.loyaltyAccount.findFirst({where:{id:String(req.params.id),restaurantId:req.staff!.restaurantId}});if(!account||account.pointsBalance+parsed.data.points<0)return res.status(409).json({message:"Adjustment would make the points balance negative"});
    const transaction=await prisma.$transaction(async tx=>{const existing=await tx.loyaltyTransaction.findUnique({where:{restaurantId_idempotencyKey:{restaurantId:req.staff!.restaurantId,idempotencyKey:parsed.data.idempotencyKey}}});if(existing)return existing;const updated=await tx.loyaltyAccount.update({where:{id:account.id},data:{pointsBalance:{increment:parsed.data.points},...(parsed.data.points>0?{lifetimeEarned:{increment:parsed.data.points}}:{lifetimeRedeemed:{increment:Math.abs(parsed.data.points)}})}});return tx.loyaltyTransaction.create({data:{restaurantId:req.staff!.restaurantId,loyaltyAccountId:account.id,type:"ADJUSTMENT",points:parsed.data.points,balanceAfter:updated.pointsBalance,reason:parsed.data.reason,idempotencyKey:parsed.data.idempotencyKey,createdBy:req.staff!.id}})});
    await appendAuditEvent(prisma,{restaurantId:req.staff!.restaurantId,actor:{type:AuditActorType.STAFF,id:req.staff!.id,role:req.staff!.role},action:"loyalty.balance_adjusted",resourceType:"loyalty-account",resourceId:account.id,metadata:{points:parsed.data.points,reason:parsed.data.reason,transactionId:transaction.id}});res.status(201).json(transaction);
  });
  const promotionInput=z.object({code:z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,24}$/),name:z.string().trim().min(2).max(100),description:z.string().max(300).default(""),discountType:z.enum(["PERCENT","FIXED"]),discountValue:z.number().int().positive(),minimumSpend:z.number().int().nonnegative().default(0),maximumDiscount:z.number().int().positive().optional(),startsAt:z.coerce.date(),endsAt:z.coerce.date(),usageLimit:z.number().int().positive().optional(),isActive:z.boolean().default(true)}).refine(data=>data.endsAt>data.startsAt&&!(data.discountType==="PERCENT"&&data.discountValue>100),{message:"Promotion dates or discount are invalid"});
  app.get("/api/admin/growth/promotions",authenticate,authorizeCapability("growth.read"),async(req:AuthRequest,res)=>res.json(await prisma.promotion.findMany({where:{restaurantId:req.staff!.restaurantId},orderBy:{createdAt:"desc"},take:300})));
  app.post("/api/admin/growth/promotions",authenticate,authorizeCapability("growth.manage"),async(req:AuthRequest,res)=>{const parsed=promotionInput.safeParse(req.body);if(!parsed.success)return res.status(400).json({message:"Enter a valid promotion"});res.status(201).json(await prisma.promotion.create({data:{...parsed.data,restaurantId:req.staff!.restaurantId}}))});
  app.patch("/api/admin/growth/promotions/:id",authenticate,authorizeCapability("growth.manage"),async(req:AuthRequest,res)=>{const parsed=promotionInput.partial().safeParse(req.body);if(!parsed.success)return res.status(400).json({message:"Invalid promotion update"});const row=await prisma.promotion.findFirst({where:{id:String(req.params.id),restaurantId:req.staff!.restaurantId}});if(!row)return res.status(404).json({message:"Promotion not found"});res.json(await prisma.promotion.update({where:{id:row.id},data:parsed.data}))});

  app.get("/api/admin/integrations/api-keys",authenticate,authorizeCapability("integrations.read"),async(req:AuthRequest,res)=>res.json(await prisma.developerApiKey.findMany({where:{restaurantId:req.staff!.restaurantId},select:{id:true,name:true,keyPrefix:true,scopes:true,lastUsedAt:true,expiresAt:true,revokedAt:true,createdAt:true},orderBy:{createdAt:"desc"}})));
  app.post("/api/admin/integrations/api-keys",authenticate,authorizeCapability("integrations.manage"),async(req:AuthRequest,res)=>{const parsed=z.object({name:z.string().trim().min(2).max(80),scopes:z.array(z.enum(DEVELOPER_SCOPES)).min(1),expiresAt:z.coerce.date().optional()}).safeParse(req.body);if(!parsed.success||parsed.data.expiresAt&&parsed.data.expiresAt<=new Date())return res.status(400).json({message:"Choose valid API key scopes and expiry"});const secret=`kn_live_${randomBytes(24).toString("base64url")}`,row=await prisma.developerApiKey.create({data:{restaurantId:req.staff!.restaurantId,name:parsed.data.name,keyPrefix:secret.slice(0,14),secretHash:hashDeveloperKey(secret),scopes:parsed.data.scopes,expiresAt:parsed.data.expiresAt,createdBy:req.staff!.id}});res.status(201).json({id:row.id,name:row.name,keyPrefix:row.keyPrefix,scopes:row.scopes,createdAt:row.createdAt,secret})});
  app.delete("/api/admin/integrations/api-keys/:id",authenticate,authorizeCapability("integrations.manage"),async(req:AuthRequest,res)=>{const row=await prisma.developerApiKey.findFirst({where:{id:String(req.params.id),restaurantId:req.staff!.restaurantId,revokedAt:null}});if(!row)return res.status(404).json({message:"Active API key not found"});await prisma.developerApiKey.update({where:{id:row.id},data:{revokedAt:new Date()}});res.status(204).end()});
  app.get("/api/admin/integrations/webhooks",authenticate,authorizeCapability("integrations.read"),async(req:AuthRequest,res)=>res.json(await prisma.webhookEndpoint.findMany({where:{restaurantId:req.staff!.restaurantId},select:{id:true,name:true,url:true,subscribedEvents:true,isActive:true,consecutiveFailures:true,lastDeliveredAt:true,lastFailedAt:true,createdAt:true},orderBy:{createdAt:"desc"}})));
  app.get("/api/admin/integrations/webhook-deliveries",authenticate,authorizeCapability("integrations.read"),async(req:AuthRequest,res)=>res.json(await prisma.webhookDelivery.findMany({where:{restaurantId:req.staff!.restaurantId},include:{endpoint:{select:{name:true,url:true}}},orderBy:{createdAt:"desc"},take:200})));
  app.post("/api/admin/integrations/webhooks",authenticate,authorizeCapability("integrations.manage"),async(req:AuthRequest,res)=>{const parsed=z.object({name:z.string().trim().min(2).max(80),url:z.string().url(),subscribedEvents:z.array(z.enum(WEBHOOK_EVENTS)).min(1)}).safeParse(req.body);if(!parsed.success)return res.status(400).json({message:"Enter a valid webhook endpoint"});try{await assertPublicWebhookUrl(parsed.data.url)}catch(error){return res.status(400).json({message:error instanceof Error?error.message:"Webhook URL is unavailable"})}const secret=`whsec_${randomBytes(24).toString("base64url")}`,row=await prisma.webhookEndpoint.create({data:{...parsed.data,restaurantId:req.staff!.restaurantId,secretCiphertext:encryptSecret(secret,encryptionSecret),createdBy:req.staff!.id}});res.status(201).json({id:row.id,name:row.name,url:row.url,subscribedEvents:row.subscribedEvents,isActive:row.isActive,secret})});
  app.patch("/api/admin/integrations/webhooks/:id",authenticate,authorizeCapability("integrations.manage"),async(req:AuthRequest,res)=>{const parsed=z.object({name:z.string().trim().min(2).max(80),url:z.string().url(),subscribedEvents:z.array(z.enum(WEBHOOK_EVENTS)).min(1),isActive:z.boolean()}).partial().safeParse(req.body);if(!parsed.success)return res.status(400).json({message:"Invalid webhook update"});if(parsed.data.url)try{await assertPublicWebhookUrl(parsed.data.url)}catch(error){return res.status(400).json({message:error instanceof Error?error.message:"Webhook URL is unavailable"})}const row=await prisma.webhookEndpoint.findFirst({where:{id:String(req.params.id),restaurantId:req.staff!.restaurantId}});if(!row)return res.status(404).json({message:"Webhook endpoint not found"});res.json(await prisma.webhookEndpoint.update({where:{id:row.id},data:parsed.data,select:{id:true,name:true,url:true,subscribedEvents:true,isActive:true,consecutiveFailures:true,lastDeliveredAt:true,lastFailedAt:true,createdAt:true}}))});
  app.delete("/api/admin/integrations/webhooks/:id",authenticate,authorizeCapability("integrations.manage"),async(req:AuthRequest,res)=>{const row=await prisma.webhookEndpoint.findFirst({where:{id:String(req.params.id),restaurantId:req.staff!.restaurantId}});if(!row)return res.status(404).json({message:"Webhook endpoint not found"});await prisma.webhookEndpoint.delete({where:{id:row.id}});res.status(204).end()});

  async function authenticateDeveloper(req:Request,res:Response,next:NextFunction){
    const raw=String(req.headers.authorization||"").replace(/^Bearer\s+/i,"");if(!raw.startsWith("kn_live_"))return res.status(401).json({message:"Developer API key required"});
    const key=await prisma.developerApiKey.findUnique({where:{secretHash:hashDeveloperKey(raw)}});if(!key||key.revokedAt||key.expiresAt&&key.expiresAt<=new Date())return res.status(401).json({message:"Developer API key is invalid or expired"});
    const restaurant=await prisma.restaurant.findUnique({where:{id:key.restaurantId},select:{plan:true}});
    if(!restaurant||!["business","pro","enterprise"].includes(restaurant.plan))return res.status(403).json({message:"Developer API access requires the Restaurant Platform Business plan.",code:"BUSINESS_REQUIRED"});
    (req as any).developerKey=key;void prisma.developerApiKey.update({where:{id:key.id},data:{lastUsedAt:new Date()}});next();
  }
  const requireScope=(scope:typeof DEVELOPER_SCOPES[number])=>(req:Request,res:Response,next:NextFunction)=>(req as any).developerKey.scopes.includes(scope)?next():res.status(403).json({message:`API key requires ${scope}`});
  app.get("/api/v1/menu",authenticateDeveloper,requireScope("menu.read"),async(req:Request,res)=>{const key=(req as any).developerKey;res.json(await prisma.menuCategory.findMany({where:{restaurantId:key.restaurantId},include:{items:{where:{deletedAt:null},include:{options:true}}},orderBy:{sortOrder:"asc"}}))});
  app.get("/api/v1/orders",authenticateDeveloper,requireScope("orders.read"),async(req:Request,res)=>{const key=(req as any).developerKey,after=z.coerce.date().optional().safeParse(req.query.updatedAfter);res.json(await prisma.order.findMany({where:{restaurantId:key.restaurantId,...(after.success&&after.data?{updatedAt:{gte:after.data}}:{})},include:{items:true},orderBy:{updatedAt:"desc"},take:200}))});
  app.get("/api/v1/loyalty/:phone",authenticateDeveloper,requireScope("loyalty.read"),async(req:Request,res)=>{const key=(req as any).developerKey;const account=await prisma.loyaltyAccount.findFirst({where:{restaurantId:key.restaurantId,guest:{phone:String(req.params.phone)}},include:{guest:true,transactions:{orderBy:{createdAt:"desc"},take:50}}});if(!account)return res.status(404).json({message:"Loyalty account not found"});res.json(account)});
}

import { createHash } from "node:crypto";
import type { Express, NextFunction, Request, Response } from "express";
import { AuditActorType, Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { appendAuditEvent } from "./enterprise-audit.js";
import { canTransitionKitchenTicket, orderStateForKitchenTickets, type KitchenTicketState } from "./order-domain.js";

type AuthRequest=Request&{staff?:{id:string;restaurantId:string;role:string;sessionId:string}};
type Auth=(req:AuthRequest,res:Response,next:NextFunction)=>unknown;
type CapabilityAuth=(capability:any)=>Auth;

export function signedInventoryQuantity(type:string,quantity:number){
  if(!Number.isFinite(quantity)||quantity===0)throw new Error("Inventory quantity must be a non-zero number");
  return["WASTE","TRANSFER","CONSUMPTION"].includes(type)?-Math.abs(quantity):quantity;
}

export function reconcileSettlementAmounts(grossAmount:number,feeAmount:number,taxAmount:number,netAmount:number){
  const expectedNet=grossAmount-feeAmount-taxAmount;
  return{expectedNet,status:expectedNet===netAmount?"MATCHED" as const:"MISMATCH" as const,mismatchReason:expectedNet===netAmount?null:`Expected net ${expectedNet}, received ${netAmount}`};
}

export function allocateInvoiceTaxes(items:Array<{name:string;hsnCode?:string|null;quantity:number;unitPrice:number;taxableAmount?:number;taxRate?:number;taxAmount?:number}>,fallbackRate:number,expectedTax:number,interstate:boolean){
  const lines=items.map(item=>{
    const taxableAmount=item.taxableAmount||item.unitPrice*item.quantity,gstRate=item.taxRate||fallbackRate,lineTax=item.taxAmount||Math.round(taxableAmount*gstRate/100);
    const igstAmount=interstate?lineTax:0,cgstAmount=interstate?0:Math.round(lineTax/2),sgstAmount=lineTax-igstAmount-cgstAmount;
    return{itemName:item.name,hsnCode:item.hsnCode||null,quantity:item.quantity,unitPrice:item.unitPrice,taxableAmount,gstRate,cgstAmount,sgstAmount,igstAmount,totalAmount:taxableAmount+lineTax};
  });
  const allocatedTax=lines.reduce((sum,line)=>sum+line.cgstAmount+line.sgstAmount+line.igstAmount,0),roundingAdjustment=expectedTax-allocatedTax;
  if(lines.length&&roundingAdjustment){
    if(interstate)lines[lines.length-1].igstAmount+=roundingAdjustment;
    else lines[lines.length-1].sgstAmount+=roundingAdjustment;
    lines[lines.length-1].totalAmount+=roundingAdjustment;
  }
  return lines;
}

export async function ensureKitchenTickets(prisma:PrismaClient,orderId:string){
  const order=await prisma.order.findUnique({where:{id:orderId},include:{items:{include:{menuItem:{select:{categoryId:true}}}}}});
  if(!order)return[];
  let stations=await prisma.kitchenStation.findMany({where:{restaurantId:order.restaurantId,isActive:true},include:{categories:true},orderBy:{sortOrder:"asc"}});
  if(!stations.length){
    const station=await prisma.kitchenStation.upsert({where:{restaurantId_code:{restaurantId:order.restaurantId,code:"MAIN"}},create:{restaurantId:order.restaurantId,name:"Main Kitchen",code:"MAIN",sortOrder:1},update:{isActive:true}});
    stations=[{...station,categories:[]}];
  }
  const groups=new Map<string,typeof order.items>();
  for(const item of order.items){
    const station=stations.find(candidate=>candidate.categories.some(link=>link.categoryId===item.menuItem.categoryId))||stations[0];
    groups.set(station.id,[...(groups.get(station.id)||[]),item]);
  }
  for(const[stationId,items]of groups){
    await prisma.kitchenTicket.upsert({
      where:{orderId_stationId:{orderId:order.id,stationId}},
      create:{restaurantId:order.restaurantId,orderId:order.id,stationId,items:{create:items.map(item=>({orderItemId:item.id,quantity:item.quantity,notes:item.notes}))}},
      update:{},
    });
  }
  return prisma.kitchenTicket.findMany({where:{orderId:order.id},include:{station:true,items:{include:{orderItem:true}}},orderBy:{createdAt:"asc"}});
}

export async function consumeInventoryForOrder(prisma:PrismaClient,orderId:string,actorId?:string){
  const order=await prisma.order.findUnique({where:{id:orderId},include:{items:{include:{menuItem:{include:{recipeIngredients:true}}}}}});
  if(!order)return{movements:0};
  let movements=0;
  await prisma.$transaction(async tx=>{
    for(const orderItem of order.items){
      for(const ingredient of orderItem.menuItem.recipeIngredients){
        const quantity=ingredient.quantity.mul(orderItem.quantity).mul(new Prisma.Decimal(1).add(ingredient.wastePercent.div(100)));
        const idempotencyKey=`order:${order.id}:item:${orderItem.id}:ingredient:${ingredient.inventoryItemId}`;
        const existing=await tx.inventoryMovement.findUnique({where:{restaurantId_idempotencyKey:{restaurantId:order.restaurantId,idempotencyKey}}});
        if(existing)continue;
        await tx.inventoryMovement.create({data:{restaurantId:order.restaurantId,inventoryItemId:ingredient.inventoryItemId,orderId:order.id,type:"CONSUMPTION",quantity:quantity.negated(),reason:`Order ${order.displayId}`,idempotencyKey,createdBy:actorId}});
        await tx.inventoryItem.update({where:{id:ingredient.inventoryItemId},data:{onHand:{decrement:quantity}}});
        movements++;
      }
    }
  });
  return{movements};
}

export async function issueTaxInvoice(prisma:PrismaClient,orderId:string){
  const existing=await prisma.taxInvoice.findUnique({where:{orderId}});
  if(existing)return existing;
  const order=await prisma.order.findUnique({where:{id:orderId},include:{items:true,restaurant:{include:{fiscalProfile:true}}}});
  if(!order||!["PAID","REFUNDED"].includes(order.paymentStatus))return null;
  const subtotal=order.subtotalAmount||order.items.reduce((sum,item)=>sum+item.unitPrice*item.quantity,0);
  const serviceChargeAmount=order.serviceChargeAmount||Math.round(subtotal*order.restaurant.serviceChargePercent/100);
  const profile=order.restaurant.fiscalProfile;
  const totalRate=profile?Number(profile.cgstPercent)+Number(profile.sgstPercent)+Number(profile.igstPercent):order.restaurant.taxPercent;
  const taxAmount=order.taxAmount||Math.max(0,order.totalAmount-subtotal-serviceChargeAmount);
  const interstate=Boolean(profile&&Number(profile.igstPercent)>0);
  const lines=allocateInvoiceTaxes(order.items.map(item=>({name:item.name,hsnCode:item.hsnCode,quantity:item.quantity,unitPrice:item.unitPrice,taxableAmount:item.taxableAmount,taxRate:Number(item.taxRate),taxAmount:item.taxAmount})),totalRate,taxAmount,interstate);
  const cgstAmount=lines.reduce((sum,line)=>sum+line.cgstAmount,0),sgstAmount=lines.reduce((sum,line)=>sum+line.sgstAmount,0),igstAmount=lines.reduce((sum,line)=>sum+line.igstAmount,0);
  try{
    return await prisma.$transaction(async tx=>{
      const currentProfile=profile?await tx.restaurantFiscalProfile.update({where:{restaurantId:order.restaurantId},data:{nextInvoiceNumber:{increment:1}}}):null;
      const sequence=currentProfile?currentProfile.nextInvoiceNumber-1:Number(order.displayId.replace(/\D/g,""))||Date.now();
      const invoiceNumber=`${profile?.invoicePrefix||"KN"}-${new Date().getFullYear()}-${String(sequence).padStart(6,"0")}`;
      return tx.taxInvoice.create({data:{restaurantId:order.restaurantId,orderId:order.id,invoiceNumber,status:order.paymentStatus==="REFUNDED"?"REFUNDED":"ISSUED",subtotal,taxableAmount:subtotal,cgstAmount,sgstAmount,igstAmount,serviceChargeAmount,totalAmount:order.totalAmount,placeOfSupply:currentProfile?.stateCode||profile?.stateCode,lines:{create:lines}}});
    });
  }catch(error){
    if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==="P2002"){const raced=await prisma.taxInvoice.findUnique({where:{orderId}});if(raced)return raced}
    throw error;
  }
}

export async function issueCreditNote(prisma:PrismaClient,orderId:string,providerRefundId?:string,reason="Payment refund"){
  const existing=await prisma.creditNote.findUnique({where:{orderId}});
  if(existing)return existing;
  const invoice=await issueTaxInvoice(prisma,orderId);
  if(!invoice)return null;
  try{
    return await prisma.$transaction(async tx=>{
      await tx.taxInvoice.update({where:{id:invoice.id},data:{status:"REFUNDED"}});
      return tx.creditNote.create({data:{restaurantId:invoice.restaurantId,orderId,taxInvoiceId:invoice.id,creditNoteNumber:`CN-${invoice.invoiceNumber}`,reason,taxableAmount:invoice.taxableAmount,cgstAmount:invoice.cgstAmount,sgstAmount:invoice.sgstAmount,igstAmount:invoice.igstAmount,totalAmount:invoice.totalAmount,providerRefundId}});
    });
  }catch(error){
    if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==="P2002"){const raced=await prisma.creditNote.findUnique({where:{orderId}});if(raced)return raced}
    throw error;
  }
}

export function registerOperationsPlatform(app:Express,prisma:PrismaClient,authenticate:Auth,authorizeCapability:CapabilityAuth,emitSync:(restaurantId:string,scope:string)=>void,publishOrderUpdate:(orderId:string,notifyReady:boolean)=>Promise<void>){
  const stationInput=z.object({name:z.string().trim().min(2).max(80),code:z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,16}$/),color:z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#2e7d5b"),sortOrder:z.number().int().min(0).max(1000).default(0),categoryIds:z.array(z.string()).default([]),isActive:z.boolean().default(true)});
  app.get("/api/admin/kds/stations",authenticate,authorizeCapability("orders.read"),async(req:AuthRequest,res)=>res.json(await prisma.kitchenStation.findMany({where:{restaurantId:req.staff!.restaurantId},include:{categories:{include:{category:{select:{id:true,name:true}}}}},orderBy:{sortOrder:"asc"}})));
  app.post("/api/admin/kds/stations",authenticate,authorizeCapability("kds.manage"),async(req:AuthRequest,res)=>{
    const parsed=stationInput.safeParse(req.body);if(!parsed.success)return res.status(400).json({message:"Enter a valid station"});
    const categories=await prisma.menuCategory.count({where:{restaurantId:req.staff!.restaurantId,id:{in:parsed.data.categoryIds}}});if(categories!==parsed.data.categoryIds.length)return res.status(400).json({message:"One or more categories are invalid"});
    const{categoryIds,...data}=parsed.data;const station=await prisma.kitchenStation.create({data:{...data,restaurantId:req.staff!.restaurantId,categories:{create:categoryIds.map(categoryId=>({categoryId}))}},include:{categories:true}});
    res.status(201).json(station);
  });
  app.patch("/api/admin/kds/stations/:id",authenticate,authorizeCapability("kds.manage"),async(req:AuthRequest,res)=>{
    const parsed=stationInput.partial().safeParse(req.body);if(!parsed.success)return res.status(400).json({message:"Invalid station update"});
    const station=await prisma.kitchenStation.findFirst({where:{id:String(req.params.id),restaurantId:req.staff!.restaurantId}});if(!station)return res.status(404).json({message:"Station not found"});
    if(parsed.data.categoryIds){const categories=await prisma.menuCategory.count({where:{restaurantId:req.staff!.restaurantId,id:{in:parsed.data.categoryIds}}});if(categories!==new Set(parsed.data.categoryIds).size)return res.status(400).json({message:"One or more categories are invalid"})}
    const{categoryIds,...data}=parsed.data;const updated=await prisma.$transaction(async tx=>{if(categoryIds){await tx.kitchenStationCategory.deleteMany({where:{stationId:station.id}});if(categoryIds.length)await tx.kitchenStationCategory.createMany({data:categoryIds.map(categoryId=>({stationId:station.id,categoryId}))})}return tx.kitchenStation.update({where:{id:station.id},data})});res.json(updated);
  });
  app.get("/api/admin/kds/tickets",authenticate,authorizeCapability("orders.read"),async(req:AuthRequest,res)=>{
    const stationId=typeof req.query.stationId==="string"?req.query.stationId:undefined;
    res.json(await prisma.kitchenTicket.findMany({where:{restaurantId:req.staff!.restaurantId,status:{notIn:["COMPLETED","CANCELLED"]},...(stationId?{stationId}:{})},include:{station:true,order:{select:{displayId:true,tableLabel:true,createdAt:true,status:true}},items:{include:{orderItem:true}}},orderBy:[{priority:"desc"},{createdAt:"asc"}]}));
  });
  app.patch("/api/admin/kds/tickets/:id/status",authenticate,authorizeCapability("orders.prepare"),async(req:AuthRequest,res)=>{
    const parsed=z.enum(["ACKNOWLEDGED","PREPARING","READY","COMPLETED","CANCELLED"]).safeParse(req.body.status);if(!parsed.success)return res.status(400).json({message:"Invalid ticket status"});
    const ticket=await prisma.kitchenTicket.findFirst({where:{id:String(req.params.id),restaurantId:req.staff!.restaurantId}});if(!ticket)return res.status(404).json({message:"Ticket not found"});
    if(!canTransitionKitchenTicket(ticket.status as KitchenTicketState,parsed.data))return res.status(409).json({message:`Kitchen tickets cannot move from ${ticket.status.toLowerCase()} to ${parsed.data.toLowerCase()}`,code:"INVALID_KDS_TRANSITION"});
    const now=new Date(),data={status:parsed.data,...(parsed.data==="ACKNOWLEDGED"?{acknowledgedAt:now}:{}),...(parsed.data==="PREPARING"?{startedAt:now}:{}),...(parsed.data==="READY"?{readyAt:now}:{}),...(parsed.data==="COMPLETED"?{completedAt:now}:{})};
    const updated=await prisma.kitchenTicket.update({where:{id:ticket.id},data,include:{station:true,order:true,items:{include:{orderItem:true}}}});
    const siblings=await prisma.kitchenTicket.findMany({where:{orderId:ticket.orderId},select:{status:true}});
    const order=await prisma.order.findUnique({where:{id:ticket.orderId},select:{status:true}});
    if(order&&!["SERVED","CANCELLED"].includes(order.status)){
      const nextOrderStatus=orderStateForKitchenTickets(siblings.map(item=>item.status as KitchenTicketState));
      const readyTransition=nextOrderStatus==="READY"&&order.status!=="READY";
      if(nextOrderStatus&&nextOrderStatus!==order.status)await prisma.order.update({where:{id:ticket.orderId},data:{status:nextOrderStatus}});
      if(["ACKNOWLEDGED","PREPARING"].includes(parsed.data))await consumeInventoryForOrder(prisma,ticket.orderId,req.staff!.id);
      await publishOrderUpdate(ticket.orderId,readyTransition);
    }
    emitSync(req.staff!.restaurantId,"kds.ticket");res.json(updated);
  });

  const inventoryInput=z.object({name:z.string().trim().min(2).max(100),sku:z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,32}$/),unit:z.string().trim().min(1).max(20),onHand:z.coerce.number().nonnegative().default(0),reorderLevel:z.coerce.number().nonnegative().default(0),costPerUnitPaise:z.number().int().nonnegative().default(0),isActive:z.boolean().default(true)});
  app.get("/api/admin/inventory",authenticate,authorizeCapability("inventory.read"),async(req:AuthRequest,res)=>{const rows=await prisma.inventoryItem.findMany({where:{restaurantId:req.staff!.restaurantId},include:{recipeIngredients:{select:{menuItemId:true,quantity:true,wastePercent:true}}},orderBy:{name:"asc"}});res.json(rows.map(row=>({...row,onHand:Number(row.onHand),reorderLevel:Number(row.reorderLevel),lowStock:row.onHand.lte(row.reorderLevel)})))});
  app.post("/api/admin/inventory",authenticate,authorizeCapability("inventory.manage"),async(req:AuthRequest,res)=>{const parsed=inventoryInput.safeParse(req.body);if(!parsed.success)return res.status(400).json({message:"Enter a valid inventory item"});const item=await prisma.$transaction(async tx=>{const created=await tx.inventoryItem.create({data:{...parsed.data,restaurantId:req.staff!.restaurantId}});if(parsed.data.onHand>0)await tx.inventoryMovement.create({data:{restaurantId:req.staff!.restaurantId,inventoryItemId:created.id,type:"ADJUSTMENT",quantity:parsed.data.onHand,unitCostPaise:parsed.data.costPerUnitPaise,reason:"Opening balance",idempotencyKey:`opening:${created.id}`,createdBy:req.staff!.id}});return created});res.status(201).json(item)});
  app.patch("/api/admin/inventory/:id",authenticate,authorizeCapability("inventory.manage"),async(req:AuthRequest,res)=>{const parsed=inventoryInput.omit({onHand:true}).partial().safeParse(req.body);if(!parsed.success)return res.status(400).json({message:"Invalid inventory update. Change stock through a ledger movement."});const item=await prisma.inventoryItem.findFirst({where:{id:String(req.params.id),restaurantId:req.staff!.restaurantId}});if(!item)return res.status(404).json({message:"Inventory item not found"});res.json(await prisma.inventoryItem.update({where:{id:item.id},data:parsed.data}))});
  app.post("/api/admin/inventory/:id/movements",authenticate,authorizeCapability("inventory.manage"),async(req:AuthRequest,res)=>{
    const parsed=z.object({type:z.enum(["RECEIPT","ADJUSTMENT","WASTE","RETURN","TRANSFER"]),quantity:z.coerce.number().positive(),unitCostPaise:z.number().int().nonnegative().optional(),reason:z.string().trim().min(2).max(200),idempotencyKey:z.string().uuid()}).safeParse(req.body);if(!parsed.success)return res.status(400).json({message:"Enter a valid stock movement"});
    const item=await prisma.inventoryItem.findFirst({where:{id:String(req.params.id),restaurantId:req.staff!.restaurantId}});if(!item)return res.status(404).json({message:"Inventory item not found"});
    const signed=signedInventoryQuantity(parsed.data.type,parsed.data.quantity);
    const movement=await prisma.$transaction(async tx=>{const existing=await tx.inventoryMovement.findUnique({where:{restaurantId_idempotencyKey:{restaurantId:req.staff!.restaurantId,idempotencyKey:parsed.data.idempotencyKey}}});if(existing)return existing;const created=await tx.inventoryMovement.create({data:{restaurantId:req.staff!.restaurantId,inventoryItemId:item.id,type:parsed.data.type,quantity:signed,unitCostPaise:parsed.data.unitCostPaise,reason:parsed.data.reason,idempotencyKey:parsed.data.idempotencyKey,createdBy:req.staff!.id}});await tx.inventoryItem.update({where:{id:item.id},data:{onHand:{increment:signed},...(parsed.data.unitCostPaise!=null?{costPerUnitPaise:parsed.data.unitCostPaise}:{})}});return created});emitSync(req.staff!.restaurantId,"inventory.movement");res.status(201).json(movement);
  });
  app.put("/api/admin/menu/items/:id/recipe",authenticate,authorizeCapability("inventory.manage"),async(req:AuthRequest,res)=>{
    const parsed=z.object({ingredients:z.array(z.object({inventoryItemId:z.string(),quantity:z.coerce.number().positive(),wastePercent:z.coerce.number().min(0).max(100).default(0)})).max(100)}).safeParse(req.body);if(!parsed.success)return res.status(400).json({message:"Enter a valid recipe"});
    const item=await prisma.menuItem.findFirst({where:{id:String(req.params.id),restaurantId:req.staff!.restaurantId}});if(!item)return res.status(404).json({message:"Menu item not found"});
    const ingredientIds=[...new Set(parsed.data.ingredients.map(row=>row.inventoryItemId))],ownedIngredients=await prisma.inventoryItem.count({where:{restaurantId:req.staff!.restaurantId,id:{in:ingredientIds},isActive:true}});if(ownedIngredients!==ingredientIds.length||ingredientIds.length!==parsed.data.ingredients.length)return res.status(400).json({message:"Recipe ingredients must be unique inventory items from this restaurant"});
    await prisma.$transaction(async tx=>{await tx.recipeIngredient.deleteMany({where:{menuItemId:item.id}});if(parsed.data.ingredients.length)await tx.recipeIngredient.createMany({data:parsed.data.ingredients.map(row=>({...row,menuItemId:item.id}))})});res.json({menuItemId:item.id,ingredients:parsed.data.ingredients});
  });
  const vendorInput=z.object({name:z.string().trim().min(2).max(120),gstin:z.string().trim().regex(/^[0-9]{2}[A-Z0-9]{13}$/).optional().or(z.literal("")),phone:z.string().trim().regex(/^\+?[0-9]{10,15}$/).optional().or(z.literal("")),email:z.string().email().optional().or(z.literal("")),isActive:z.boolean().default(true)});
  app.get("/api/admin/procurement/vendors",authenticate,authorizeCapability("inventory.read"),async(req:AuthRequest,res)=>res.json(await prisma.vendor.findMany({where:{restaurantId:req.staff!.restaurantId},orderBy:{name:"asc"}})));
  app.post("/api/admin/procurement/vendors",authenticate,authorizeCapability("inventory.manage"),async(req:AuthRequest,res)=>{
    const parsed=vendorInput.safeParse(req.body);if(!parsed.success)return res.status(400).json({message:"Enter valid vendor details"});
    res.status(201).json(await prisma.vendor.create({data:{...parsed.data,gstin:parsed.data.gstin||null,phone:parsed.data.phone||null,email:parsed.data.email||null,restaurantId:req.staff!.restaurantId}}));
  });
  app.patch("/api/admin/procurement/vendors/:id",authenticate,authorizeCapability("inventory.manage"),async(req:AuthRequest,res)=>{
    const parsed=vendorInput.partial().safeParse(req.body);if(!parsed.success)return res.status(400).json({message:"Enter valid vendor details"});
    const vendor=await prisma.vendor.findFirst({where:{id:String(req.params.id),restaurantId:req.staff!.restaurantId}});if(!vendor)return res.status(404).json({message:"Vendor not found"});
    res.json(await prisma.vendor.update({where:{id:vendor.id},data:{...parsed.data,...(parsed.data.gstin!==undefined?{gstin:parsed.data.gstin||null}:{}),...(parsed.data.phone!==undefined?{phone:parsed.data.phone||null}:{}),...(parsed.data.email!==undefined?{email:parsed.data.email||null}:{})}}));
  });
  const purchaseOrderInput=z.object({vendorId:z.string(),expectedAt:z.coerce.date().optional(),notes:z.string().trim().max(500).optional(),lines:z.array(z.object({inventoryItemId:z.string(),orderedQuantity:z.coerce.number().positive(),unitCostPaise:z.number().int().nonnegative()})).min(1).max(200)}).refine(input=>new Set(input.lines.map(line=>line.inventoryItemId)).size===input.lines.length,{message:"Purchase order items must be unique"});
  app.get("/api/admin/procurement/purchase-orders",authenticate,authorizeCapability("inventory.read"),async(req:AuthRequest,res)=>res.json(await prisma.purchaseOrder.findMany({where:{restaurantId:req.staff!.restaurantId},include:{vendor:true,lines:{include:{inventoryItem:true}}},orderBy:{createdAt:"desc"},take:300})));
  app.post("/api/admin/procurement/purchase-orders",authenticate,authorizeCapability("inventory.manage"),async(req:AuthRequest,res)=>{
    const parsed=purchaseOrderInput.safeParse(req.body);if(!parsed.success)return res.status(400).json({message:"Enter a valid purchase order"});
    const[vendor,ownedItems]=await Promise.all([prisma.vendor.findFirst({where:{id:parsed.data.vendorId,restaurantId:req.staff!.restaurantId,isActive:true}}),prisma.inventoryItem.count({where:{id:{in:parsed.data.lines.map(line=>line.inventoryItemId)},restaurantId:req.staff!.restaurantId,isActive:true}})]);
    if(!vendor||ownedItems!==new Set(parsed.data.lines.map(line=>line.inventoryItemId)).size)return res.status(400).json({message:"Vendor or inventory item is invalid"});
    const number=`PO-${new Date().toISOString().slice(0,10).replaceAll("-","")}-${String(Date.now()).slice(-6)}`;
    const row=await prisma.purchaseOrder.create({data:{restaurantId:req.staff!.restaurantId,vendorId:vendor.id,number,expectedAt:parsed.data.expectedAt,notes:parsed.data.notes,createdBy:req.staff!.id,lines:{create:parsed.data.lines.map(line=>({...line}))}},include:{vendor:true,lines:{include:{inventoryItem:true}}}});
    res.status(201).json(row);
  });
  app.post("/api/admin/procurement/purchase-orders/:id/submit",authenticate,authorizeCapability("inventory.manage"),async(req:AuthRequest,res)=>{
    const row=await prisma.purchaseOrder.findFirst({where:{id:String(req.params.id),restaurantId:req.staff!.restaurantId,status:"DRAFT"}});if(!row)return res.status(409).json({message:"Only a draft purchase order can be submitted"});
    res.json(await prisma.purchaseOrder.update({where:{id:row.id},data:{status:"SUBMITTED",submittedAt:new Date()}}));
  });
  app.post("/api/admin/procurement/purchase-orders/:id/receive",authenticate,authorizeCapability("inventory.manage"),async(req:AuthRequest,res)=>{
    const parsed=z.object({idempotencyKey:z.string().uuid(),lines:z.array(z.object({lineId:z.string(),quantity:z.coerce.number().positive()})).min(1).max(200)}).safeParse(req.body);if(!parsed.success)return res.status(400).json({message:"Enter valid received quantities"});
    const order=await prisma.purchaseOrder.findFirst({where:{id:String(req.params.id),restaurantId:req.staff!.restaurantId,status:{in:["SUBMITTED","PARTIALLY_RECEIVED","RECEIVED"]}},include:{lines:true}});if(!order)return res.status(409).json({message:"Purchase order is not ready to receive"});
    const requested=new Map(parsed.data.lines.map(line=>[line.lineId,line.quantity]));
    if(requested.size!==parsed.data.lines.length||[...requested.keys()].some(id=>!order.lines.some(line=>line.id===id)))return res.status(400).json({message:"One or more purchase order lines are invalid"});
    const updated=await prisma.$transaction(async tx=>{
      for(const line of order.lines){
        const quantity=requested.get(line.id);if(!quantity)continue;
        const remaining=line.orderedQuantity.sub(line.receivedQuantity);if(new Prisma.Decimal(quantity).gt(remaining))throw new Error(`Received quantity exceeds the remaining amount for ${line.id}`);
        const movementKey=`po:${order.id}:${parsed.data.idempotencyKey}:${line.id}`;
        const existing=await tx.inventoryMovement.findUnique({where:{restaurantId_idempotencyKey:{restaurantId:req.staff!.restaurantId,idempotencyKey:movementKey}}});if(existing)continue;
        await tx.inventoryMovement.create({data:{restaurantId:req.staff!.restaurantId,inventoryItemId:line.inventoryItemId,type:"RECEIPT",quantity,unitCostPaise:line.unitCostPaise,reason:`Purchase order ${order.number}`,idempotencyKey:movementKey,createdBy:req.staff!.id}});
        await tx.inventoryItem.update({where:{id:line.inventoryItemId},data:{onHand:{increment:quantity},costPerUnitPaise:line.unitCostPaise}});
        await tx.purchaseOrderLine.update({where:{id:line.id},data:{receivedQuantity:{increment:quantity}}});
      }
      const lines=await tx.purchaseOrderLine.findMany({where:{purchaseOrderId:order.id}});
      const complete=lines.every(line=>line.receivedQuantity.gte(line.orderedQuantity));
      return tx.purchaseOrder.update({where:{id:order.id},data:{status:complete?"RECEIVED":"PARTIALLY_RECEIVED",...(complete?{receivedAt:new Date()}:{})},include:{vendor:true,lines:{include:{inventoryItem:true}}}});
    }).catch(error=>{if(error instanceof Error&&error.message.startsWith("Received quantity exceeds"))return null;throw error});
    if(!updated)return res.status(409).json({message:"Received quantity exceeds the outstanding purchase order quantity"});
    emitSync(req.staff!.restaurantId,"inventory.received");res.json(updated);
  });

  const guestInput=z.object({name:z.string().trim().min(2).max(100),phone:z.string().trim().regex(/^\+?[0-9]{10,15}$/),email:z.string().email().optional(),notes:z.string().max(500).optional(),tags:z.array(z.string().max(30)).max(20).default([]),consent:z.boolean().default(false)});
  async function upsertGuest(restaurantId:string,input:z.infer<typeof guestInput>){return prisma.guestProfile.upsert({where:{restaurantId_phone:{restaurantId,phone:input.phone}},create:{restaurantId,name:input.name,phone:input.phone,email:input.email,notes:input.notes,tags:input.tags,consentAt:input.consent?new Date():null},update:{name:input.name,email:input.email,notes:input.notes,tags:input.tags,...(input.consent?{consentAt:new Date()}:{})}})}
  app.get("/api/admin/reservations",authenticate,authorizeCapability("reservations.read"),async(req:AuthRequest,res)=>{const from=z.coerce.date().catch(new Date()).parse(req.query.from);res.json(await prisma.reservation.findMany({where:{restaurantId:req.staff!.restaurantId,startsAt:{gte:new Date(from.getTime()-86400000)}},include:{guest:true},orderBy:{startsAt:"asc"},take:500}))});
  app.post("/api/admin/reservations",authenticate,authorizeCapability("reservations.manage"),async(req:AuthRequest,res)=>{const parsed=guestInput.extend({partySize:z.number().int().min(1).max(100),startsAt:z.coerce.date(),durationMinutes:z.number().int().min(30).max(360).default(90),notes:z.string().max(500).optional()}).safeParse(req.body);if(!parsed.success)return res.status(400).json({message:"Enter valid reservation details"});const guest=await upsertGuest(req.staff!.restaurantId,parsed.data);res.status(201).json(await prisma.reservation.create({data:{restaurantId:req.staff!.restaurantId,guestId:guest.id,partySize:parsed.data.partySize,startsAt:parsed.data.startsAt,durationMinutes:parsed.data.durationMinutes,notes:parsed.data.notes,createdBy:req.staff!.id},include:{guest:true}}))});
  app.patch("/api/admin/reservations/:id/status",authenticate,authorizeCapability("reservations.manage"),async(req:AuthRequest,res)=>{const status=z.enum(["BOOKED","CONFIRMED","SEATED","COMPLETED","CANCELLED","NO_SHOW"]).safeParse(req.body.status);if(!status.success)return res.status(400).json({message:"Invalid reservation status"});const row=await prisma.reservation.findFirst({where:{id:String(req.params.id),restaurantId:req.staff!.restaurantId}});if(!row)return res.status(404).json({message:"Reservation not found"});res.json(await prisma.reservation.update({where:{id:row.id},data:{status:status.data},include:{guest:true}}))});
  app.get("/api/admin/waitlist",authenticate,authorizeCapability("reservations.read"),async(req:AuthRequest,res)=>res.json(await prisma.waitlistEntry.findMany({where:{restaurantId:req.staff!.restaurantId,status:{in:["WAITING","NOTIFIED"]}},include:{guest:true},orderBy:{createdAt:"asc"}})));
  app.post("/api/admin/waitlist",authenticate,authorizeCapability("reservations.manage"),async(req:AuthRequest,res)=>{const parsed=guestInput.extend({partySize:z.number().int().min(1).max(100),quotedWaitMinutes:z.number().int().min(0).max(480)}).safeParse(req.body);if(!parsed.success)return res.status(400).json({message:"Enter valid waitlist details"});const guest=await upsertGuest(req.staff!.restaurantId,parsed.data);res.status(201).json(await prisma.waitlistEntry.create({data:{restaurantId:req.staff!.restaurantId,guestId:guest.id,partySize:parsed.data.partySize,quotedWaitMinutes:parsed.data.quotedWaitMinutes,notes:parsed.data.notes},include:{guest:true}}))});
  app.patch("/api/admin/waitlist/:id/status",authenticate,authorizeCapability("reservations.manage"),async(req:AuthRequest,res)=>{const status=z.enum(["WAITING","NOTIFIED","SEATED","CANCELLED","EXPIRED"]).safeParse(req.body.status);if(!status.success)return res.status(400).json({message:"Invalid waitlist status"});const row=await prisma.waitlistEntry.findFirst({where:{id:String(req.params.id),restaurantId:req.staff!.restaurantId}});if(!row)return res.status(404).json({message:"Waitlist entry not found"});res.json(await prisma.waitlistEntry.update({where:{id:row.id},data:{status:status.data,...(status.data==="NOTIFIED"?{notifiedAt:new Date()}:{}),...(status.data==="SEATED"?{seatedAt:new Date()}:{})},include:{guest:true}}))});

  app.get("/api/admin/fiscal/profile",authenticate,authorizeCapability("finance.read"),async(req:AuthRequest,res)=>res.json(await prisma.restaurantFiscalProfile.findUnique({where:{restaurantId:req.staff!.restaurantId}})));
  app.put("/api/admin/fiscal/profile",authenticate,authorizeCapability("finance.manage"),async(req:AuthRequest,res)=>{
    const parsed=z.object({legalName:z.string().trim().min(2).max(160),gstin:z.string().trim().regex(/^[0-9]{2}[A-Z0-9]{13}$/).optional().or(z.literal("")),stateCode:z.string().regex(/^[0-9]{2}$/),address:z.string().trim().min(5).max(500),invoicePrefix:z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,12}$/),cgstPercent:z.coerce.number().min(0).max(50),sgstPercent:z.coerce.number().min(0).max(50),igstPercent:z.coerce.number().min(0).max(50)}).safeParse(req.body);if(!parsed.success)return res.status(400).json({message:"Enter a valid fiscal profile"});
    res.json(await prisma.restaurantFiscalProfile.upsert({where:{restaurantId:req.staff!.restaurantId},create:{...parsed.data,gstin:parsed.data.gstin||null,restaurantId:req.staff!.restaurantId},update:{...parsed.data,gstin:parsed.data.gstin||null}}));
  });
  app.get("/api/admin/fiscal/invoices",authenticate,authorizeCapability("finance.read"),async(req:AuthRequest,res)=>res.json(await prisma.taxInvoice.findMany({where:{restaurantId:req.staff!.restaurantId},include:{lines:true,creditNotes:true,order:{select:{displayId:true,tableLabel:true,paymentMode:true,paymentStatus:true}}},orderBy:{issuedAt:"desc"},take:500})));
  app.get("/api/admin/fiscal/credit-notes",authenticate,authorizeCapability("finance.read"),async(req:AuthRequest,res)=>res.json(await prisma.creditNote.findMany({where:{restaurantId:req.staff!.restaurantId},include:{taxInvoice:{select:{invoiceNumber:true}},order:{select:{displayId:true,tableLabel:true}}},orderBy:{issuedAt:"desc"},take:500})));
  app.post("/api/admin/fiscal/invoices/:orderId/issue",authenticate,authorizeCapability("finance.manage"),async(req:AuthRequest,res)=>{const order=await prisma.order.findFirst({where:{displayId:String(req.params.orderId),restaurantId:req.staff!.restaurantId}});if(!order)return res.status(404).json({message:"Order not found"});const invoice=await issueTaxInvoice(prisma,order.id);if(!invoice)return res.status(409).json({message:"Only financially confirmed orders can be invoiced"});res.status(201).json(invoice)});
  app.post("/api/admin/orders/:id/manual-refund",authenticate,authorizeCapability("payments.refund"),async(req:AuthRequest,res)=>{
    const parsed=z.object({reason:z.string().trim().min(4).max(300),reference:z.string().trim().min(2).max(120).optional()}).safeParse(req.body);if(!parsed.success)return res.status(400).json({message:"Enter a refund reason and optional external reference"});
    const order=await prisma.order.findFirst({where:{displayId:String(req.params.id),restaurantId:req.staff!.restaurantId,paymentStatus:"PAID",paymentMode:{in:["upi","counter"]}}});if(!order)return res.status(409).json({message:"Only a paid UPI or counter order can be manually refunded"});
    const updated=await prisma.order.update({where:{id:order.id},data:{paymentStatus:"REFUNDED",refundStatus:"processed",refundId:parsed.data.reference||`manual:${order.id}`}});
    const creditNote=await issueCreditNote(prisma,order.id,parsed.data.reference,parsed.data.reason);
    await appendAuditEvent(prisma,{restaurantId:req.staff!.restaurantId,actor:{type:AuditActorType.STAFF,id:req.staff!.id,role:req.staff!.role},action:"payment.manual_refund_recorded",resourceType:"order",resourceId:order.id,metadata:{creditNoteId:creditNote?.id,reference:parsed.data.reference||null,reason:parsed.data.reason}});
    await publishOrderUpdate(order.id,false);
    res.json({order:updated,creditNote});
  });
  app.get("/api/admin/settlements",authenticate,authorizeCapability("finance.read"),async(req:AuthRequest,res)=>res.json(await prisma.paymentSettlement.findMany({where:{restaurantId:req.staff!.restaurantId},orderBy:{createdAt:"desc"},take:500})));
  app.post("/api/admin/settlements/import",authenticate,authorizeCapability("finance.manage"),async(req:AuthRequest,res)=>{
    const parsed=z.object({provider:z.string().trim().min(2).max(40),providerSettlementId:z.string().trim().min(2).max(120),grossAmount:z.number().int().nonnegative(),feeAmount:z.number().int().nonnegative().default(0),taxAmount:z.number().int().nonnegative().default(0),netAmount:z.number().int().nonnegative(),settledAt:z.coerce.date().optional(),bankReference:z.string().max(120).optional()}).safeParse(req.body);if(!parsed.success)return res.status(400).json({message:"Enter valid settlement details"});
    const reconciliation=reconcileSettlementAmounts(parsed.data.grossAmount,parsed.data.feeAmount,parsed.data.taxAmount,parsed.data.netAmount);
    res.status(201).json(await prisma.paymentSettlement.upsert({where:{restaurantId_provider_providerSettlementId:{restaurantId:req.staff!.restaurantId,provider:parsed.data.provider,providerSettlementId:parsed.data.providerSettlementId}},create:{...parsed.data,restaurantId:req.staff!.restaurantId,status:reconciliation.status,mismatchReason:reconciliation.mismatchReason},update:{...parsed.data,status:reconciliation.status,mismatchReason:reconciliation.mismatchReason}}));
  });
  app.post("/api/admin/accounting/exports",authenticate,authorizeCapability("finance.manage"),async(req:AuthRequest,res)=>{
    const parsed=z.object({fromDate:z.coerce.date(),toDate:z.coerce.date(),format:z.enum(["json","csv","tally_xml"]).default("json"),integrationId:z.string().optional()}).safeParse(req.body);if(!parsed.success||parsed.data.fromDate>parsed.data.toDate)return res.status(400).json({message:"Choose a valid export range"});
    if(parsed.data.integrationId){const integration=await prisma.accountingIntegration.findFirst({where:{id:parsed.data.integrationId,restaurantId:req.staff!.restaurantId,isActive:true}});if(!integration)return res.status(400).json({message:"Accounting destination is unavailable for this restaurant"})}
    const[invoices,creditNotes,settlements]=await Promise.all([prisma.taxInvoice.findMany({where:{restaurantId:req.staff!.restaurantId,issuedAt:{gte:parsed.data.fromDate,lte:parsed.data.toDate}},include:{lines:true},orderBy:{issuedAt:"asc"}}),prisma.creditNote.findMany({where:{restaurantId:req.staff!.restaurantId,issuedAt:{gte:parsed.data.fromDate,lte:parsed.data.toDate}},orderBy:{issuedAt:"asc"}}),prisma.paymentSettlement.findMany({where:{restaurantId:req.staff!.restaurantId,createdAt:{gte:parsed.data.fromDate,lte:parsed.data.toDate}},orderBy:{createdAt:"asc"}})]);
    const payload={schemaVersion:"1.1",restaurantId:req.staff!.restaurantId,fromDate:parsed.data.fromDate.toISOString(),toDate:parsed.data.toDate.toISOString(),invoices,creditNotes,settlements};const checksum=createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    const record=await prisma.accountingExport.create({data:{restaurantId:req.staff!.restaurantId,integrationId:parsed.data.integrationId,fromDate:parsed.data.fromDate,toDate:parsed.data.toDate,status:"GENERATED",format:parsed.data.format,payload:payload as any,recordCount:invoices.length+creditNotes.length+settlements.length,checksum,createdBy:req.staff!.id,generatedAt:new Date()}});
    await appendAuditEvent(prisma,{restaurantId:req.staff!.restaurantId,actor:{type:AuditActorType.STAFF,id:req.staff!.id,role:req.staff!.role},action:"accounting.export_generated",resourceType:"accounting-export",resourceId:record.id,metadata:{format:record.format,recordCount:record.recordCount,checksum}});res.status(201).json(record);
  });
  app.get("/api/admin/accounting/exports",authenticate,authorizeCapability("finance.read"),async(req:AuthRequest,res)=>res.json(await prisma.accountingExport.findMany({where:{restaurantId:req.staff!.restaurantId},orderBy:{createdAt:"desc"},take:200})));
  const accountingInput=z.object({provider:z.enum(["tally","zoho_books","quickbooks","generic"]),displayName:z.string().trim().min(2).max(100),isActive:z.boolean().default(true)});
  app.get("/api/admin/accounting/integrations",authenticate,authorizeCapability("finance.read"),async(req:AuthRequest,res)=>res.json(await prisma.accountingIntegration.findMany({where:{restaurantId:req.staff!.restaurantId},select:{id:true,provider:true,displayName:true,isActive:true,lastExportAt:true,createdAt:true,updatedAt:true},orderBy:{createdAt:"asc"}})));
  app.post("/api/admin/accounting/integrations",authenticate,authorizeCapability("finance.manage"),async(req:AuthRequest,res)=>{
    const parsed=accountingInput.safeParse(req.body);if(!parsed.success)return res.status(400).json({message:"Choose a supported accounting destination"});
    res.status(201).json(await prisma.accountingIntegration.upsert({where:{restaurantId_provider:{restaurantId:req.staff!.restaurantId,provider:parsed.data.provider}},create:{...parsed.data,restaurantId:req.staff!.restaurantId},update:{displayName:parsed.data.displayName,isActive:parsed.data.isActive},select:{id:true,provider:true,displayName:true,isActive:true,lastExportAt:true,createdAt:true,updatedAt:true}}));
  });
  app.patch("/api/admin/accounting/integrations/:id",authenticate,authorizeCapability("finance.manage"),async(req:AuthRequest,res)=>{
    const parsed=accountingInput.pick({displayName:true,isActive:true}).partial().safeParse(req.body);if(!parsed.success)return res.status(400).json({message:"Invalid accounting integration update"});
    const integration=await prisma.accountingIntegration.findFirst({where:{id:String(req.params.id),restaurantId:req.staff!.restaurantId}});if(!integration)return res.status(404).json({message:"Accounting integration not found"});
    res.json(await prisma.accountingIntegration.update({where:{id:integration.id},data:parsed.data,select:{id:true,provider:true,displayName:true,isActive:true,lastExportAt:true,createdAt:true,updatedAt:true}}));
  });
}

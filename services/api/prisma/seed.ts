import { PrismaClient, StaffRole } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const isProduction = process.env.NODE_ENV === "production";
  if (isProduction && process.env.ALLOW_PRODUCTION_SEED !== "true") {
    throw new Error("Refusing to run prisma seed in production without ALLOW_PRODUCTION_SEED=true");
  }

  const masterPhone = process.env.MASTER_ADMIN_PHONE || "+919999999999";
  const ownerPhone = process.env.DEMO_OWNER_PHONE || "+919111111111";

  if (isProduction && masterPhone === "+919999999999") {
    throw new Error("MASTER_ADMIN_PHONE must be overridden before seeding production");
  }

  const existingAdmin = await prisma.platformAdmin.findFirst({ where: { phone: masterPhone } });
  if (existingAdmin) {
    await prisma.platformAdmin.update({
      where: { id: existingAdmin.id },
      data: { name: "Restaurant Platform Platform Admin", phone: masterPhone },
    });
  } else {
    await prisma.platformAdmin.create({
      data: { phone: masterPhone, name: "Restaurant Platform Platform Admin" },
    });
  }
  const organization=await prisma.organization.upsert({where:{slug:"demo-bistro"},update:{},create:{id:"org_demo",name:"The Saffron Table",slug:"demo-bistro"}});
  const restaurant = await prisma.restaurant.upsert({ where:{slug:"demo-bistro"}, update:{}, create:{ id:"rest_demo", organizationId:organization.id, locationCode:"HQ", name:"The Saffron Table", slug:"demo-bistro", tagline:"Fresh plates, zero waiting" } });
  const table = await prisma.table.upsert({ where:{restaurantId_code:{restaurantId:restaurant.id,code:"T1"}}, update:{isActive:true,label:"Table 01"}, create:{id:"table_demo_1",restaurantId:restaurant.id,code:"T1",label:"Table 01"} });
  const previewTable = await prisma.table.upsert({ where:{restaurantId_code:{restaurantId:restaurant.id,code:"T7"}}, update:{isActive:true,label:"Table 7"}, create:{id:"table_demo_7",restaurantId:restaurant.id,code:"T7",label:"Table 7"} });
  const existingOwner = await prisma.staffUser.findFirst({ where: { phone: ownerPhone } });
  const owner = existingOwner
    ? await prisma.staffUser.update({
      where: { id: existingOwner.id },
      data: { name: "Demo Owner", phone: ownerPhone, role: StaffRole.OWNER },
    })
    : await prisma.staffUser.create({ data: { restaurantId: restaurant.id, name: "Demo Owner", phone: ownerPhone, role: StaffRole.OWNER } });
  await prisma.organizationMembership.upsert({where:{organizationId_staffUserId:{organizationId:organization.id,staffUserId:owner.id}},update:{role:"OWNER",isActive:true},create:{organizationId:organization.id,staffUserId:owner.id,role:"OWNER"}});
  const seeds = [
    {id:"c1",name:"Popular",sortOrder:1,items:[{id:"m1",name:"Paneer Tikka",description:"Charred cottage cheese, peppers and mint chutney",price:329,isVeg:true,tags:["Bestseller"]},{id:"m2",name:"Butter Chicken",description:"Tandoori chicken in a silky tomato gravy",price:449,isVeg:false,tags:["Chef's pick"]}]},
    {id:"c2",name:"Mains",sortOrder:2,items:[{id:"m3",name:"Dal Makhani",description:"Slow-cooked black lentils finished with cream",price:299,isVeg:true,tags:[]},{id:"m4",name:"Hyderabadi Biryani",description:"Fragrant basmati rice, saffron and spiced chicken",price:399,isVeg:false,tags:["Spicy"]}]},
    {id:"c3",name:"Drinks",sortOrder:3,items:[{id:"m5",name:"Mango Lassi",description:"Mango, yoghurt and a touch of cardamom",price:149,isVeg:true,tags:[]},{id:"m6",name:"Masala Lime Soda",description:"Fresh lime, soda and house spice blend",price:129,isVeg:true,tags:[]}]},
  ];
  for (const category of seeds) { await prisma.menuCategory.upsert({where:{id:category.id},update:{name:category.name,sortOrder:category.sortOrder},create:{id:category.id,restaurantId:restaurant.id,name:category.name,sortOrder:category.sortOrder}}); for(const item of category.items) await prisma.menuItem.upsert({where:{id:item.id},update:item,create:{...item,restaurantId:restaurant.id,categoryId:category.id,isAvailable:true}}); }
  console.log(`Seeded ${restaurant.name}, ${table.label}, ${previewTable.label}, demo owner ${ownerPhone}, and Restaurant Platform platform admin ${masterPhone}.`);
  console.log("Use Firebase phone OTP with your configured MASTER_ADMIN_PHONE value to sign in.");
}
main().finally(()=>prisma.$disconnect());

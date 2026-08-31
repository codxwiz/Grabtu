CREATE TYPE "OrganizationRole" AS ENUM ('OWNER', 'ADMIN', 'ANALYST', 'MEMBER');

CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrganizationMembership" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "staffUserId" TEXT NOT NULL,
    "role" "OrganizationRole" NOT NULL DEFAULT 'MEMBER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrganizationMembership_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrganizationMenuTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "content" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrganizationMenuTemplate_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Restaurant" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "Restaurant" ADD COLUMN "locationCode" TEXT;
ALTER TABLE "Restaurant" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata';

INSERT INTO "Organization" ("id", "name", "slug", "createdAt", "updatedAt")
SELECT 'org_' || md5("id"), "name", "slug", "createdAt", CURRENT_TIMESTAMP
FROM "Restaurant";

UPDATE "Restaurant"
SET "organizationId" = 'org_' || md5("id"),
    "locationCode" = upper(substr(md5("id"), 1, 8));

ALTER TABLE "Restaurant" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Restaurant" ALTER COLUMN "locationCode" SET NOT NULL;

INSERT INTO "OrganizationMembership" ("id", "organizationId", "staffUserId", "role", "isActive", "createdAt", "updatedAt")
SELECT md5(s."id" || ':organization-membership'), r."organizationId", s."id",
       CASE WHEN s."role" = 'OWNER' THEN 'OWNER'::"OrganizationRole" ELSE 'MEMBER'::"OrganizationRole" END,
       s."isActive", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "StaffUser" s
JOIN "Restaurant" r ON r."id" = s."restaurantId";

CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");
CREATE UNIQUE INDEX "OrganizationMembership_organizationId_staffUserId_key" ON "OrganizationMembership"("organizationId", "staffUserId");
CREATE INDEX "OrganizationMembership_staffUserId_isActive_idx" ON "OrganizationMembership"("staffUserId", "isActive");
CREATE UNIQUE INDEX "OrganizationMenuTemplate_organizationId_name_version_key" ON "OrganizationMenuTemplate"("organizationId", "name", "version");
CREATE INDEX "OrganizationMenuTemplate_organizationId_isActive_updatedAt_idx" ON "OrganizationMenuTemplate"("organizationId", "isActive", "updatedAt");
CREATE UNIQUE INDEX "Restaurant_organizationId_locationCode_key" ON "Restaurant"("organizationId", "locationCode");
CREATE INDEX "Restaurant_organizationId_isActive_idx" ON "Restaurant"("organizationId", "isActive");

ALTER TABLE "Restaurant" ADD CONSTRAINT "Restaurant_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrganizationMembership" ADD CONSTRAINT "OrganizationMembership_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizationMembership" ADD CONSTRAINT "OrganizationMembership_staffUserId_fkey"
FOREIGN KEY ("staffUserId") REFERENCES "StaffUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizationMenuTemplate" ADD CONSTRAINT "OrganizationMenuTemplate_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "KitchenTicketStatus" AS ENUM ('QUEUED', 'ACKNOWLEDGED', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InventoryMovementType" AS ENUM ('RECEIPT', 'CONSUMPTION', 'ADJUSTMENT', 'WASTE', 'RETURN', 'TRANSFER');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('BOOKED', 'CONFIRMED', 'SEATED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "WaitlistStatus" AS ENUM ('WAITING', 'NOTIFIED', 'SEATED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "FiscalDocumentStatus" AS ENUM ('ISSUED', 'VOID', 'REFUNDED');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('EXPECTED', 'MATCHED', 'MISMATCH', 'RESOLVED');

-- CreateEnum
CREATE TYPE "AccountingExportStatus" AS ENUM ('PENDING', 'GENERATED', 'DELIVERED', 'FAILED');

-- AlterTable
ALTER TABLE "MenuItem" ADD COLUMN     "gstRate" DECIMAL(5,2),
ADD COLUMN     "hsnCode" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "serviceChargeAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "subtotalAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "taxAmount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "hsnCode" TEXT,
ADD COLUMN     "taxAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "taxableAmount" INTEGER NOT NULL DEFAULT 0;

-- Backfill immutable financial snapshots for orders created before this migration.
UPDATE "OrderItem" AS item
SET "taxableAmount" = item."unitPrice" * item."quantity",
    "taxRate" = restaurant."taxPercent",
    "taxAmount" = ROUND((item."unitPrice" * item."quantity") * restaurant."taxPercent" / 100.0)
FROM "Order" AS customer_order
JOIN "Restaurant" AS restaurant ON restaurant."id" = customer_order."restaurantId"
WHERE customer_order."id" = item."orderId";

UPDATE "Order" AS customer_order
SET "subtotalAmount" = totals.subtotal,
    "serviceChargeAmount" = ROUND(totals.subtotal * restaurant."serviceChargePercent" / 100.0),
    "taxAmount" = GREATEST(
      0,
      customer_order."totalAmount" - totals.subtotal - ROUND(totals.subtotal * restaurant."serviceChargePercent" / 100.0)
    )
FROM (
  SELECT "orderId", COALESCE(SUM("unitPrice" * "quantity"), 0)::INTEGER AS subtotal
  FROM "OrderItem"
  GROUP BY "orderId"
) AS totals
JOIN "Restaurant" AS restaurant ON TRUE
WHERE totals."orderId" = customer_order."id"
  AND restaurant."id" = customer_order."restaurantId";

-- CreateTable
CREATE TABLE "KitchenStation" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#2e7d5b',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KitchenStation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KitchenStationCategory" (
    "stationId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,

    CONSTRAINT "KitchenStationCategory_pkey" PRIMARY KEY ("stationId","categoryId")
);

-- CreateTable
CREATE TABLE "KitchenTicket" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "status" "KitchenTicketStatus" NOT NULL DEFAULT 'QUEUED',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "acknowledgedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KitchenTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KitchenTicketItem" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "notes" TEXT,

    CONSTRAINT "KitchenTicketItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "onHand" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "reorderLevel" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "costPerUnitPaise" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipeIngredient" (
    "id" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "wastePercent" DECIMAL(5,2) NOT NULL DEFAULT 0,

    CONSTRAINT "RecipeIngredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryMovement" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "orderId" TEXT,
    "type" "InventoryMovementType" NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitCostPaise" INTEGER,
    "reason" TEXT,
    "reference" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gstin" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "expectedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderLine" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "orderedQuantity" DECIMAL(14,3) NOT NULL,
    "receivedQuantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "unitCostPaise" INTEGER NOT NULL,

    CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestProfile" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "visitCount" INTEGER NOT NULL DEFAULT 0,
    "totalSpend" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "tags" TEXT[],
    "consentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuestProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reservation" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "partySize" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 90,
    "status" "ReservationStatus" NOT NULL DEFAULT 'BOOKED',
    "source" TEXT NOT NULL DEFAULT 'restaurant',
    "notes" TEXT,
    "tableId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaitlistEntry" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "partySize" INTEGER NOT NULL,
    "quotedWaitMinutes" INTEGER NOT NULL,
    "status" "WaitlistStatus" NOT NULL DEFAULT 'WAITING',
    "notifiedAt" TIMESTAMP(3),
    "seatedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaitlistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestaurantFiscalProfile" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "gstin" TEXT,
    "stateCode" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "invoicePrefix" TEXT NOT NULL DEFAULT 'KN',
    "nextInvoiceNumber" INTEGER NOT NULL DEFAULT 1,
    "cgstPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "sgstPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "igstPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RestaurantFiscalProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxInvoice" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "status" "FiscalDocumentStatus" NOT NULL DEFAULT 'ISSUED',
    "subtotal" INTEGER NOT NULL,
    "taxableAmount" INTEGER NOT NULL,
    "cgstAmount" INTEGER NOT NULL DEFAULT 0,
    "sgstAmount" INTEGER NOT NULL DEFAULT 0,
    "igstAmount" INTEGER NOT NULL DEFAULT 0,
    "serviceChargeAmount" INTEGER NOT NULL DEFAULT 0,
    "totalAmount" INTEGER NOT NULL,
    "customerName" TEXT,
    "customerGstin" TEXT,
    "placeOfSupply" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "metadata" JSONB,

    CONSTRAINT "TaxInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxInvoiceLine" (
    "id" TEXT NOT NULL,
    "taxInvoiceId" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "hsnCode" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitPrice" INTEGER NOT NULL,
    "taxableAmount" INTEGER NOT NULL,
    "gstRate" DECIMAL(5,2) NOT NULL,
    "cgstAmount" INTEGER NOT NULL DEFAULT 0,
    "sgstAmount" INTEGER NOT NULL DEFAULT 0,
    "igstAmount" INTEGER NOT NULL DEFAULT 0,
    "totalAmount" INTEGER NOT NULL,

    CONSTRAINT "TaxInvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditNote" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "taxInvoiceId" TEXT NOT NULL,
    "creditNoteNumber" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "taxableAmount" INTEGER NOT NULL,
    "cgstAmount" INTEGER NOT NULL DEFAULT 0,
    "sgstAmount" INTEGER NOT NULL DEFAULT 0,
    "igstAmount" INTEGER NOT NULL DEFAULT 0,
    "totalAmount" INTEGER NOT NULL,
    "providerRefundId" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "CreditNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentSettlement" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerSettlementId" TEXT NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'EXPECTED',
    "grossAmount" INTEGER NOT NULL,
    "feeAmount" INTEGER NOT NULL DEFAULT 0,
    "taxAmount" INTEGER NOT NULL DEFAULT 0,
    "netAmount" INTEGER NOT NULL,
    "expectedAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "bankReference" TEXT,
    "mismatchReason" TEXT,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingIntegration" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "configCiphertext" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastExportAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountingIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingExport" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "integrationId" TEXT,
    "fromDate" TIMESTAMP(3) NOT NULL,
    "toDate" TIMESTAMP(3) NOT NULL,
    "status" "AccountingExportStatus" NOT NULL DEFAULT 'PENDING',
    "format" TEXT NOT NULL,
    "payload" JSONB,
    "recordCount" INTEGER NOT NULL DEFAULT 0,
    "checksum" TEXT,
    "error" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generatedAt" TIMESTAMP(3),

    CONSTRAINT "AccountingExport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KitchenStation_restaurantId_isActive_sortOrder_idx" ON "KitchenStation"("restaurantId", "isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "KitchenStation_restaurantId_code_key" ON "KitchenStation"("restaurantId", "code");

-- CreateIndex
CREATE INDEX "KitchenStationCategory_categoryId_idx" ON "KitchenStationCategory"("categoryId");

-- CreateIndex
CREATE INDEX "KitchenTicket_restaurantId_status_createdAt_idx" ON "KitchenTicket"("restaurantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "KitchenTicket_stationId_status_priority_createdAt_idx" ON "KitchenTicket"("stationId", "status", "priority", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "KitchenTicket_orderId_stationId_key" ON "KitchenTicket"("orderId", "stationId");

-- CreateIndex
CREATE INDEX "KitchenTicketItem_orderItemId_idx" ON "KitchenTicketItem"("orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "KitchenTicketItem_ticketId_orderItemId_key" ON "KitchenTicketItem"("ticketId", "orderItemId");

-- CreateIndex
CREATE INDEX "InventoryItem_restaurantId_isActive_name_idx" ON "InventoryItem"("restaurantId", "isActive", "name");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_restaurantId_sku_key" ON "InventoryItem"("restaurantId", "sku");

-- CreateIndex
CREATE INDEX "RecipeIngredient_inventoryItemId_idx" ON "RecipeIngredient"("inventoryItemId");

-- CreateIndex
CREATE UNIQUE INDEX "RecipeIngredient_menuItemId_inventoryItemId_key" ON "RecipeIngredient"("menuItemId", "inventoryItemId");

-- CreateIndex
CREATE INDEX "InventoryMovement_inventoryItemId_createdAt_idx" ON "InventoryMovement"("inventoryItemId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryMovement_restaurantId_type_createdAt_idx" ON "InventoryMovement"("restaurantId", "type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryMovement_restaurantId_idempotencyKey_key" ON "InventoryMovement"("restaurantId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "Vendor_restaurantId_isActive_idx" ON "Vendor"("restaurantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_restaurantId_name_key" ON "Vendor"("restaurantId", "name");

-- CreateIndex
CREATE INDEX "PurchaseOrder_restaurantId_status_createdAt_idx" ON "PurchaseOrder"("restaurantId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_restaurantId_number_key" ON "PurchaseOrder"("restaurantId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrderLine_purchaseOrderId_inventoryItemId_key" ON "PurchaseOrderLine"("purchaseOrderId", "inventoryItemId");

-- CreateIndex
CREATE INDEX "GuestProfile_restaurantId_name_idx" ON "GuestProfile"("restaurantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "GuestProfile_restaurantId_phone_key" ON "GuestProfile"("restaurantId", "phone");

-- CreateIndex
CREATE INDEX "Reservation_restaurantId_startsAt_status_idx" ON "Reservation"("restaurantId", "startsAt", "status");

-- CreateIndex
CREATE INDEX "Reservation_guestId_startsAt_idx" ON "Reservation"("guestId", "startsAt");

-- CreateIndex
CREATE INDEX "WaitlistEntry_restaurantId_status_createdAt_idx" ON "WaitlistEntry"("restaurantId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RestaurantFiscalProfile_restaurantId_key" ON "RestaurantFiscalProfile"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "TaxInvoice_orderId_key" ON "TaxInvoice"("orderId");

-- CreateIndex
CREATE INDEX "TaxInvoice_restaurantId_issuedAt_idx" ON "TaxInvoice"("restaurantId", "issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TaxInvoice_restaurantId_invoiceNumber_key" ON "TaxInvoice"("restaurantId", "invoiceNumber");

-- CreateIndex
CREATE INDEX "TaxInvoiceLine_taxInvoiceId_idx" ON "TaxInvoiceLine"("taxInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_orderId_key" ON "CreditNote"("orderId");

-- CreateIndex
CREATE INDEX "CreditNote_restaurantId_issuedAt_idx" ON "CreditNote"("restaurantId", "issuedAt");

-- CreateIndex
CREATE INDEX "CreditNote_taxInvoiceId_idx" ON "CreditNote"("taxInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_restaurantId_creditNoteNumber_key" ON "CreditNote"("restaurantId", "creditNoteNumber");

-- CreateIndex
CREATE INDEX "PaymentSettlement_restaurantId_status_createdAt_idx" ON "PaymentSettlement"("restaurantId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentSettlement_restaurantId_provider_providerSettlementI_key" ON "PaymentSettlement"("restaurantId", "provider", "providerSettlementId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingIntegration_restaurantId_provider_key" ON "AccountingIntegration"("restaurantId", "provider");

-- CreateIndex
CREATE INDEX "AccountingExport_restaurantId_createdAt_idx" ON "AccountingExport"("restaurantId", "createdAt");

-- CreateIndex
CREATE INDEX "AccountingExport_status_createdAt_idx" ON "AccountingExport"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "KitchenStation" ADD CONSTRAINT "KitchenStation_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KitchenStationCategory" ADD CONSTRAINT "KitchenStationCategory_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "KitchenStation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KitchenStationCategory" ADD CONSTRAINT "KitchenStationCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "MenuCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KitchenTicket" ADD CONSTRAINT "KitchenTicket_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KitchenTicket" ADD CONSTRAINT "KitchenTicket_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KitchenTicket" ADD CONSTRAINT "KitchenTicket_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "KitchenStation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KitchenTicketItem" ADD CONSTRAINT "KitchenTicketItem_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "KitchenTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KitchenTicketItem" ADD CONSTRAINT "KitchenTicketItem_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeIngredient" ADD CONSTRAINT "RecipeIngredient_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeIngredient" ADD CONSTRAINT "RecipeIngredient_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestProfile" ADD CONSTRAINT "GuestProfile_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "GuestProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "GuestProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestaurantFiscalProfile" ADD CONSTRAINT "RestaurantFiscalProfile_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxInvoice" ADD CONSTRAINT "TaxInvoice_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxInvoice" ADD CONSTRAINT "TaxInvoice_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxInvoiceLine" ADD CONSTRAINT "TaxInvoiceLine_taxInvoiceId_fkey" FOREIGN KEY ("taxInvoiceId") REFERENCES "TaxInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_taxInvoiceId_fkey" FOREIGN KEY ("taxInvoiceId") REFERENCES "TaxInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentSettlement" ADD CONSTRAINT "PaymentSettlement_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingIntegration" ADD CONSTRAINT "AccountingIntegration_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingExport" ADD CONSTRAINT "AccountingExport_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingExport" ADD CONSTRAINT "AccountingExport_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "AccountingIntegration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Step 1: add new columns as NULLABLE first (safe on existing rows)
ALTER TABLE "Business" ADD COLUMN "slug" TEXT;
ALTER TABLE "SwapOffer" ADD COLUMN "businessId" TEXT;
ALTER TABLE "SwapRequest" ADD COLUMN "businessId" TEXT;

-- Step 2: backfill Business.slug - oldest business (by createdAt) becomes 'tal-barber',
-- any other existing business gets a unique temporary slug derived from its id
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY "createdAt" ASC) AS rn
  FROM "Business"
)
UPDATE "Business" b
SET slug = CASE WHEN ranked.rn = 1 THEN 'tal-barber' ELSE 'business-' || substr(b.id, 1, 8) END
FROM ranked
WHERE b.id = ranked.id;

-- Step 3: backfill SwapOffer.businessId from its related Appointment
UPDATE "SwapOffer" so
SET "businessId" = a."businessId"
FROM "Appointment" a
WHERE so."appointmentId" = a.id;

-- Step 4: backfill SwapRequest.businessId from its offeredAppointment
UPDATE "SwapRequest" sr
SET "businessId" = a."businessId"
FROM "Appointment" a
WHERE sr."offeredAppointmentId" = a.id;

-- Step 5: safety net - catch any row that somehow wasn't backfilled above,
-- so the NOT NULL constraints below can never fail
UPDATE "Business" SET slug = 'business-' || substr(id, 1, 8) WHERE slug IS NULL;
UPDATE "SwapOffer" SET "businessId" = (SELECT id FROM "Business" ORDER BY "createdAt" ASC LIMIT 1) WHERE "businessId" IS NULL;
UPDATE "SwapRequest" SET "businessId" = (SELECT id FROM "Business" ORDER BY "createdAt" ASC LIMIT 1) WHERE "businessId" IS NULL;

-- Step 6: enforce NOT NULL now that every row has a value
ALTER TABLE "Business" ALTER COLUMN "slug" SET NOT NULL;
ALTER TABLE "SwapOffer" ALTER COLUMN "businessId" SET NOT NULL;
ALTER TABLE "SwapRequest" ALTER COLUMN "businessId" SET NOT NULL;

-- Step 7: unique constraint on slug
CREATE UNIQUE INDEX "Business_slug_key" ON "Business"("slug");

-- Step 8: businessId indexes
CREATE INDEX "Appointment_businessId_idx" ON "Appointment"("businessId");
CREATE INDEX "BlockedDay_businessId_idx" ON "BlockedDay"("businessId");
CREATE INDEX "Broadcast_businessId_idx" ON "Broadcast"("businessId");
CREATE INDEX "Provider_businessId_idx" ON "Provider"("businessId");
CREATE INDEX "Service_businessId_idx" ON "Service"("businessId");
CREATE INDEX "SwapOffer_businessId_idx" ON "SwapOffer"("businessId");
CREATE INDEX "SwapRequest_businessId_idx" ON "SwapRequest"("businessId");

-- Step 9: foreign keys for the new businessId columns
ALTER TABLE "SwapOffer" ADD CONSTRAINT "SwapOffer_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SwapRequest" ADD CONSTRAINT "SwapRequest_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

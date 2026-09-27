ALTER TABLE "Trip"
  ADD COLUMN "origin" TEXT,
  ADD COLUMN "travelerCount" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "tripType" TEXT NOT NULL DEFAULT 'leisure',
  ADD COLUMN "approvalStatus" TEXT NOT NULL DEFAULT 'NOT_SUBMITTED',
  ADD COLUMN "adminFeedback" TEXT,
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "reviewedById" TEXT,
  ADD COLUMN "requestedPlaces" JSONB,
  ADD COLUMN "requestedActivities" JSONB,
  ADD COLUMN "requestedActivityDays" JSONB,
  ADD COLUMN "companyName" TEXT;

CREATE TABLE "TripAdjustment" (
  "id" TEXT NOT NULL,
  "tripId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'APPLIED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TripAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TripAdjustment_tripId_createdAt_idx" ON "TripAdjustment"("tripId", "createdAt");
ALTER TABLE "TripAdjustment" ADD CONSTRAINT "TripAdjustment_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

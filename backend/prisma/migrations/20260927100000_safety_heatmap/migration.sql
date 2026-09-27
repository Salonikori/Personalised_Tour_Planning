CREATE TABLE "SafetyZone" (
  "id" TEXT NOT NULL,
  "zoneKey" TEXT NOT NULL,
  "centerLat" DOUBLE PRECISION NOT NULL,
  "centerLng" DOUBLE PRECISION NOT NULL,
  "reportCount" INTEGER NOT NULL DEFAULT 0,
  "aiStatus" TEXT NOT NULL DEFAULT 'SAFE',
  "aiReason" TEXT,
  "aiConfidence" DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SafetyZone_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SafetyZone_zoneKey_key" ON "SafetyZone"("zoneKey");
CREATE INDEX "SafetyZone_aiStatus_updatedAt_idx" ON "SafetyZone"("aiStatus", "updatedAt");

CREATE TABLE "SafetyReport" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tripId" TEXT,
  "zoneId" TEXT NOT NULL,
  "lat" DOUBLE PRECISION NOT NULL,
  "lng" DOUBLE PRECISION NOT NULL,
  "message" TEXT,
  "category" TEXT NOT NULL DEFAULT 'SAFETY_CONCERN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SafetyReport_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SafetyReport_zoneId_createdAt_idx" ON "SafetyReport"("zoneId", "createdAt");
CREATE INDEX "SafetyReport_lat_lng_createdAt_idx" ON "SafetyReport"("lat", "lng", "createdAt");
ALTER TABLE "SafetyReport" ADD CONSTRAINT "SafetyReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SafetyReport" ADD CONSTRAINT "SafetyReport_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SafetyReport" ADD CONSTRAINT "SafetyReport_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "SafetyZone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

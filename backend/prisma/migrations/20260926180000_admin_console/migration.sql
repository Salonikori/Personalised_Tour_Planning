-- Admin Console migration
-- ADMIN is already defined in the Prisma Role enum.

CREATE TABLE "PlatformSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "platformName" TEXT NOT NULL DEFAULT 'Voyara',
    "supportEmail" TEXT NOT NULL DEFAULT 'support@voyara.demo',
    "maintenanceMode" BOOLEAN NOT NULL DEFAULT false,
    "bookingFeePercent" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformSettings_pkey" PRIMARY KEY ("id")
);
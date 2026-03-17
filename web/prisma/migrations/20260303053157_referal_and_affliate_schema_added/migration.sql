-- CreateTable
CREATE TABLE "ReferralCode" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "referralCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliateUser" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "referralCode" TEXT NOT NULL,
    "referralLink" TEXT NOT NULL,
    "numberOfReferrals" INTEGER NOT NULL DEFAULT 0,
    "numberOfStoresSubscribed" INTEGER NOT NULL DEFAULT 0,
    "totalAmountEarned" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AffiliateUser_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReferralCode_shop_idx" ON "ReferralCode"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateUser_email_key" ON "AffiliateUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateUser_referralCode_key" ON "AffiliateUser"("referralCode");

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateUser_referralLink_key" ON "AffiliateUser"("referralLink");

-- CreateIndex
CREATE INDEX "AffiliateUser_referralCode_idx" ON "AffiliateUser"("referralCode");

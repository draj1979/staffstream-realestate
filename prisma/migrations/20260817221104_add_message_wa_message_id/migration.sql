-- AlterTable
ALTER TABLE "Message" ADD COLUMN "waMessageId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Message_waMessageId_key" ON "Message"("waMessageId");

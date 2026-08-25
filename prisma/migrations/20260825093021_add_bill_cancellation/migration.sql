-- AlterTable
ALTER TABLE `bills` ADD COLUMN `cancelled_at` DATETIME(3) NULL,
    ADD COLUMN `cancelled_by` INTEGER NULL;

-- AlterTable
ALTER TABLE `stock_transactions` MODIFY `type` ENUM('OPENING_STOCK', 'STOCK_IN', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'SALE', 'SALE_CANCEL') NOT NULL;

-- CreateIndex
CREATE INDEX `bills_cancelled_by_idx` ON `bills`(`cancelled_by`);

-- AddForeignKey
ALTER TABLE `bills` ADD CONSTRAINT `bills_cancelled_by_fkey` FOREIGN KEY (`cancelled_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

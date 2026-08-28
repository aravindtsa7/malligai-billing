-- 1. Create receipt_settings table
CREATE TABLE `receipt_settings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `store_name` VARCHAR(191) NOT NULL,
    `upi_id` VARCHAR(191) NULL,
    `gstin` VARCHAR(191) NULL,
    `show_cashier` BOOLEAN NOT NULL DEFAULT true,
    `show_rate_tier` BOOLEAN NOT NULL DEFAULT true,
    `show_payment` BOOLEAN NOT NULL DEFAULT true,
    `show_status` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 2. Insert default singleton row for receipt_settings
INSERT INTO `receipt_settings` (`id`, `store_name`, `upi_id`, `gstin`, `show_cashier`, `show_rate_tier`, `show_payment`, `show_status`, `created_at`, `updated_at`)
SELECT 1, 'Malligai Billing', NULL, NULL, true, true, true, true, NOW(3), NOW(3)
WHERE NOT EXISTS (SELECT 1 FROM `receipt_settings` WHERE `id` = 1);

-- 3. Add mrp_rate nullable initially to products
ALTER TABLE `products` ADD COLUMN `mrp_rate` DECIMAL(12, 2) NULL;

-- 4. Backfill mrp_rate from normal_rate for all existing products
UPDATE `products`
SET `mrp_rate` = `normal_rate`
WHERE `mrp_rate` IS NULL;

-- 5. Enforce NOT NULL on mrp_rate with default 0.00
ALTER TABLE `products` MODIFY `mrp_rate` DECIMAL(12, 2) NOT NULL DEFAULT 0.00;

-- 6. Add receipt snapshot columns to bills
ALTER TABLE `bills`
    ADD COLUMN `receipt_store_name` VARCHAR(191) NULL,
    ADD COLUMN `receipt_upi_id` VARCHAR(191) NULL,
    ADD COLUMN `receipt_gstin` VARCHAR(191) NULL,
    ADD COLUMN `receipt_show_cashier` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `receipt_show_rate_tier` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `receipt_show_payment` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `receipt_show_status` BOOLEAN NOT NULL DEFAULT true;

-- 7. Backfill existing bills with approved legacy defaults
UPDATE `bills`
SET `receipt_store_name` = 'Malligai Billing',
    `receipt_show_cashier` = true,
    `receipt_show_rate_tier` = true,
    `receipt_show_payment` = true,
    `receipt_show_status` = true
WHERE `receipt_store_name` IS NULL;

-- 8. Enforce NOT NULL on receipt_store_name
ALTER TABLE `bills` MODIFY `receipt_store_name` VARCHAR(191) NOT NULL;

-- 9. Add tamil_name to bill_items
ALTER TABLE `bill_items` ADD COLUMN `tamil_name` VARCHAR(191) NULL;

-- 10. Best-effort backfill bill_items.tamil_name from products.tamil_name
UPDATE `bill_items` bi
JOIN `products` p ON bi.`product_id` = p.`id`
SET bi.`tamil_name` = p.`tamil_name`
WHERE bi.`tamil_name` IS NULL AND p.`tamil_name` IS NOT NULL;

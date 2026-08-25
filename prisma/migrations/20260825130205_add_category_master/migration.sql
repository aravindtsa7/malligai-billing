-- 1. Create categories table
CREATE TABLE `categories` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `category_name` VARCHAR(191) NOT NULL,
    `tamil_name` VARCHAR(191) NULL,
    `display_order` INTEGER NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `categories_category_name_key`(`category_name`),
    INDEX `categories_active_display_order_idx`(`active`, `display_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 2. Insert default migration category 'General'
INSERT INTO `categories` (`category_name`, `tamil_name`, `display_order`, `active`, `created_at`, `updated_at`)
SELECT 'General', 'பொதுவானவை', 0, true, NOW(3), NOW(3)
WHERE NOT EXISTS (SELECT 1 FROM `categories` WHERE `category_name` = 'General');

-- 3. Add Product.category_id as nullable initially
ALTER TABLE `products` ADD COLUMN `category_id` INTEGER NULL;

-- 4. Backfill all existing products to General category
UPDATE `products`
SET `category_id` = (SELECT `id` FROM `categories` WHERE `category_name` = 'General' LIMIT 1)
WHERE `category_id` IS NULL;

-- 5. Make category_id required / NOT NULL
ALTER TABLE `products` MODIFY `category_id` INTEGER NOT NULL;

-- 6. Create index on products.category_id
CREATE INDEX `products_category_id_idx` ON `products`(`category_id`);

-- 7. Add foreign key constraint
ALTER TABLE `products` ADD CONSTRAINT `products_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;


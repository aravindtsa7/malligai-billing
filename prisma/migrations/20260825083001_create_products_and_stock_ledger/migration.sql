-- CreateTable
CREATE TABLE `products` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `product_code` VARCHAR(191) NOT NULL,
    `barcode` VARCHAR(191) NULL,
    `product_name` VARCHAR(191) NOT NULL,
    `tamil_name` VARCHAR(191) NULL,
    `unit` ENUM('KG', 'GRAM', 'LITRE', 'ML', 'PIECE', 'PACKET', 'BOX') NOT NULL,
    `original_rate` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `normal_rate` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `retail_rate` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `function_rate` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `current_stock` DECIMAL(12, 3) NOT NULL DEFAULT 0.000,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `products_product_code_key`(`product_code`),
    UNIQUE INDEX `products_barcode_key`(`barcode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stock_transactions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `product_id` INTEGER NOT NULL,
    `type` ENUM('OPENING_STOCK', 'STOCK_IN', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT') NOT NULL,
    `quantity` DECIMAL(12, 3) NOT NULL,
    `previous_stock` DECIMAL(12, 3) NOT NULL,
    `new_stock` DECIMAL(12, 3) NOT NULL,
    `created_by` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `note` VARCHAR(191) NULL,

    INDEX `stock_transactions_product_id_idx`(`product_id`),
    INDEX `stock_transactions_created_by_idx`(`created_by`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `stock_transactions` ADD CONSTRAINT `stock_transactions_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_transactions` ADD CONSTRAINT `stock_transactions_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE `product_rate_histories` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `product_id` INTEGER NOT NULL,
    `rate_type` ENUM('NORMAL', 'RETAIL', 'FUNCTION') NOT NULL,
    `old_rate` DECIMAL(12, 2) NOT NULL,
    `new_rate` DECIMAL(12, 2) NOT NULL,
    `changed_by` INTEGER NOT NULL,
    `changed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `product_rate_histories_product_id_idx`(`product_id`),
    INDEX `product_rate_histories_changed_by_idx`(`changed_by`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `product_rate_histories` ADD CONSTRAINT `product_rate_histories_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_rate_histories` ADD CONSTRAINT `product_rate_histories_changed_by_fkey` FOREIGN KEY (`changed_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

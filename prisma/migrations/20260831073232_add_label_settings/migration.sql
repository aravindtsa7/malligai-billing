-- CreateTable
CREATE TABLE `label_settings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `store_name` VARCHAR(191) NOT NULL,
    `default_label_size` ENUM('LABEL_50X40', 'LABEL_50X50') NOT NULL DEFAULT 'LABEL_50X40',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Insert default singleton row for label_settings
INSERT INTO `label_settings` (`id`, `store_name`, `default_label_size`, `created_at`, `updated_at`)
SELECT 1, 'MALLIGAI', 'LABEL_50X40', NOW(3), NOW(3)
WHERE NOT EXISTS (SELECT 1 FROM `label_settings` WHERE `id` = 1);


-- DropForeignKey
ALTER TABLE `product_rate_histories` DROP FOREIGN KEY `product_rate_histories_changed_by_fkey`;

-- DropForeignKey
ALTER TABLE `product_rate_histories` DROP FOREIGN KEY `product_rate_histories_product_id_fkey`;

-- DropTable
DROP TABLE `product_rate_histories`;

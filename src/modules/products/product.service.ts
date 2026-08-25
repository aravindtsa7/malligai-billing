import { prisma } from '../../core/database/prisma.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../core/errors/app-error.js';
import { Prisma } from '../../generated/prisma/client.js';
import { StockTransactionType } from '../../generated/prisma/enums.js';
import type { CreateProductInput, UpdateProductInput } from './product.schema.js';
import { serializeProduct, type SerializedProduct } from './product.types.js';

export class ProductService {
  async createProduct(input: CreateProductInput, userId: number): Promise<SerializedProduct> {
    const existingByCode = await prisma.product.findUnique({
      where: { productCode: input.productCode },
    });

    if (existingByCode) {
      throw new ConflictError(`Product code "${input.productCode}" already exists`);
    }

    if (input.barcode) {
      const existingByBarcode = await prisma.product.findUnique({
        where: { barcode: input.barcode },
      });

      if (existingByBarcode) {
        throw new ConflictError(`Barcode "${input.barcode}" already exists`);
      }
    }

    const openingStockVal = input.openingStock ? input.openingStock : '0';
    const hasOpeningStock = Number(openingStockVal) > 0;

    return await prisma.$transaction(async (tx) => {
      const categoryRows = await tx.$queryRaw<
        Array<{ id: number; category_name: string; active: number | boolean }>
      >`
        SELECT id, category_name, active
        FROM categories
        WHERE id = ${input.categoryId}
        FOR UPDATE
      `;

      if (!categoryRows || categoryRows.length === 0) {
        throw new NotFoundError(`Category with ID ${input.categoryId} not found`);
      }

      const categoryRow = categoryRows[0];
      if (!categoryRow.active) {
        throw new BadRequestError(
          `Category "${categoryRow.category_name}" is inactive and cannot be assigned to products`
        );
      }

      const product = await tx.product.create({
        data: {
          productCode: input.productCode,
          barcode: input.barcode,
          productName: input.productName,
          tamilName: input.tamilName,
          categoryId: input.categoryId,
          unit: input.unit,
          originalRate: input.originalRate,
          normalRate: input.normalRate,
          retailRate: input.retailRate,
          functionRate: input.functionRate,
          currentStock: openingStockVal,
          active: true,
        },
        include: {
          category: true,
        },
      });

      if (hasOpeningStock) {
        await tx.stockTransaction.create({
          data: {
            productId: product.id,
            type: StockTransactionType.OPENING_STOCK,
            quantity: openingStockVal,
            previousStock: '0',
            newStock: openingStockVal,
            createdBy: userId,
            note: 'Opening stock',
          },
        });
      }

      return serializeProduct(product);
    });
  }

  async updateProduct(id: number, input: UpdateProductInput): Promise<SerializedProduct> {
    if (input.categoryId !== undefined) {
      return await prisma.$transaction(async (tx) => {
        const product = await tx.product.findUnique({
          where: { id },
        });

        if (!product) {
          throw new NotFoundError(`Product with ID ${id} not found`);
        }

        if (input.productCode && input.productCode !== product.productCode) {
          const existing = await tx.product.findUnique({
            where: { productCode: input.productCode },
          });

          if (existing && existing.id !== id) {
            throw new ConflictError(`Product code "${input.productCode}" already exists`);
          }
        }

        if (input.barcode && input.barcode !== product.barcode) {
          const existing = await tx.product.findUnique({
            where: { barcode: input.barcode },
          });

          if (existing && existing.id !== id) {
            throw new ConflictError(`Barcode "${input.barcode}" already exists`);
          }
        }

        const categoryRows = await tx.$queryRaw<
          Array<{ id: number; category_name: string; active: number | boolean }>
        >`
          SELECT id, category_name, active
          FROM categories
          WHERE id = ${input.categoryId}
          FOR UPDATE
        `;

        if (!categoryRows || categoryRows.length === 0) {
          throw new NotFoundError(`Category with ID ${input.categoryId} not found`);
        }

        const categoryRow = categoryRows[0];
        if (!categoryRow.active) {
          throw new BadRequestError(
            `Category "${categoryRow.category_name}" is inactive and cannot be assigned to products`
          );
        }

        const updated = await tx.product.update({
          where: { id },
          data: {
            ...(input.productCode !== undefined ? { productCode: input.productCode } : {}),
            ...(input.barcode !== undefined ? { barcode: input.barcode } : {}),
            ...(input.productName !== undefined ? { productName: input.productName } : {}),
            ...(input.tamilName !== undefined ? { tamilName: input.tamilName } : {}),
            ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
            ...(input.unit !== undefined ? { unit: input.unit } : {}),
            ...(input.originalRate !== undefined ? { originalRate: input.originalRate } : {}),
            ...(input.normalRate !== undefined ? { normalRate: input.normalRate } : {}),
            ...(input.retailRate !== undefined ? { retailRate: input.retailRate } : {}),
            ...(input.functionRate !== undefined ? { functionRate: input.functionRate } : {}),
            ...(input.active !== undefined ? { active: input.active } : {}),
          },
          include: {
            category: true,
          },
        });

        return serializeProduct(updated);
      });
    }

    const product = await prisma.product.findUnique({
      where: { id },
    });

    if (!product) {
      throw new NotFoundError(`Product with ID ${id} not found`);
    }

    if (input.productCode && input.productCode !== product.productCode) {
      const existing = await prisma.product.findUnique({
        where: { productCode: input.productCode },
      });

      if (existing && existing.id !== id) {
        throw new ConflictError(`Product code "${input.productCode}" already exists`);
      }
    }

    if (input.barcode && input.barcode !== product.barcode) {
      const existing = await prisma.product.findUnique({
        where: { barcode: input.barcode },
      });

      if (existing && existing.id !== id) {
        throw new ConflictError(`Barcode "${input.barcode}" already exists`);
      }
    }

    const updated = await prisma.product.update({
      where: { id },
      data: {
        ...(input.productCode !== undefined ? { productCode: input.productCode } : {}),
        ...(input.barcode !== undefined ? { barcode: input.barcode } : {}),
        ...(input.productName !== undefined ? { productName: input.productName } : {}),
        ...(input.tamilName !== undefined ? { tamilName: input.tamilName } : {}),
        ...(input.unit !== undefined ? { unit: input.unit } : {}),
        ...(input.originalRate !== undefined ? { originalRate: input.originalRate } : {}),
        ...(input.normalRate !== undefined ? { normalRate: input.normalRate } : {}),
        ...(input.retailRate !== undefined ? { retailRate: input.retailRate } : {}),
        ...(input.functionRate !== undefined ? { functionRate: input.functionRate } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      },
      include: {
        category: true,
      },
    });

    return serializeProduct(updated);
  }

  async getProductById(id: number): Promise<SerializedProduct> {
    const product = await prisma.product.findUnique({
      where: { id },
      include: { category: true },
    });

    if (!product) {
      throw new NotFoundError(`Product with ID ${id} not found`);
    }

    return serializeProduct(product);
  }

  async searchProducts(query?: string, categoryId?: number): Promise<SerializedProduct[]> {
    const trimmed = query ? query.trim() : '';

    const where: Prisma.ProductWhereInput = {};

    if (categoryId !== undefined) {
      where.categoryId = categoryId;
    }

    if (trimmed !== '') {
      where.OR = [
        { productCode: { contains: trimmed } },
        { productName: { contains: trimmed } },
        { tamilName: { contains: trimmed } },
        { barcode: { contains: trimmed } },
      ];
    }

    const products = await prisma.product.findMany({
      where,
      include: { category: true },
      orderBy: { id: 'asc' },
    });

    return products.map(serializeProduct);
  }

  async getProductByBarcode(barcode: string): Promise<SerializedProduct> {
    const product = await prisma.product.findUnique({
      where: { barcode },
      include: { category: true },
    });

    if (!product) {
      throw new NotFoundError(`Product with barcode "${barcode}" not found`);
    }

    return serializeProduct(product);
  }

  async listProducts(categoryId?: number): Promise<SerializedProduct[]> {
    const where: Prisma.ProductWhereInput = {};

    if (categoryId !== undefined) {
      where.categoryId = categoryId;
    }

    const products = await prisma.product.findMany({
      where,
      include: { category: true },
      orderBy: { id: 'asc' },
    });

    return products.map(serializeProduct);
  }
}

export const productService = new ProductService();

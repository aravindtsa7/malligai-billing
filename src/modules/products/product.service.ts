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

    const mrpRate = new Prisma.Decimal(input.mrpRate).toFixed(2);
    const normalRate = new Prisma.Decimal(input.normalRate).toFixed(2);
    const originalRate = input.originalRate ? new Prisma.Decimal(input.originalRate).toFixed(2) : '0.00';
    const retailRate = input.retailRate ? new Prisma.Decimal(input.retailRate).toFixed(2) : normalRate;
    const functionRate = input.functionRate ? new Prisma.Decimal(input.functionRate).toFixed(2) : normalRate;

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
          mrpRate,
          originalRate,
          normalRate,
          retailRate,
          functionRate,
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

  private buildProductUpdateData(product: { normalRate: unknown }, input: UpdateProductInput): Prisma.ProductUncheckedUpdateInput {
    const data: Prisma.ProductUncheckedUpdateInput = {};

    if (input.productCode !== undefined) data.productCode = input.productCode;
    if (input.barcode !== undefined) data.barcode = input.barcode;
    if (input.productName !== undefined) data.productName = input.productName;
    if (input.tamilName !== undefined) data.tamilName = input.tamilName;
    if (input.unit !== undefined) data.unit = input.unit;
    if (input.active !== undefined) data.active = input.active;

    if (input.mrpRate !== undefined) {
      data.mrpRate = new Prisma.Decimal(input.mrpRate).toFixed(2);
    }

    if (input.normalRate !== undefined) {
      data.normalRate = new Prisma.Decimal(input.normalRate).toFixed(2);
    }

    const effectiveNormalRate =
      input.normalRate !== undefined
        ? new Prisma.Decimal(input.normalRate).toFixed(2)
        : new Prisma.Decimal(String(product.normalRate)).toFixed(2);

    if (input.originalRate === null) {
      data.originalRate = '0.00';
    } else if (input.originalRate !== undefined) {
      data.originalRate = new Prisma.Decimal(input.originalRate).toFixed(2);
    }

    if (input.retailRate === null) {
      data.retailRate = effectiveNormalRate;
    } else if (input.retailRate !== undefined) {
      data.retailRate = new Prisma.Decimal(input.retailRate).toFixed(2);
    }

    if (input.functionRate === null) {
      data.functionRate = effectiveNormalRate;
    } else if (input.functionRate !== undefined) {
      data.functionRate = new Prisma.Decimal(input.functionRate).toFixed(2);
    }

    return data;
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

        const updateData = this.buildProductUpdateData(product, input);
        updateData.categoryId = input.categoryId;

        const updated = await tx.product.update({
          where: { id },
          data: updateData,
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

    const updateData = this.buildProductUpdateData(product, input);

    const updated = await prisma.product.update({
      where: { id },
      data: updateData,
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

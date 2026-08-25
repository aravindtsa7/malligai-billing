import { prisma } from '../../core/database/prisma.js';
import { ConflictError, NotFoundError } from '../../core/errors/app-error.js';
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

    if (hasOpeningStock) {
      return await prisma.$transaction(async (tx) => {
        const product = await tx.product.create({
          data: {
            productCode: input.productCode,
            barcode: input.barcode,
            productName: input.productName,
            tamilName: input.tamilName,
            unit: input.unit,
            originalRate: input.originalRate,
            normalRate: input.normalRate,
            retailRate: input.retailRate,
            functionRate: input.functionRate,
            currentStock: openingStockVal,
            active: true,
          },
        });

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

        return serializeProduct(product);
      });
    }

    const product = await prisma.product.create({
      data: {
        productCode: input.productCode,
        barcode: input.barcode,
        productName: input.productName,
        tamilName: input.tamilName,
        unit: input.unit,
        originalRate: input.originalRate,
        normalRate: input.normalRate,
        retailRate: input.retailRate,
        functionRate: input.functionRate,
        currentStock: '0',
        active: true,
      },
    });

    return serializeProduct(product);
  }

  async updateProduct(id: number, input: UpdateProductInput): Promise<SerializedProduct> {
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
    });

    return serializeProduct(updated);
  }

  async getProductById(id: number): Promise<SerializedProduct> {
    const product = await prisma.product.findUnique({
      where: { id },
    });

    if (!product) {
      throw new NotFoundError(`Product with ID ${id} not found`);
    }

    return serializeProduct(product);
  }

  async searchProducts(query: string): Promise<SerializedProduct[]> {
    if (!query || query.trim() === '') {
      return this.listProducts();
    }

    const trimmed = query.trim();
    const products = await prisma.product.findMany({
      where: {
        OR: [
          { productCode: { contains: trimmed } },
          { productName: { contains: trimmed } },
          { tamilName: { contains: trimmed } },
          { barcode: { contains: trimmed } },
        ],
      },
      orderBy: { id: 'asc' },
    });

    return products.map(serializeProduct);
  }

  async getProductByBarcode(barcode: string): Promise<SerializedProduct> {
    const product = await prisma.product.findUnique({
      where: { barcode },
    });

    if (!product) {
      throw new NotFoundError(`Product with barcode "${barcode}" not found`);
    }

    return serializeProduct(product);
  }

  async listProducts(): Promise<SerializedProduct[]> {
    const products = await prisma.product.findMany({
      orderBy: { id: 'asc' },
    });

    return products.map(serializeProduct);
  }
}

export const productService = new ProductService();

import { prisma } from '../../core/database/prisma.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../core/errors/app-error.js';
import { Prisma } from '../../generated/prisma/client.js';
import { StockTransactionType } from '../../generated/prisma/enums.js';
import type { CreateProductInput, UpdateProductInput } from './product.schema.js';
import { serializeProduct, type SerializedProduct } from './product.types.js';

type ScanNamespaceRow = {
  id: number;
  product_code: string;
  barcode: string | null;
};

type LockedProductRow = ScanNamespaceRow & {
  normal_rate: unknown;
};

type PrismaTransactionError = {
  code?: unknown;
  meta?: {
    driverAdapterError?: {
      cause?: {
        kind?: unknown;
        originalCode?: unknown;
      };
    };
  };
};

export class ProductService {
  private async runScanNamespaceTransaction<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>
  ): Promise<T> {
    // Concurrent absent-key gap locks can deadlock at insert time. Retry only Prisma's
    // exact deadlock/write-conflict signals so the winner commits and the retry validates to 409.
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        });
      } catch (error) {
        const prismaError = error as PrismaTransactionError;
        const driverCause = prismaError.meta?.driverAdapterError?.cause;
        const isDeadlockOrWriteConflict =
          prismaError.code === 'P2034' ||
          (prismaError.code === 'P2010' &&
            driverCause?.kind === 'TransactionWriteConflict' &&
            driverCause.originalCode === '1213');

        if (!isDeadlockOrWriteConflict || attempt === maxAttempts) {
          throw error;
        }
      }
    }

    throw new Error('Scan namespace transaction retry loop exhausted');
  }

  private async lockAndValidateScanNamespace(
    tx: Prisma.TransactionClient,
    productId: number | null,
    targetProductCode: string,
    targetBarcode: string | null
  ): Promise<void> {
    const candidates = Array.from(
      new Set(targetBarcode ? [targetProductCode, targetBarcode] : [targetProductCode])
    ).sort();

    const productCodeMatches = new Map<string, ScanNamespaceRow[]>();
    for (const candidate of candidates) {
      const rows = await tx.$queryRaw<ScanNamespaceRow[]>`
        SELECT id, product_code, barcode
        FROM products FORCE INDEX (products_product_code_key)
        WHERE product_code = ${candidate}
        FOR UPDATE
      `;
      productCodeMatches.set(
        candidate,
        rows.filter((row) => row.id !== productId)
      );
    }

    const barcodeMatches = new Map<string, ScanNamespaceRow[]>();
    for (const candidate of candidates) {
      const rows = await tx.$queryRaw<ScanNamespaceRow[]>`
        SELECT id, product_code, barcode
        FROM products FORCE INDEX (products_barcode_key)
        WHERE barcode = ${candidate}
        FOR UPDATE
      `;
      barcodeMatches.set(
        candidate,
        rows.filter((row) => row.id !== productId)
      );
    }

    if (targetBarcode && targetBarcode === targetProductCode) {
      throw new ConflictError(`Barcode "${targetBarcode}" cannot be the same as product code`);
    }

    if (productCodeMatches.get(targetProductCode)?.length) {
      throw new ConflictError(`Product code "${targetProductCode}" already exists`);
    }

    if (barcodeMatches.get(targetProductCode)?.length) {
      throw new ConflictError(
        `Product code "${targetProductCode}" matches an existing product's barcode`
      );
    }

    if (targetBarcode && barcodeMatches.get(targetBarcode)?.length) {
      throw new ConflictError(`Barcode "${targetBarcode}" already exists`);
    }

    if (targetBarcode && productCodeMatches.get(targetBarcode)?.length) {
      throw new ConflictError(
        `Barcode "${targetBarcode}" matches an existing product's product code`
      );
    }
  }

  async createProduct(input: CreateProductInput, userId: number): Promise<SerializedProduct> {
    const openingStockVal = input.openingStock ? input.openingStock : '0';
    const hasOpeningStock = Number(openingStockVal) > 0;

    const mrpRate = new Prisma.Decimal(input.mrpRate).toFixed(2);
    const normalRate = new Prisma.Decimal(input.normalRate).toFixed(2);
    const originalRate = input.originalRate ? new Prisma.Decimal(input.originalRate).toFixed(2) : '0.00';
    const retailRate = input.retailRate ? new Prisma.Decimal(input.retailRate).toFixed(2) : normalRate;
    const functionRate = input.functionRate ? new Prisma.Decimal(input.functionRate).toFixed(2) : normalRate;

    return await this.runScanNamespaceTransaction(async (tx) => {
      const finalProductCode = input.productCode.trim();
      const finalBarcode = input.barcode?.trim() || null;

      await this.lockAndValidateScanNamespace(tx, null, finalProductCode, finalBarcode);

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
          productCode: finalProductCode,
          barcode: finalBarcode,
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
    return await this.runScanNamespaceTransaction(async (tx) => {
      const productRows = await tx.$queryRaw<LockedProductRow[]>`
        SELECT id, product_code, barcode, normal_rate
        FROM products FORCE INDEX (PRIMARY)
        WHERE id = ${id}
        FOR UPDATE
      `;

      if (!productRows || productRows.length === 0) {
        throw new NotFoundError(`Product with ID ${id} not found`);
      }

      const product = productRows[0];
      const finalProductCode =
        input.productCode !== undefined ? input.productCode.trim() : product.product_code;
      const finalBarcode =
        input.barcode !== undefined ? input.barcode?.trim() || null : product.barcode;

      await this.lockAndValidateScanNamespace(tx, id, finalProductCode, finalBarcode);

      if (input.categoryId !== undefined) {
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
      }

      const updateData = this.buildProductUpdateData({ normalRate: product.normal_rate }, input);
      if (input.productCode !== undefined) updateData.productCode = finalProductCode;
      if (input.barcode !== undefined) updateData.barcode = finalBarcode;
      if (input.categoryId !== undefined) updateData.categoryId = input.categoryId;

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

  async scanProduct(value: string): Promise<SerializedProduct> {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new BadRequestError('Scan value is required');
    }

    const product = await prisma.product.findFirst({
      where: {
        OR: [
          { productCode: trimmed },
          { barcode: trimmed },
        ],
      },
      include: { category: true },
    });

    if (!product) {
      throw new NotFoundError(`Product with code or barcode "${trimmed}" not found`);
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

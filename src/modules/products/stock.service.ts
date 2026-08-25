import { prisma } from '../../core/database/prisma.js';
import { Prisma } from '../../generated/prisma/client.js';
import { BadRequestError, NotFoundError } from '../../core/errors/app-error.js';
import { StockTransactionType } from '../../generated/prisma/enums.js';
import type { StockInInput, StockAdjustmentInput } from './product.schema.js';
import {
  serializeProduct,
  serializeStockTransaction,
  type SerializedProduct,
  type SerializedStockTransaction,
} from './product.types.js';

export interface StockMutationResult {
  product: SerializedProduct;
  transaction: SerializedStockTransaction;
}

export class StockService {
  async stockIn(
    productId: number,
    input: StockInInput,
    userId: number
  ): Promise<StockMutationResult> {
    return await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{ id: number; current_stock: unknown; active: number | boolean }>
      >`
        SELECT id, current_stock, active FROM products WHERE id = ${productId} FOR UPDATE
      `;

      if (!rows || rows.length === 0) {
        throw new NotFoundError(`Product with ID ${productId} not found`);
      }

      const row = rows[0];
      if (!row.active) {
        throw new BadRequestError('Cannot modify stock for inactive product');
      }

      const prevStockDec = new Prisma.Decimal(String(row.current_stock));
      const qtyDec = new Prisma.Decimal(input.quantity);
      const newStockDec = prevStockDec.add(qtyDec);
      const newStockStr = newStockDec.toFixed(3);
      const prevStockStr = prevStockDec.toFixed(3);
      const qtyStr = qtyDec.toFixed(3);

      const updatedProduct = await tx.product.update({
        where: { id: productId },
        data: {
          currentStock: newStockStr,
        },
      });

      const stockTx = await tx.stockTransaction.create({
        data: {
          productId,
          type: StockTransactionType.STOCK_IN,
          quantity: qtyStr,
          previousStock: prevStockStr,
          newStock: newStockStr,
          createdBy: userId,
          note: input.note ?? null,
        },
      });

      return {
        product: serializeProduct(updatedProduct),
        transaction: serializeStockTransaction(stockTx),
      };
    });
  }

  async stockAdjustment(
    productId: number,
    input: StockAdjustmentInput,
    userId: number
  ): Promise<StockMutationResult> {
    return await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{ id: number; current_stock: unknown; active: number | boolean }>
      >`
        SELECT id, current_stock, active FROM products WHERE id = ${productId} FOR UPDATE
      `;

      if (!rows || rows.length === 0) {
        throw new NotFoundError(`Product with ID ${productId} not found`);
      }

      const row = rows[0];
      if (!row.active) {
        throw new BadRequestError('Cannot modify stock for inactive product');
      }

      const prevStockDec = new Prisma.Decimal(String(row.current_stock));
      const qtyDec = new Prisma.Decimal(input.quantity);

      let newStockDec: Prisma.Decimal;
      if (input.type === StockTransactionType.ADJUSTMENT_IN) {
        newStockDec = prevStockDec.add(qtyDec);
      } else if (input.type === StockTransactionType.ADJUSTMENT_OUT) {
        if (prevStockDec.lessThan(qtyDec)) {
          throw new BadRequestError(
            `Insufficient stock for adjustment out: current stock is ${prevStockDec.toFixed(3)}, requested reduction is ${qtyDec.toFixed(3)}`
          );
        }
        newStockDec = prevStockDec.minus(qtyDec);
      } else {
        throw new BadRequestError(`Unsupported adjustment type: ${input.type}`);
      }

      const newStockStr = newStockDec.toFixed(3);
      const prevStockStr = prevStockDec.toFixed(3);
      const qtyStr = qtyDec.toFixed(3);

      const updatedProduct = await tx.product.update({
        where: { id: productId },
        data: {
          currentStock: newStockStr,
        },
      });

      const stockTx = await tx.stockTransaction.create({
        data: {
          productId,
          type: input.type,
          quantity: qtyStr,
          previousStock: prevStockStr,
          newStock: newStockStr,
          createdBy: userId,
          note: input.note ?? null,
        },
      });

      return {
        product: serializeProduct(updatedProduct),
        transaction: serializeStockTransaction(stockTx),
      };
    });
  }
}

export const stockService = new StockService();

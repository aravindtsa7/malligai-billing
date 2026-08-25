import { prisma } from '../../core/database/prisma.js';
import { Prisma } from '../../generated/prisma/client.js';
import { BadRequestError, NotFoundError, ConflictError } from '../../core/errors/app-error.js';
import {
  RateType,
  BillStatus,
  StockTransactionType,
  type Unit,
} from '../../generated/prisma/enums.js';
import type { CreateBillInput, ListBillsQueryInput } from './billing.schema.js';
import {
  serializeBill,
  getBillDatePrefix,
  type SerializedBill,
  type BillListResponse,
} from './billing.types.js';

interface PreparedBillItem {
  productId: number;
  productCode: string;
  productName: string;
  unit: Unit;
  quantity: Prisma.Decimal;
  rate: Prisma.Decimal;
  amount: Prisma.Decimal;
  previousStock: Prisma.Decimal;
  newStock: Prisma.Decimal;
}

export class BillingService {
  async createBill(input: CreateBillInput, userId: number, billDate: Date = new Date()): Promise<SerializedBill> {
    const sortedProductIds = [...new Set(input.items.map((it) => it.productId))].sort((a, b) => a - b);

    return await prisma.$transaction(async (tx) => {
      // 1. Lock products deterministically in ascending ID order
      const lockedProductRows = await tx.$queryRaw<
        Array<{
          id: number;
          product_code: string;
          product_name: string;
          unit: Unit;
          original_rate: unknown;
          normal_rate: unknown;
          retail_rate: unknown;
          function_rate: unknown;
          current_stock: unknown;
          active: number | boolean;
        }>
      >`
        SELECT id, product_code, product_name, unit, original_rate, normal_rate, retail_rate, function_rate, current_stock, active
        FROM products
        WHERE id IN (${Prisma.join(sortedProductIds)})
        ORDER BY id ASC
        FOR UPDATE
      `;

      const productMap = new Map(lockedProductRows.map((p) => [p.id, p]));

      // 2. Validate all products exist and are active
      for (const item of input.items) {
        const prod = productMap.get(item.productId);
        if (!prod) {
          throw new NotFoundError(`Product with ID ${item.productId} not found`);
        }
        if (!prod.active) {
          throw new BadRequestError(`Product "${prod.product_name}" is inactive and cannot be billed`);
        }
      }

      // 3. Calculate rates, amounts, and validate stock for each item
      let subtotalDec = new Prisma.Decimal('0.00');
      const preparedItems: PreparedBillItem[] = [];

      for (const item of input.items) {
        const prod = productMap.get(item.productId)!;

        let rateDec: Prisma.Decimal;
        if (input.rateType === RateType.NORMAL) {
          rateDec = new Prisma.Decimal(String(prod.normal_rate));
        } else if (input.rateType === RateType.RETAIL) {
          rateDec = new Prisma.Decimal(String(prod.retail_rate));
        } else if (input.rateType === RateType.FUNCTION) {
          rateDec = new Prisma.Decimal(String(prod.function_rate));
        } else {
          throw new BadRequestError(`Unsupported rate type: ${input.rateType}`);
        }

        const qtyDec = new Prisma.Decimal(item.quantity);
        const itemAmountDec = rateDec.mul(qtyDec);
        const currentStockDec = new Prisma.Decimal(String(prod.current_stock));

        if (currentStockDec.lessThan(qtyDec)) {
          throw new BadRequestError(
            `Insufficient stock for product "${prod.product_name}": available stock is ${currentStockDec.toFixed(3)}, requested quantity is ${qtyDec.toFixed(3)}`
          );
        }

        const newStockDec = currentStockDec.minus(qtyDec);
        subtotalDec = subtotalDec.add(itemAmountDec);

        preparedItems.push({
          productId: prod.id,
          productCode: prod.product_code,
          productName: prod.product_name,
          unit: prod.unit,
          quantity: qtyDec,
          rate: rateDec,
          amount: itemAmountDec,
          previousStock: currentStockDec,
          newStock: newStockDec,
        });
      }

      const totalAmountDec = subtotalDec;

      // 4. Generate unique, atomic deterministic bill number strictly based on Asia/Kolkata date
      const datePrefix = getBillDatePrefix(billDate);

      await tx.$executeRaw`
        INSERT INTO bill_sequences (prefix, last_number, updated_at)
        VALUES (${datePrefix}, 0, NOW(3))
        ON DUPLICATE KEY UPDATE id=id
      `;

      const seqRows = await tx.$queryRaw<Array<{ last_number: number }>>`
        SELECT last_number FROM bill_sequences WHERE prefix = ${datePrefix} FOR UPDATE
      `;

      const nextSeq = Number(seqRows[0].last_number) + 1;

      await tx.$executeRaw`
        UPDATE bill_sequences SET last_number = ${nextSeq} WHERE prefix = ${datePrefix}
      `;

      const billNumber = `${datePrefix}-${String(nextSeq).padStart(4, '0')}`;

      // 5. Create Bill record
      const bill = await tx.bill.create({
        data: {
          billNumber,
          rateType: input.rateType,
          paymentType: input.paymentType,
          subtotal: subtotalDec.toFixed(2),
          totalAmount: totalAmountDec.toFixed(2),
          status: BillStatus.COMPLETED,
          createdBy: userId,
        },
      });

      // 6. Create BillItems snapshot
      await tx.billItem.createMany({
        data: preparedItems.map((pi) => ({
          billId: bill.id,
          productId: pi.productId,
          productCode: pi.productCode,
          productName: pi.productName,
          unit: pi.unit,
          quantity: pi.quantity.toFixed(3),
          rateType: input.rateType,
          rate: pi.rate.toFixed(2),
          amount: pi.amount.toFixed(2),
        })),
      });

      // 7. Update Product currentStock & Create SALE StockTransaction for each item
      for (const pi of preparedItems) {
        await tx.product.update({
          where: { id: pi.productId },
          data: {
            currentStock: pi.newStock.toFixed(3),
          },
        });

        await tx.stockTransaction.create({
          data: {
            productId: pi.productId,
            type: StockTransactionType.SALE,
            quantity: pi.quantity.toFixed(3),
            previousStock: pi.previousStock.toFixed(3),
            newStock: pi.newStock.toFixed(3),
            createdBy: userId,
            billId: bill.id,
            note: `Bill #${bill.billNumber}`,
          },
        });
      }

      // 8. Fetch complete bill with relations for serialized response
      const completeBill = await tx.bill.findUniqueOrThrow({
        where: { id: bill.id },
        include: {
          items: true,
          creator: {
            select: { id: true, username: true, role: true },
          },
        },
      });

      return serializeBill(completeBill);
    });
  }

  async listBills(query: ListBillsQueryInput): Promise<BillListResponse> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.BillWhereInput = {};

    if (query.rateType) {
      where.rateType = query.rateType;
    }

    if (query.paymentType) {
      where.paymentType = query.paymentType;
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) {
        where.createdAt.gte = new Date(query.startDate);
      }
      if (query.endDate) {
        where.createdAt.lte = new Date(query.endDate);
      }
    }

    const [total, bills] = await Promise.all([
      prisma.bill.count({ where }),
      prisma.bill.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: {
          creator: {
            select: { id: true, username: true, role: true },
          },
          canceller: {
            select: { id: true, username: true, role: true },
          },
        },
      }),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    return {
      bills: bills.map(serializeBill),
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    };
  }

  async getBillById(id: number): Promise<SerializedBill> {
    const bill = await prisma.bill.findUnique({
      where: { id },
      include: {
        items: true,
        creator: {
          select: { id: true, username: true, role: true },
        },
        canceller: {
          select: { id: true, username: true, role: true },
        },
      },
    });

    if (!bill) {
      throw new NotFoundError(`Bill with ID ${id} not found`);
    }

    return serializeBill(bill);
  }

  async cancelBill(id: number, adminUserId: number): Promise<SerializedBill> {
    return await prisma.$transaction(async (tx) => {
      // 1. Lock the Bill row using SELECT ... FOR UPDATE
      const billRows = await tx.$queryRaw<
        Array<{
          id: number;
          bill_number: string;
          status: BillStatus;
        }>
      >`
        SELECT id, bill_number, status
        FROM bills
        WHERE id = ${id}
        FOR UPDATE
      `;

      // 2. If Bill does not exist: return 404
      if (!billRows || billRows.length === 0) {
        throw new NotFoundError(`Bill with ID ${id} not found`);
      }

      const billRow = billRows[0];

      // 3. If Bill.status is already CANCELLED: reject with controlled conflict (409)
      if (billRow.status === BillStatus.CANCELLED) {
        throw new ConflictError(`Bill "${billRow.bill_number}" is already cancelled`);
      }

      // 4. Load the immutable BillItems
      const billItems = await tx.billItem.findMany({
        where: { billId: id },
      });

      // 5. Determine all affected product IDs
      const sortedProductIds = [...new Set(billItems.map((it) => it.productId))].sort((a, b) => a - b);

      if (sortedProductIds.length > 0) {
        // 6 & 7. Lock all Product rows in deterministic ascending ID order
        const lockedProductRows = await tx.$queryRaw<
          Array<{
            id: number;
            product_name: string;
            current_stock: unknown;
            active: number | boolean;
          }>
        >`
          SELECT id, product_name, current_stock, active
          FROM products
          WHERE id IN (${Prisma.join(sortedProductIds)})
          ORDER BY id ASC
          FOR UPDATE
        `;

        // Maintain in-memory tracking of current stock per product
        const stockMap = new Map<number, Prisma.Decimal>();
        for (const p of lockedProductRows) {
          stockMap.set(p.id, new Prisma.Decimal(String(p.current_stock)));
        }

        // 8 & 9. Restore stock and record SALE_CANCEL transaction for each item
        for (const item of billItems) {
          const currentStockDec = stockMap.get(item.productId);
          if (!currentStockDec) {
            throw new NotFoundError(`Product with ID ${item.productId} not found`);
          }

          const qtyDec = new Prisma.Decimal(String(item.quantity));
          const newStockDec = currentStockDec.add(qtyDec);
          stockMap.set(item.productId, newStockDec);

          // Update Product currentStock (even if inactive)
          await tx.product.update({
            where: { id: item.productId },
            data: {
              currentStock: newStockDec.toFixed(3),
            },
          });

          // Create SALE_CANCEL StockTransaction
          await tx.stockTransaction.create({
            data: {
              productId: item.productId,
              type: StockTransactionType.SALE_CANCEL,
              quantity: qtyDec.toFixed(3),
              previousStock: currentStockDec.toFixed(3),
              newStock: newStockDec.toFixed(3),
              createdBy: adminUserId,
              billId: id,
              note: `Cancellation of Bill #${billRow.bill_number}`,
            },
          });
        }
      }

      // 10 & 11. Mark Bill.status = CANCELLED, set cancelledAt and cancelledBy
      const cancelledAt = new Date();
      await tx.bill.update({
        where: { id },
        data: {
          status: BillStatus.CANCELLED,
          cancelledAt,
          cancelledBy: adminUserId,
        },
      });

      // 12. Fetch complete cancelled bill with items and creator/canceller audit metadata
      const updatedBill = await tx.bill.findUniqueOrThrow({
        where: { id },
        include: {
          items: true,
          creator: {
            select: { id: true, username: true, role: true },
          },
          canceller: {
            select: { id: true, username: true, role: true },
          },
        },
      });

      return serializeBill(updatedBill);
    });
  }
}

export const billingService = new BillingService();


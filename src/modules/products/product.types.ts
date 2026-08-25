import { Prisma } from '../../generated/prisma/client.js';
import type { Unit, StockTransactionType } from '../../generated/prisma/enums.js';

export interface SerializedProduct {
  id: number;
  productCode: string;
  barcode: string | null;
  productName: string;
  tamilName: string | null;
  unit: Unit;
  originalRate: string;
  normalRate: string;
  retailRate: string;
  functionRate: string;
  currentStock: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SerializedStockTransaction {
  id: number;
  productId: number;
  type: StockTransactionType;
  quantity: string;
  previousStock: string;
  newStock: string;
  createdBy: number;
  createdAt: Date;
  note: string | null;
}

export function formatRate(val: unknown): string {
  if (val === null || val === undefined) return '0.00';
  return new Prisma.Decimal(String(val)).toFixed(2);
}

export function formatQuantity(val: unknown): string {
  if (val === null || val === undefined) return '0.000';
  return new Prisma.Decimal(String(val)).toFixed(3);
}

export function serializeProduct(product: {
  id: number;
  productCode: string;
  barcode: string | null;
  productName: string;
  tamilName: string | null;
  unit: Unit;
  originalRate: unknown;
  normalRate: unknown;
  retailRate: unknown;
  functionRate: unknown;
  currentStock: unknown;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}): SerializedProduct {
  return {
    id: product.id,
    productCode: product.productCode,
    barcode: product.barcode ?? null,
    productName: product.productName,
    tamilName: product.tamilName ?? null,
    unit: product.unit,
    originalRate: formatRate(product.originalRate),
    normalRate: formatRate(product.normalRate),
    retailRate: formatRate(product.retailRate),
    functionRate: formatRate(product.functionRate),
    currentStock: formatQuantity(product.currentStock),
    active: product.active,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

export function serializeStockTransaction(tx: {
  id: number;
  productId: number;
  type: StockTransactionType;
  quantity: unknown;
  previousStock: unknown;
  newStock: unknown;
  createdBy: number;
  createdAt: Date;
  note: string | null;
}): SerializedStockTransaction {
  return {
    id: tx.id,
    productId: tx.productId,
    type: tx.type,
    quantity: formatQuantity(tx.quantity),
    previousStock: formatQuantity(tx.previousStock),
    newStock: formatQuantity(tx.newStock),
    createdBy: tx.createdBy,
    createdAt: tx.createdAt,
    note: tx.note ?? null,
  };
}

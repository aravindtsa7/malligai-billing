import { Prisma } from '../../generated/prisma/client.js';
import type { Unit, RateType, PaymentType, BillStatus, Role } from '../../generated/prisma/enums.js';

export interface SerializedBillItem {
  id: number;
  billId: number;
  productId: number;
  productCode: string;
  productName: string;
  unit: Unit;
  quantity: string;
  rateType: RateType;
  rate: string;
  amount: string;
  createdAt: Date;
}

export interface SerializedBillCreator {
  id: number;
  username: string;
  role: Role;
}

export interface SerializedBill {
  id: number;
  billNumber: string;
  rateType: RateType;
  paymentType: PaymentType;
  subtotal: string;
  totalAmount: string;
  status: BillStatus;
  createdBy: number;
  cancelledAt?: Date | null;
  cancelledBy?: number | null;
  createdAt: Date;
  updatedAt: Date;
  creator?: SerializedBillCreator;
  canceller?: SerializedBillCreator | null;
  items?: SerializedBillItem[];
}

export interface BillPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface BillListResponse {
  bills: SerializedBill[];
  pagination: BillPagination;
}

/**
 * Generates the bill prefix (e.g. BILL-YYYYMMDD) strictly based on
 * Asia/Kolkata (IST = UTC + 5:30) calendar date.
 * Independent of host OS, process local timezone, or TZ environment variable.
 */
export function getBillDatePrefix(date: Date = new Date()): string {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // 19,800,000 ms
  const istDate = new Date(date.getTime() + IST_OFFSET_MS);

  const yyyy = istDate.getUTCFullYear();
  const mm = String(istDate.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(istDate.getUTCDate()).padStart(2, '0');

  return `BILL-${yyyy}${mm}${dd}`;
}

export function formatRate(val: unknown): string {
  if (val === null || val === undefined) return '0.00';
  return new Prisma.Decimal(String(val)).toFixed(2);
}

export function formatQuantity(val: unknown): string {
  if (val === null || val === undefined) return '0.000';
  return new Prisma.Decimal(String(val)).toFixed(3);
}

export function serializeBillItem(item: {
  id: number;
  billId: number;
  productId: number;
  productCode: string;
  productName: string;
  unit: Unit;
  quantity: unknown;
  rateType: RateType;
  rate: unknown;
  amount: unknown;
  createdAt: Date;
}): SerializedBillItem {
  return {
    id: item.id,
    billId: item.billId,
    productId: item.productId,
    productCode: item.productCode,
    productName: item.productName,
    unit: item.unit,
    quantity: formatQuantity(item.quantity),
    rateType: item.rateType,
    rate: formatRate(item.rate),
    amount: formatRate(item.amount),
    createdAt: item.createdAt,
  };
}

export function serializeBill(bill: {
  id: number;
  billNumber: string;
  rateType: RateType;
  paymentType: PaymentType;
  subtotal: unknown;
  totalAmount: unknown;
  status: BillStatus;
  createdBy: number;
  cancelledAt?: Date | null;
  cancelledBy?: number | null;
  createdAt: Date;
  updatedAt: Date;
  creator?: {
    id: number;
    username: string;
    role: Role;
  } | null;
  canceller?: {
    id: number;
    username: string;
    role: Role;
  } | null;
  items?: Array<{
    id: number;
    billId: number;
    productId: number;
    productCode: string;
    productName: string;
    unit: Unit;
    quantity: unknown;
    rateType: RateType;
    rate: unknown;
    amount: unknown;
    createdAt: Date;
  }>;
}): SerializedBill {
  const result: SerializedBill = {
    id: bill.id,
    billNumber: bill.billNumber,
    rateType: bill.rateType,
    paymentType: bill.paymentType,
    subtotal: formatRate(bill.subtotal),
    totalAmount: formatRate(bill.totalAmount),
    status: bill.status,
    createdBy: bill.createdBy,
    cancelledAt: bill.cancelledAt ?? null,
    cancelledBy: bill.cancelledBy ?? null,
    createdAt: bill.createdAt,
    updatedAt: bill.updatedAt,
  };

  if (bill.creator) {
    result.creator = {
      id: bill.creator.id,
      username: bill.creator.username,
      role: bill.creator.role,
    };
  }

  if (bill.canceller) {
    result.canceller = {
      id: bill.canceller.id,
      username: bill.canceller.username,
      role: bill.canceller.role,
    };
  }

  if (bill.items) {
    result.items = bill.items.map(serializeBillItem);
  }

  return result;
}


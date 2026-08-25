import { z } from 'zod';
import { RateType, PaymentType, BillStatus } from '../../generated/prisma/enums.js';

const positiveQuantityDecimal = z
  .union([z.number(), z.string()])
  .refine(
    (val) => {
      const num = Number(val);
      return !isNaN(num) && num > 0;
    },
    { message: 'Quantity must be greater than 0' }
  )
  .transform((val) => String(val));

export const billItemInputSchema = z.object({
  productId: z.number().int().positive('Product ID must be a positive integer'),
  quantity: positiveQuantityDecimal,
});

export const createBillSchema = z
  .object({
    rateType: z.nativeEnum(RateType, {
      message: `rateType must be one of: ${Object.values(RateType).join(', ')}`,
    }),
    paymentType: z.nativeEnum(PaymentType, {
      message: `paymentType must be one of: ${Object.values(PaymentType).join(', ')}`,
    }),
    items: z.array(billItemInputSchema).min(1, 'Bill must contain at least one item'),
  })
  .superRefine((data, ctx) => {
    const seen = new Set<number>();
    for (let i = 0; i < data.items.length; i++) {
      const pId = data.items[i].productId;
      if (seen.has(pId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate product ID ${pId} in items list. Combine quantities into a single item.`,
          path: ['items', i, 'productId'],
        });
      }
      seen.add(pId);
    }
  });

export const listBillsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  rateType: z.nativeEnum(RateType).optional(),
  paymentType: z.nativeEnum(PaymentType).optional(),
  status: z.nativeEnum(BillStatus).optional(),
});

export const billIdParamSchema = z.object({
  id: z.coerce.number().int().positive('ID must be a positive integer'),
});

export type CreateBillInput = z.infer<typeof createBillSchema>;
export type BillItemInput = z.infer<typeof billItemInputSchema>;
export type ListBillsQueryInput = z.infer<typeof listBillsQuerySchema>;


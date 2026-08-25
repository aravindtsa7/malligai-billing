import { z } from 'zod';
import { Unit } from '../../generated/prisma/enums.js';

const nonNegativeDecimal = z
  .union([z.number(), z.string()])
  .refine(
    (val) => {
      const num = Number(val);
      return !isNaN(num) && num >= 0;
    },
    { message: 'Must be a non-negative number' }
  )
  .transform((val) => String(val));

const positiveDecimal = z
  .union([z.number(), z.string()])
  .refine(
    (val) => {
      const num = Number(val);
      return !isNaN(num) && num > 0;
    },
    { message: 'Quantity must be greater than 0' }
  )
  .transform((val) => String(val));

export const createProductSchema = z.object({
  productCode: z
    .string({ message: 'Product code is required' })
    .trim()
    .min(1, 'Product code cannot be empty'),
  barcode: z
    .string()
    .trim()
    .nullish()
    .transform((val) => (val === '' ? null : (val ?? null))),
  productName: z
    .string({ message: 'Product name is required' })
    .trim()
    .min(1, 'Product name cannot be empty'),
  tamilName: z
    .string()
    .trim()
    .nullish()
    .transform((val) => (val === '' ? null : (val ?? null))),
  unit: z.nativeEnum(Unit, {
    message: `Unit must be one of: ${Object.values(Unit).join(', ')}`,
  }),
  originalRate: nonNegativeDecimal.default('0'),
  normalRate: nonNegativeDecimal.default('0'),
  retailRate: nonNegativeDecimal.default('0'),
  functionRate: nonNegativeDecimal.default('0'),
  openingStock: nonNegativeDecimal.optional(),
});

export const updateProductSchema = z
  .object({
    productCode: z.string().trim().min(1, 'Product code cannot be empty').optional(),
    barcode: z
      .string()
      .trim()
      .nullish()
      .transform((val) => (val === '' ? null : (val ?? null))),
    productName: z.string().trim().min(1, 'Product name cannot be empty').optional(),
    tamilName: z
      .string()
      .trim()
      .nullish()
      .transform((val) => (val === '' ? null : (val ?? null))),
    unit: z.nativeEnum(Unit).optional(),
    originalRate: nonNegativeDecimal.optional(),
    normalRate: nonNegativeDecimal.optional(),
    retailRate: nonNegativeDecimal.optional(),
    functionRate: nonNegativeDecimal.optional(),
    active: z.boolean().optional(),
    currentStock: z.any().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.currentStock !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'currentStock cannot be modified via product update. Use stock-in or stock-adjustment endpoints.',
        path: ['currentStock'],
      });
    }
  })
  .transform(({ currentStock: _ignored, ...rest }) => rest);

export const stockInSchema = z.object({
  quantity: positiveDecimal,
  note: z.string().trim().optional(),
});

export const stockAdjustmentSchema = z.object({
  type: z.enum(['ADJUSTMENT_IN', 'ADJUSTMENT_OUT'], {
    message: 'Type must be ADJUSTMENT_IN or ADJUSTMENT_OUT',
  }),
  quantity: positiveDecimal,
  note: z.string().trim().optional(),
});

export const idParamSchema = z.object({
  id: z.coerce.number().int().positive('ID must be a positive integer'),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type StockInInput = z.infer<typeof stockInSchema>;
export type StockAdjustmentInput = z.infer<typeof stockAdjustmentSchema>;

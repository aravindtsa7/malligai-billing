import { z } from 'zod';
import { Unit } from '../../generated/prisma/enums.js';

const nonNegativeDecimal = z
  .union([z.number(), z.string()])
  .refine(
    (val) => {
      if (typeof val === 'string' && val.trim() === '') return false;
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
      if (typeof val === 'string' && val.trim() === '') return false;
      const num = Number(val);
      return !isNaN(num) && num > 0;
    },
    { message: 'Quantity must be greater than 0' }
  )
  .transform((val) => String(val));

const requiredNonNegativeDecimal = z
  .union([z.number(), z.string({ message: 'Must be a non-negative number' })], {
    message: 'Rate is required and must be a non-negative number',
  })
  .refine(
    (val) => {
      if (typeof val === 'string' && val.trim() === '') return false;
      const num = Number(val);
      return !isNaN(num) && num >= 0;
    },
    { message: 'Must be a valid non-negative number' }
  )
  .transform((val) => String(val));

const optionalRateDecimal = z
  .union([z.number(), z.string()])
  .nullish()
  .refine(
    (val) => {
      if (val === undefined || val === null || val === '') return true;
      const num = Number(val);
      return !isNaN(num) && num >= 0;
    },
    { message: 'Must be a valid non-negative number' }
  )
  .transform((val) => {
    if (val === undefined || val === null || val === '') return undefined;
    return String(val);
  });

const clearableRateDecimal = z
  .union([z.number(), z.string()])
  .nullish()
  .refine(
    (val) => {
      if (val === undefined || val === null || val === '') return true;
      const num = Number(val);
      return !isNaN(num) && num >= 0;
    },
    { message: 'Must be a valid non-negative number' }
  )
  .transform((val) => {
    if (val === undefined) return undefined;
    if (val === null || val === '') return null;
    return String(val);
  });

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
  categoryId: z
    .number({ message: 'Category ID is required' })
    .int('Category ID must be an integer')
    .positive('Category ID must be a positive integer'),
  unit: z.nativeEnum(Unit, {
    message: `Unit must be one of: ${Object.values(Unit).join(', ')}`,
  }),
  mrpRate: requiredNonNegativeDecimal,
  normalRate: requiredNonNegativeDecimal,
  originalRate: optionalRateDecimal.optional(),
  retailRate: optionalRateDecimal.optional(),
  functionRate: optionalRateDecimal.optional(),
  openingStock: nonNegativeDecimal.optional(),
});

export const updateProductSchema = z
  .object({
    productCode: z.string().trim().min(1, 'Product code cannot be empty').optional(),
    barcode: z
      .string()
      .trim()
      .nullish()
      .transform((val) => {
        if (val === undefined) return undefined;
        return val === '' || val === null ? null : val;
      }),
    productName: z.string().trim().min(1, 'Product name cannot be empty').optional(),
    tamilName: z
      .string()
      .trim()
      .nullish()
      .transform((val) => {
        if (val === undefined) return undefined;
        return val === '' || val === null ? null : val;
      }),
    categoryId: z
      .number()
      .int('Category ID must be an integer')
      .positive('Category ID must be a positive integer')
      .optional(),
    unit: z.nativeEnum(Unit).optional(),
    mrpRate: requiredNonNegativeDecimal.optional(),
    normalRate: requiredNonNegativeDecimal.optional(),
    originalRate: clearableRateDecimal.optional(),
    retailRate: clearableRateDecimal.optional(),
    functionRate: clearableRateDecimal.optional(),
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

export const listProductsQuerySchema = z.object({
  categoryId: z.coerce.number().int().positive('Category ID must be a positive integer').optional(),
});

export const searchProductsQuerySchema = z.object({
  q: z.string().optional().default(''),
  categoryId: z.coerce.number().int().positive('Category ID must be a positive integer').optional(),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type StockInInput = z.infer<typeof stockInSchema>;
export type StockAdjustmentInput = z.infer<typeof stockAdjustmentSchema>;
export type ListProductsQueryInput = z.infer<typeof listProductsQuerySchema>;
export type SearchProductsQueryInput = z.infer<typeof searchProductsQuerySchema>;

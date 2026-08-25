import { z } from 'zod';

export const createCategorySchema = z.object({
  categoryName: z
    .string({ message: 'Category name is required' })
    .trim()
    .min(1, 'Category name cannot be empty')
    .max(191, 'Category name is too long'),
  tamilName: z
    .string()
    .trim()
    .max(191, 'Tamil name is too long')
    .nullish()
    .transform((val) => (val === '' ? null : (val ?? null))),
  displayOrder: z
    .number({ message: 'Display order must be an integer' })
    .int('Display order must be an integer')
    .min(0, 'Display order must be a non-negative integer')
    .default(0),
});

export const updateCategorySchema = z.object({
  categoryName: z
    .string()
    .trim()
    .min(1, 'Category name cannot be empty')
    .max(191, 'Category name is too long')
    .optional(),
  tamilName: z
    .string()
    .trim()
    .max(191, 'Tamil name is too long')
    .nullish()
    .transform((val) => {
      if (val === undefined) return undefined;
      return val === '' || val === null ? null : val;
    }),
  displayOrder: z
    .number()
    .int('Display order must be an integer')
    .min(0, 'Display order must be a non-negative integer')
    .optional(),
});

export const updateCategoryStatusSchema = z.object({
  active: z.boolean({ message: 'Active status is required and must be a boolean' }),
});

export const categoryIdParamSchema = z.object({
  id: z.coerce.number().int().positive('ID must be a positive integer'),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type UpdateCategoryStatusInput = z.infer<typeof updateCategoryStatusSchema>;

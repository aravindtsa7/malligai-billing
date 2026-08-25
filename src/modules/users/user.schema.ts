import { z } from 'zod';
import { Role } from '../../generated/prisma/enums.js';

export const createUserSchema = z.object({
  username: z
    .string({ message: 'Username is required' })
    .trim()
    .min(1, 'Username cannot be empty')
    .max(50, 'Username cannot exceed 50 characters'),
  password: z
    .string({ message: 'Password is required' })
    .min(6, 'Password must be at least 6 characters'),
});

export const updateUserStatusSchema = z.object({
  active: z.boolean({ message: 'Active status is required and must be a boolean' }),
});

export const resetPasswordSchema = z.object({
  password: z
    .string({ message: 'Password is required' })
    .min(6, 'Password must be at least 6 characters'),
});

export const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  role: z.nativeEnum(Role).optional(),
  active: z
    .preprocess((val) => {
      if (val === 'true' || val === true) return true;
      if (val === 'false' || val === false) return false;
      return val;
    }, z.boolean().optional()),
});

export const userIdParamSchema = z.object({
  id: z.coerce.number().int().positive('ID must be a positive integer'),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserStatusInput = z.infer<typeof updateUserStatusSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ListUsersQueryInput = z.infer<typeof listUsersQuerySchema>;
export type UserIdParamInput = z.infer<typeof userIdParamSchema>;


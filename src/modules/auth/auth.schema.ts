import { z } from 'zod';

export const loginSchema = z.object({
  username: z
    .string({ message: 'Username is required' })
    .trim()
    .min(1, 'Username cannot be empty'),
  password: z
    .string({ message: 'Password is required' })
    .min(1, 'Password cannot be empty'),
});

export type LoginInput = z.infer<typeof loginSchema>;


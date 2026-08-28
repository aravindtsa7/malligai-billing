import { z } from 'zod';

export const updateReceiptSettingsSchema = z.object({
  storeName: z
    .string({ message: 'Store name is required' })
    .trim()
    .min(1, 'Store name cannot be empty')
    .max(191, 'Store name must not exceed 191 characters'),
  upiId: z
    .string()
    .trim()
    .max(191, 'UPI ID must not exceed 191 characters')
    .nullish()
    .transform((val) => (val === '' || val === null ? null : (val ?? null))),
  gstin: z
    .string()
    .trim()
    .max(191, 'GSTIN must not exceed 191 characters')
    .nullish()
    .transform((val) => (val === '' || val === null ? null : (val ?? null))),
  showCashier: z.boolean({ message: 'showCashier must be a boolean' }),
  showRateTier: z.boolean({ message: 'showRateTier must be a boolean' }),
  showPayment: z.boolean({ message: 'showPayment must be a boolean' }),
  showStatus: z.boolean({ message: 'showStatus must be a boolean' }),
});

export type UpdateReceiptSettingsInput = z.infer<typeof updateReceiptSettingsSchema>;

import { z } from 'zod';
import { LabelSize } from '../../generated/prisma/enums.js';

export const updateLabelSettingsSchema = z.object({
  storeName: z
    .string({ message: 'Store name is required' })
    .trim()
    .min(1, 'Store name cannot be empty')
    .max(191, 'Store name must not exceed 191 characters'),
  defaultLabelSize: z.nativeEnum(LabelSize, {
    message: `defaultLabelSize must be one of: ${Object.values(LabelSize).join(', ')}`,
  }),
});

export type UpdateLabelSettingsInput = z.infer<typeof updateLabelSettingsSchema>;


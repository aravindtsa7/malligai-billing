import { Router } from 'express';
import { receiptSettingsController } from './receipt-settings.controller.js';
import { updateReceiptSettingsSchema } from './receipt-settings.schema.js';
import { authenticate, authorizeRoles } from '../auth/auth.middleware.js';
import { validateBody } from '../../core/middlewares/validate.middleware.js';
import { Role } from '../../generated/prisma/enums.js';

const router = Router();

// Get receipt settings (ADMIN only)
router.get(
  '/',
  authenticate,
  authorizeRoles(Role.ADMIN),
  (req, res, next) => {
    receiptSettingsController.getReceiptSettings(req, res, next);
  }
);

// Update receipt settings (ADMIN only)
router.put(
  '/',
  authenticate,
  authorizeRoles(Role.ADMIN),
  validateBody(updateReceiptSettingsSchema),
  (req, res, next) => {
    receiptSettingsController.updateReceiptSettings(req, res, next);
  }
);

export default router;

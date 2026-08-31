import { Router } from 'express';
import { labelSettingsController } from './label-settings.controller.js';
import { updateLabelSettingsSchema } from './label-settings.schema.js';
import { authenticate, authorizeRoles } from '../auth/auth.middleware.js';
import { validateBody } from '../../core/middlewares/validate.middleware.js';
import { Role } from '../../generated/prisma/enums.js';

const router = Router();

// Get label settings (ADMIN only)
router.get(
  '/',
  authenticate,
  authorizeRoles(Role.ADMIN),
  (req, res, next) => {
    labelSettingsController.getLabelSettings(req, res, next);
  }
);

// Update label settings (ADMIN only)
router.put(
  '/',
  authenticate,
  authorizeRoles(Role.ADMIN),
  validateBody(updateLabelSettingsSchema),
  (req, res, next) => {
    labelSettingsController.updateLabelSettings(req, res, next);
  }
);

export default router;


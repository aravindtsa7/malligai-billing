import { Router } from 'express';
import { billingController } from './billing.controller.js';
import { createBillSchema } from './billing.schema.js';
import { authenticate, authorizeRoles } from '../auth/auth.middleware.js';
import { validateBody } from '../../core/middlewares/validate.middleware.js';
import { Role } from '../../generated/prisma/enums.js';

const router = Router();

// Create bill (ADMIN, SALESMAN)
router.post(
  '/',
  authenticate,
  authorizeRoles(Role.ADMIN, Role.SALESMAN),
  validateBody(createBillSchema),
  (req, res, next) => {
    billingController.createBill(req, res, next);
  }
);

// List bills with pagination and filters (ADMIN, SALESMAN)
router.get(
  '/',
  authenticate,
  authorizeRoles(Role.ADMIN, Role.SALESMAN),
  (req, res, next) => {
    billingController.listBills(req, res, next);
  }
);

// Get single bill with line items (ADMIN, SALESMAN)
router.get(
  '/:id',
  authenticate,
  authorizeRoles(Role.ADMIN, Role.SALESMAN),
  (req, res, next) => {
    billingController.getBillById(req, res, next);
  }
);

export default router;

import { Router } from 'express';
import { categoryController } from './category.controller.js';
import {
  createCategorySchema,
  updateCategorySchema,
  updateCategoryStatusSchema,
} from './category.schema.js';
import { authenticate, authorizeRoles } from '../auth/auth.middleware.js';
import { validateBody } from '../../core/middlewares/validate.middleware.js';
import { Role } from '../../generated/prisma/enums.js';

const router = Router();

// Create category (ADMIN only)
router.post(
  '/',
  authenticate,
  authorizeRoles(Role.ADMIN),
  validateBody(createCategorySchema),
  (req, res, next) => {
    categoryController.createCategory(req, res, next);
  }
);

// List categories (ADMIN, SALESMAN)
router.get(
  '/',
  authenticate,
  authorizeRoles(Role.ADMIN, Role.SALESMAN),
  (req, res, next) => {
    categoryController.listCategories(req, res, next);
  }
);

// Get category by ID (ADMIN, SALESMAN)
router.get(
  '/:id',
  authenticate,
  authorizeRoles(Role.ADMIN, Role.SALESMAN),
  (req, res, next) => {
    categoryController.getCategoryById(req, res, next);
  }
);

// Update category (ADMIN only)
router.put(
  '/:id',
  authenticate,
  authorizeRoles(Role.ADMIN),
  validateBody(updateCategorySchema),
  (req, res, next) => {
    categoryController.updateCategory(req, res, next);
  }
);

// Update category active status (ADMIN only)
router.patch(
  '/:id/status',
  authenticate,
  authorizeRoles(Role.ADMIN),
  validateBody(updateCategoryStatusSchema),
  (req, res, next) => {
    categoryController.updateCategoryStatus(req, res, next);
  }
);

export default router;


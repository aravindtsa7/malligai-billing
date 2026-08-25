import { Router } from 'express';
import { productController } from './product.controller.js';
import {
  createProductSchema,
  updateProductSchema,
  stockInSchema,
  stockAdjustmentSchema,
} from './product.schema.js';
import { authenticate, authorizeRoles } from '../auth/auth.middleware.js';
import { validateBody } from '../../core/middlewares/validate.middleware.js';
import { Role } from '../../generated/prisma/enums.js';

const router = Router();

// Create product (ADMIN only)
router.post(
  '/',
  authenticate,
  authorizeRoles(Role.ADMIN),
  validateBody(createProductSchema),
  (req, res, next) => {
    productController.createProduct(req, res, next);
  }
);

// List products (ADMIN, SALESMAN)
router.get('/', authenticate, authorizeRoles(Role.ADMIN, Role.SALESMAN), (req, res, next) => {
  productController.listProducts(req, res, next);
});

// Search products (ADMIN, SALESMAN)
router.get(
  '/search',
  authenticate,
  authorizeRoles(Role.ADMIN, Role.SALESMAN),
  (req, res, next) => {
    productController.searchProducts(req, res, next);
  }
);

// Lookup product by barcode (ADMIN, SALESMAN)
router.get(
  '/barcode/:barcode',
  authenticate,
  authorizeRoles(Role.ADMIN, Role.SALESMAN),
  (req, res, next) => {
    productController.getProductByBarcode(req, res, next);
  }
);

// Get single product by ID (ADMIN, SALESMAN)
router.get(
  '/:id',
  authenticate,
  authorizeRoles(Role.ADMIN, Role.SALESMAN),
  (req, res, next) => {
    productController.getProductById(req, res, next);
  }
);

// Update product metadata & rates (ADMIN only)
router.put(
  '/:id',
  authenticate,
  authorizeRoles(Role.ADMIN),
  validateBody(updateProductSchema),
  (req, res, next) => {
    productController.updateProduct(req, res, next);
  }
);

// Stock In (ADMIN only)
router.post(
  '/:id/stock-in',
  authenticate,
  authorizeRoles(Role.ADMIN),
  validateBody(stockInSchema),
  (req, res, next) => {
    productController.stockIn(req, res, next);
  }
);

// Stock Adjustment (ADMIN only)
router.post(
  '/:id/stock-adjustment',
  authenticate,
  authorizeRoles(Role.ADMIN),
  validateBody(stockAdjustmentSchema),
  (req, res, next) => {
    productController.stockAdjustment(req, res, next);
  }
);

export default router;

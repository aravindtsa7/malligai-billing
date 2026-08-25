import { Router } from 'express';
import { userController } from './user.controller.js';
import {
  createUserSchema,
  updateUserStatusSchema,
  resetPasswordSchema,
} from './user.schema.js';
import { authenticate, authorizeRoles } from '../auth/auth.middleware.js';
import { validateBody } from '../../core/middlewares/validate.middleware.js';
import { Role } from '../../generated/prisma/enums.js';

const router = Router();

// All /api/users endpoints require ADMIN authentication
router.post(
  '/',
  authenticate,
  authorizeRoles(Role.ADMIN),
  validateBody(createUserSchema),
  (req, res, next) => {
    userController.createUser(req, res, next);
  }
);

router.get(
  '/',
  authenticate,
  authorizeRoles(Role.ADMIN),
  (req, res, next) => {
    userController.listUsers(req, res, next);
  }
);

router.get(
  '/:id',
  authenticate,
  authorizeRoles(Role.ADMIN),
  (req, res, next) => {
    userController.getUserById(req, res, next);
  }
);

router.patch(
  '/:id/status',
  authenticate,
  authorizeRoles(Role.ADMIN),
  validateBody(updateUserStatusSchema),
  (req, res, next) => {
    userController.updateUserStatus(req, res, next);
  }
);

router.patch(
  '/:id/password',
  authenticate,
  authorizeRoles(Role.ADMIN),
  validateBody(resetPasswordSchema),
  (req, res, next) => {
    userController.resetUserPassword(req, res, next);
  }
);

export default router;


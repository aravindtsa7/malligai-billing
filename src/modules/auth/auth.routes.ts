import { Router } from 'express';
import { authController } from './auth.controller.js';
import { loginSchema } from './auth.schema.js';
import { authenticate } from './auth.middleware.js';
import { validateBody } from '../../core/middlewares/validate.middleware.js';

const router = Router();

router.post('/login', validateBody(loginSchema), (req, res, next) => {
  authController.login(req, res, next);
});

router.get('/me', authenticate, (req, res, next) => {
  authController.getMe(req, res, next);
});

export default router;


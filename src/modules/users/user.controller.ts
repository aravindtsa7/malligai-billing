import type { Request, Response, NextFunction } from 'express';
import { userService } from './user.service.js';
import {
  userIdParamSchema,
  listUsersQuerySchema,
} from './user.schema.js';

export class UserController {
  async createUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = await userService.createUser(req.body);

      res.status(201).json({
        success: true,
        message: 'Salesman user created successfully',
        data: {
          user,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async listUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = listUsersQuerySchema.parse(req.query);
      const result = await userService.listUsers(query);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async getUserById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = userIdParamSchema.parse(req.params);
      const user = await userService.getUserById(id);

      res.status(200).json({
        success: true,
        data: {
          user,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async updateUserStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = userIdParamSchema.parse(req.params);
      const user = await userService.updateUserStatus(id, req.body);

      res.status(200).json({
        success: true,
        message: 'User status updated successfully',
        data: {
          user,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async resetUserPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = userIdParamSchema.parse(req.params);
      const user = await userService.resetUserPassword(id, req.body);

      res.status(200).json({
        success: true,
        message: 'User password reset successfully',
        data: {
          user,
        },
      });
    } catch (error) {
      next(error);
    }
  }
}

export const userController = new UserController();


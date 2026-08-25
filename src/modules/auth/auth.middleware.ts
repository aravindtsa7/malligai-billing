import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../../core/database/prisma.js';
import { env } from '../../core/config/env.js';
import { UnauthorizedError, ForbiddenError } from '../../core/errors/app-error.js';
import type { Role } from '../../generated/prisma/enums.js';
import type { JwtAuthPayload } from './auth.types.js';

export const authenticate = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedError('Authentication token is required');
    }

    const token = authHeader.substring(7).trim();
    if (!token) {
      throw new UnauthorizedError('Authentication token is required');
    }

    let payload: JwtAuthPayload;
    try {
      payload = jwt.verify(token, env.JWT_SECRET) as JwtAuthPayload;
    } catch {
      throw new UnauthorizedError('Invalid or expired authentication token');
    }

    if (!payload.userId) {
      throw new UnauthorizedError('Invalid token payload');
    }

    const user = await prisma.user.findUnique({
      where: {
        id: payload.userId,
      },
    });

    if (!user) {
      throw new UnauthorizedError('User not found');
    }

    if (!user.active) {
      throw new UnauthorizedError('Account is inactive');
    }

    req.user = {
      id: user.id,
      username: user.username,
      role: user.role,
      active: user.active,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };

    next();
  } catch (error) {
    next(error);
  }
};

export const authorizeRoles = (...roles: Role[]) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new UnauthorizedError('Authentication required'));
      return;
    }

    if (!roles.includes(req.user.role)) {
      next(new ForbiddenError('Access forbidden: insufficient role permissions'));
      return;
    }

    next();
  };
};


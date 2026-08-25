import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import jwt from 'jsonwebtoken';
import { Prisma } from '../../generated/prisma/client.js';
import { AppError } from '../errors/app-error.js';

export const errorHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
    return;
  }

  if (err instanceof ZodError) {
    const formattedErrors = err.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));

    res.status(400).json({
      success: false,
      message: 'Validation failed',
      details: formattedErrors,
    });
    return;
  }

  if (
    err instanceof Prisma.PrismaClientKnownRequestError ||
    (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002')
  ) {
    const prismaErr = err as Prisma.PrismaClientKnownRequestError;
    if (prismaErr.code === 'P2002') {
      const target = prismaErr.meta?.target;
      const targetStr = Array.isArray(target)
        ? target.join(', ')
        : typeof target === 'string'
        ? target
        : 'field';
      res.status(409).json({
        success: false,
        message: `Unique constraint violation: resource with this ${targetStr} already exists`,
      });
      return;
    }
  }

  if (err instanceof jwt.TokenExpiredError) {
    res.status(401).json({
      success: false,
      message: 'Token has expired',
    });
    return;
  }

  if (err instanceof jwt.JsonWebTokenError) {
    res.status(401).json({
      success: false,
      message: 'Invalid token',
    });
    return;
  }

  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({
      success: false,
      message: 'Invalid JSON payload',
    });
    return;
  }

  console.error('Unhandled Error:', err);

  res.status(500).json({
    success: false,
    message: 'Internal server error',
  });
};



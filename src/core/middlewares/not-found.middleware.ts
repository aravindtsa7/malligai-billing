import type { Request, Response, NextFunction } from 'express';
import { NotFoundError } from '../errors/app-error.js';

export const notFoundHandler = (req: Request, _res: Response, next: NextFunction): void => {
  next(new NotFoundError(`Route ${req.method} ${req.originalUrl} not found`));
};


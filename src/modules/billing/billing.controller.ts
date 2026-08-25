import type { Request, Response, NextFunction } from 'express';
import { billingService } from './billing.service.js';
import { billIdParamSchema, listBillsQuerySchema } from './billing.schema.js';
import { UnauthorizedError } from '../../core/errors/app-error.js';

export class BillingController {
  async createBill(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new UnauthorizedError('Authentication required');
      }

      const bill = await billingService.createBill(req.body, req.user.id);

      res.status(201).json({
        success: true,
        message: 'Bill created successfully',
        data: {
          bill,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async listBills(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = listBillsQuerySchema.parse(req.query);
      const result = await billingService.listBills(query);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async getBillById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = billIdParamSchema.parse(req.params);
      const bill = await billingService.getBillById(id);

      res.status(200).json({
        success: true,
        data: {
          bill,
        },
      });
    } catch (error) {
      next(error);
    }
  }
}

export const billingController = new BillingController();

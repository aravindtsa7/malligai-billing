import type { Request, Response, NextFunction } from 'express';
import { receiptSettingsService } from './receipt-settings.service.js';

export class ReceiptSettingsController {
  async getReceiptSettings(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const receiptSettings = await receiptSettingsService.getReceiptSettings();

      res.status(200).json({
        success: true,
        data: {
          receiptSettings,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async updateReceiptSettings(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const receiptSettings = await receiptSettingsService.updateReceiptSettings(req.body);

      res.status(200).json({
        success: true,
        message: 'Receipt settings updated successfully',
        data: {
          receiptSettings,
        },
      });
    } catch (error) {
      next(error);
    }
  }
}

export const receiptSettingsController = new ReceiptSettingsController();

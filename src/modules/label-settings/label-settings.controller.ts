import type { Request, Response, NextFunction } from 'express';
import { labelSettingsService } from './label-settings.service.js';

export class LabelSettingsController {
  async getLabelSettings(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const labelSettings = await labelSettingsService.getLabelSettings();

      res.status(200).json({
        success: true,
        data: {
          labelSettings,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async updateLabelSettings(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const labelSettings = await labelSettingsService.updateLabelSettings(req.body);

      res.status(200).json({
        success: true,
        message: 'Label settings updated successfully',
        data: {
          labelSettings,
        },
      });
    } catch (error) {
      next(error);
    }
  }
}

export const labelSettingsController = new LabelSettingsController();


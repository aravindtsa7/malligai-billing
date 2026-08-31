import { prisma } from '../../core/database/prisma.js';
import { LabelSize } from '../../generated/prisma/enums.js';
import type { UpdateLabelSettingsInput } from './label-settings.schema.js';
import { serializeLabelSettings, type SerializedLabelSettings } from './label-settings.types.js';

export class LabelSettingsService {
  async getLabelSettings(): Promise<SerializedLabelSettings> {
    let settings;
    try {
      settings = await prisma.labelSettings.upsert({
        where: { id: 1 },
        update: {},
        create: {
          id: 1,
          storeName: 'MALLIGAI',
          defaultLabelSize: LabelSize.LABEL_50X40,
        },
      });
    } catch (error) {
      if (!this.isUniqueConstraintError(error)) throw error;

      settings = await prisma.labelSettings.findUnique({ where: { id: 1 } });
      if (!settings) throw error;
    }

    return serializeLabelSettings(settings);
  }

  async updateLabelSettings(input: UpdateLabelSettingsInput): Promise<SerializedLabelSettings> {
    let updated;
    try {
      updated = await prisma.labelSettings.upsert({
        where: { id: 1 },
        update: {
          storeName: input.storeName,
          defaultLabelSize: input.defaultLabelSize,
        },
        create: {
          id: 1,
          storeName: input.storeName,
          defaultLabelSize: input.defaultLabelSize,
        },
      });
    } catch (error) {
      if (!this.isUniqueConstraintError(error)) throw error;

      updated = await prisma.labelSettings.update({
        where: { id: 1 },
        data: {
          storeName: input.storeName,
          defaultLabelSize: input.defaultLabelSize,
        },
      });
    }

    return serializeLabelSettings(updated);
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
  }
}

export const labelSettingsService = new LabelSettingsService();

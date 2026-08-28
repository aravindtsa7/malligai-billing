import { prisma } from '../../core/database/prisma.js';
import type { UpdateReceiptSettingsInput } from './receipt-settings.schema.js';
import { serializeReceiptSettings, type SerializedReceiptSettings } from './receipt-settings.types.js';

export class ReceiptSettingsService {
  async getReceiptSettings(): Promise<SerializedReceiptSettings> {
    let settings = await prisma.receiptSettings.findFirst({
      orderBy: { id: 'asc' },
    });

    if (!settings) {
      settings = await prisma.receiptSettings.create({
        data: {
          storeName: 'Malligai Billing',
          upiId: null,
          gstin: null,
          showCashier: true,
          showRateTier: true,
          showPayment: true,
          showStatus: true,
        },
      });
    }

    return serializeReceiptSettings(settings);
  }

  async updateReceiptSettings(input: UpdateReceiptSettingsInput): Promise<SerializedReceiptSettings> {
    const existing = await prisma.receiptSettings.findFirst({
      orderBy: { id: 'asc' },
    });

    let updated;
    if (existing) {
      updated = await prisma.receiptSettings.update({
        where: { id: existing.id },
        data: {
          storeName: input.storeName,
          upiId: input.upiId,
          gstin: input.gstin,
          showCashier: input.showCashier,
          showRateTier: input.showRateTier,
          showPayment: input.showPayment,
          showStatus: input.showStatus,
        },
      });
    } else {
      updated = await prisma.receiptSettings.create({
        data: {
          storeName: input.storeName,
          upiId: input.upiId,
          gstin: input.gstin,
          showCashier: input.showCashier,
          showRateTier: input.showRateTier,
          showPayment: input.showPayment,
          showStatus: input.showStatus,
        },
      });
    }

    return serializeReceiptSettings(updated);
  }
}

export const receiptSettingsService = new ReceiptSettingsService();

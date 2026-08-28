export interface SerializedReceiptSettings {
  storeName: string;
  upiId: string | null;
  gstin: string | null;
  showCashier: boolean;
  showRateTier: boolean;
  showPayment: boolean;
  showStatus: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export function serializeReceiptSettings(settings: {
  storeName: string;
  upiId: string | null;
  gstin: string | null;
  showCashier: boolean;
  showRateTier: boolean;
  showPayment: boolean;
  showStatus: boolean;
  createdAt: Date;
  updatedAt: Date;
}): SerializedReceiptSettings {
  return {
    storeName: settings.storeName,
    upiId: settings.upiId ?? null,
    gstin: settings.gstin ?? null,
    showCashier: settings.showCashier,
    showRateTier: settings.showRateTier,
    showPayment: settings.showPayment,
    showStatus: settings.showStatus,
    createdAt: settings.createdAt,
    updatedAt: settings.updatedAt,
  };
}

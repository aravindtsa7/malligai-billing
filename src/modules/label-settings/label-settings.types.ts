import type { LabelSize } from '../../generated/prisma/enums.js';

export interface SerializedLabelSettings {
  storeName: string;
  defaultLabelSize: LabelSize;
  createdAt: Date;
  updatedAt: Date;
}

export function serializeLabelSettings(settings: {
  storeName: string;
  defaultLabelSize: LabelSize;
  createdAt: Date;
  updatedAt: Date;
}): SerializedLabelSettings {
  return {
    storeName: settings.storeName,
    defaultLabelSize: settings.defaultLabelSize,
    createdAt: settings.createdAt,
    updatedAt: settings.updatedAt,
  };
}


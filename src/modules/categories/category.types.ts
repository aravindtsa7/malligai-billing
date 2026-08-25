export interface SerializedCategory {
  id: number;
  categoryName: string;
  tamilName: string | null;
  displayOrder: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export function serializeCategory(category: {
  id: number;
  categoryName: string;
  tamilName: string | null;
  displayOrder: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}): SerializedCategory {
  return {
    id: category.id,
    categoryName: category.categoryName,
    tamilName: category.tamilName ?? null,
    displayOrder: category.displayOrder,
    active: category.active,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
  };
}


import { prisma } from '../../core/database/prisma.js';
import { ConflictError, NotFoundError } from '../../core/errors/app-error.js';
import type {
  CreateCategoryInput,
  UpdateCategoryInput,
  UpdateCategoryStatusInput,
} from './category.schema.js';
import { serializeCategory, type SerializedCategory } from './category.types.js';

export class CategoryService {
  async createCategory(input: CreateCategoryInput): Promise<SerializedCategory> {
    const existing = await prisma.category.findUnique({
      where: { categoryName: input.categoryName },
    });

    if (existing) {
      throw new ConflictError(`Category with name "${input.categoryName}" already exists`);
    }

    const category = await prisma.category.create({
      data: {
        categoryName: input.categoryName,
        tamilName: input.tamilName,
        displayOrder: input.displayOrder,
        active: true,
      },
    });

    return serializeCategory(category);
  }

  async listCategories(): Promise<SerializedCategory[]> {
    const categories = await prisma.category.findMany({
      orderBy: [{ displayOrder: 'asc' }, { categoryName: 'asc' }, { id: 'asc' }],
    });

    return categories.map(serializeCategory);
  }

  async getCategoryById(id: number): Promise<SerializedCategory> {
    const category = await prisma.category.findUnique({
      where: { id },
    });

    if (!category) {
      throw new NotFoundError(`Category with ID ${id} not found`);
    }

    return serializeCategory(category);
  }

  async updateCategory(id: number, input: UpdateCategoryInput): Promise<SerializedCategory> {
    const category = await prisma.category.findUnique({
      where: { id },
    });

    if (!category) {
      throw new NotFoundError(`Category with ID ${id} not found`);
    }

    if (input.categoryName && input.categoryName !== category.categoryName) {
      const existing = await prisma.category.findUnique({
        where: { categoryName: input.categoryName },
      });

      if (existing && existing.id !== id) {
        throw new ConflictError(`Category with name "${input.categoryName}" already exists`);
      }
    }

    const updated = await prisma.category.update({
      where: { id },
      data: {
        ...(input.categoryName !== undefined ? { categoryName: input.categoryName } : {}),
        ...(input.tamilName !== undefined ? { tamilName: input.tamilName } : {}),
        ...(input.displayOrder !== undefined ? { displayOrder: input.displayOrder } : {}),
      },
    });

    return serializeCategory(updated);
  }

  async updateCategoryStatus(
    id: number,
    input: UpdateCategoryStatusInput
  ): Promise<SerializedCategory> {
    return await prisma.$transaction(async (tx) => {
      const categoryRows = await tx.$queryRaw<
        Array<{ id: number; active: number | boolean }>
      >`
        SELECT id, active
        FROM categories
        WHERE id = ${id}
        FOR UPDATE
      `;

      if (!categoryRows || categoryRows.length === 0) {
        throw new NotFoundError(`Category with ID ${id} not found`);
      }

      const updated = await tx.category.update({
        where: { id },
        data: {
          active: input.active,
        },
      });

      return serializeCategory(updated);
    });
  }
}

export const categoryService = new CategoryService();


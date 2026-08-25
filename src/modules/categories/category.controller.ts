import type { Request, Response, NextFunction } from 'express';
import { categoryService } from './category.service.js';
import { categoryIdParamSchema } from './category.schema.js';

export class CategoryController {
  async createCategory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const category = await categoryService.createCategory(req.body);

      res.status(201).json({
        success: true,
        message: 'Category created successfully',
        data: {
          category,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async listCategories(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const categories = await categoryService.listCategories();

      res.status(200).json({
        success: true,
        data: {
          categories,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async getCategoryById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = categoryIdParamSchema.parse(req.params);
      const category = await categoryService.getCategoryById(id);

      res.status(200).json({
        success: true,
        data: {
          category,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async updateCategory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = categoryIdParamSchema.parse(req.params);
      const category = await categoryService.updateCategory(id, req.body);

      res.status(200).json({
        success: true,
        message: 'Category updated successfully',
        data: {
          category,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async updateCategoryStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = categoryIdParamSchema.parse(req.params);
      const category = await categoryService.updateCategoryStatus(id, req.body);

      res.status(200).json({
        success: true,
        message: 'Category status updated successfully',
        data: {
          category,
        },
      });
    } catch (error) {
      next(error);
    }
  }
}

export const categoryController = new CategoryController();


import type { Request, Response, NextFunction } from 'express';
import { productService } from './product.service.js';
import { stockService } from './stock.service.js';
import { idParamSchema } from './product.schema.js';
import { UnauthorizedError } from '../../core/errors/app-error.js';

export class ProductController {
  async createProduct(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new UnauthorizedError('Authentication required');
      }

      const product = await productService.createProduct(req.body, req.user.id);

      res.status(201).json({
        success: true,
        message: 'Product created successfully',
        data: {
          product,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async listProducts(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const products = await productService.listProducts();

      res.status(200).json({
        success: true,
        data: {
          products,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async getProductById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = idParamSchema.parse(req.params);
      const product = await productService.getProductById(id);

      res.status(200).json({
        success: true,
        data: {
          product,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async updateProduct(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = idParamSchema.parse(req.params);
      const product = await productService.updateProduct(id, req.body);

      res.status(200).json({
        success: true,
        message: 'Product updated successfully',
        data: {
          product,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async searchProducts(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = typeof req.query.q === 'string' ? req.query.q : '';
      const products = await productService.searchProducts(query);

      res.status(200).json({
        success: true,
        data: {
          products,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async getProductByBarcode(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const barcodeParam = req.params.barcode;
      const barcode = Array.isArray(barcodeParam) ? barcodeParam[0] : String(barcodeParam);
      const product = await productService.getProductByBarcode(barcode);

      res.status(200).json({
        success: true,
        data: {
          product,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async stockIn(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new UnauthorizedError('Authentication required');
      }

      const { id } = idParamSchema.parse(req.params);
      const result = await stockService.stockIn(id, req.body, req.user.id);

      res.status(200).json({
        success: true,
        message: 'Stock-in recorded successfully',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async stockAdjustment(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new UnauthorizedError('Authentication required');
      }

      const { id } = idParamSchema.parse(req.params);
      const result = await stockService.stockAdjustment(id, req.body, req.user.id);

      res.status(200).json({
        success: true,
        message: 'Stock adjustment recorded successfully',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
}

export const productController = new ProductController();

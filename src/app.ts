import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import authRoutes from './modules/auth/auth.routes.js';
import categoryRoutes from './modules/categories/category.routes.js';
import productRoutes from './modules/products/product.routes.js';
import billingRoutes from './modules/billing/billing.routes.js';
import userRoutes from './modules/users/user.routes.js';
import receiptSettingsRoutes from './modules/receipt-settings/receipt-settings.routes.js';
import { notFoundHandler } from './core/middlewares/not-found.middleware.js';
import { errorHandler } from './core/middlewares/error.middleware.js';

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/api/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'Malligai Billing Backend is running',
  });
});

// Authentication routes
app.use('/api/auth', authRoutes);

// Category routes
app.use('/api/categories', categoryRoutes);

// Product & Stock routes
app.use('/api/products', productRoutes);

// Billing routes
app.use('/api/bills', billingRoutes);

// Receipt settings routes (ADMIN only)
app.use('/api/receipt-settings', receiptSettingsRoutes);

// User management routes (ADMIN only)
app.use('/api/users', userRoutes);

// 404 handler for unmatched routes
app.use(notFoundHandler);

// Centralized error handler
app.use(errorHandler);

export default app;
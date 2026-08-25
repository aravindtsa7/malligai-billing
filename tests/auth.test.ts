import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import express from 'express';
import bcrypt from 'bcryptjs';
import authRoutes from '../src/modules/auth/auth.routes.js';
import { notFoundHandler } from '../src/core/middlewares/not-found.middleware.js';
import { errorHandler } from '../src/core/middlewares/error.middleware.js';
import { prisma } from '../src/core/database/prisma.js';
import { Role } from '../src/generated/prisma/enums.js';
import { authenticate, authorizeRoles } from '../src/modules/auth/auth.middleware.js';

describe('Authentication & Authorization Integration Tests', () => {
  let server: Server;
  let baseUrl: string;

  const testAdmin = {
    username: 'test_admin_user',
    password: 'TestAdminPassword123!',
    role: Role.ADMIN,
  };

  const testSalesman = {
    username: 'test_salesman_user',
    password: 'TestSalesmanPassword123!',
    role: Role.SALESMAN,
  };

  const testInactive = {
    username: 'test_inactive_user',
    password: 'TestInactivePassword123!',
    role: Role.SALESMAN,
  };

  before(async () => {
    const testApp = express();
    testApp.use(express.json());

    // Health check
    testApp.get('/api/health', (_req, res) => {
      res.status(200).json({ status: 'ok', message: 'Malligai Billing Backend is running' });
    });

    // Mount auth routes
    testApp.use('/api/auth', authRoutes);

    // Test routes for role authorization
    testApp.get('/api/test/admin-only', authenticate, authorizeRoles(Role.ADMIN), (_req, res) => {
      res.status(200).json({ success: true, message: 'Welcome Admin' });
    });

    testApp.get('/api/test/salesman-only', authenticate, authorizeRoles(Role.SALESMAN), (_req, res) => {
      res.status(200).json({ success: true, message: 'Welcome Salesman' });
    });

    testApp.use(notFoundHandler);
    testApp.use(errorHandler);

    // Start server on random available port
    await new Promise<void>((resolve) => {
      server = testApp.listen(0, () => {
        const address = server.address();
        if (address && typeof address === 'object') {
          baseUrl = `http://localhost:${address.port}`;
        }
        resolve();
      });
    });

    // Clean up any previous test users
    await prisma.user.deleteMany({
      where: {
        username: {
          in: [testAdmin.username, testSalesman.username, testInactive.username],
        },
      },
    });

    // Create test admin
    const adminHash = await bcrypt.hash(testAdmin.password, 10);
    await prisma.user.create({
      data: {
        username: testAdmin.username,
        passwordHash: adminHash,
        role: testAdmin.role,
        active: true,
      },
    });

    // Create test salesman
    const salesmanHash = await bcrypt.hash(testSalesman.password, 10);
    await prisma.user.create({
      data: {
        username: testSalesman.username,
        passwordHash: salesmanHash,
        role: testSalesman.role,
        active: true,
      },
    });

    // Create test inactive user
    const inactiveHash = await bcrypt.hash(testInactive.password, 10);
    await prisma.user.create({
      data: {
        username: testInactive.username,
        passwordHash: inactiveHash,
        role: testInactive.role,
        active: false,
      },
    });
  });

  after(async () => {
    // Clean up test users
    await prisma.user.deleteMany({
      where: {
        username: {
          in: [testAdmin.username, testSalesman.username, testInactive.username],
        },
      },
    });

    await prisma.$disconnect();

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  describe('POST /api/auth/login', () => {
    it('should fail with 400 if username or password is missing', async () => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const body = await res.json();
      assert.strictEqual(res.status, 400);
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.message, 'Validation failed');
      assert.ok(Array.isArray(body.details) && body.details.length >= 2);
    });

    it('should fail with 401 when username does not exist', async () => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'non_existent_user',
          password: 'SomePassword123',
        }),
      });

      const body = await res.json();
      assert.strictEqual(res.status, 401);
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.message, 'Invalid username or password');
    });

    it('should fail with 401 when password is incorrect', async () => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: testAdmin.username,
          password: 'WrongPassword123!',
        }),
      });

      const body = await res.json();
      assert.strictEqual(res.status, 401);
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.message, 'Invalid username or password');
    });

    it('should fail with 401 when user is inactive', async () => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: testInactive.username,
          password: testInactive.password,
        }),
      });

      const body = await res.json();
      assert.strictEqual(res.status, 401);
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.message, 'Account is inactive');
    });

    it('should succeed with 200 and return a token with sanitized user for admin login', async () => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: testAdmin.username,
          password: testAdmin.password,
        }),
      });

      const body = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.success, true);
      assert.ok(typeof body.data.token === 'string' && body.data.token.length > 0);
      assert.strictEqual(body.data.user.username, testAdmin.username);
      assert.strictEqual(body.data.user.role, Role.ADMIN);
      assert.strictEqual(body.data.user.active, true);
      assert.strictEqual(body.data.user.passwordHash, undefined, 'passwordHash must not be exposed');
    });
  });

  describe('GET /api/auth/me', () => {
    let adminToken: string;

    before(async () => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: testAdmin.username,
          password: testAdmin.password,
        }),
      });
      const data = await res.json();
      adminToken = data.data.token;
    });

    it('should fail with 401 when Authorization header is missing', async () => {
      const res = await fetch(`${baseUrl}/api/auth/me`);
      const body = await res.json();

      assert.strictEqual(res.status, 401);
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.message, 'Authentication token is required');
    });

    it('should fail with 401 when token is invalid or malformed', async () => {
      const res = await fetch(`${baseUrl}/api/auth/me`, {
        headers: {
          Authorization: 'Bearer invalid.token.payload',
        },
      });
      const body = await res.json();

      assert.strictEqual(res.status, 401);
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.message, 'Invalid or expired authentication token');
    });

    it('should succeed with 200 and return authenticated user for valid token', async () => {
      const res = await fetch(`${baseUrl}/api/auth/me`, {
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      });
      const body = await res.json();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.user.username, testAdmin.username);
      assert.strictEqual(body.data.user.role, Role.ADMIN);
      assert.strictEqual(body.data.user.active, true);
      assert.strictEqual(body.data.user.passwordHash, undefined, 'passwordHash must not be exposed');
    });

    it('should fail with 401 if user becomes inactive after receiving token', async () => {
      // Temporarily deactivate admin
      await prisma.user.update({
        where: { username: testAdmin.username },
        data: { active: false },
      });

      const res = await fetch(`${baseUrl}/api/auth/me`, {
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      });
      const body = await res.json();

      assert.strictEqual(res.status, 401);
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.message, 'Account is inactive');

      // Reactivate admin
      await prisma.user.update({
        where: { username: testAdmin.username },
        data: { active: true },
      });
    });
  });

  describe('Role Authorization Middleware', () => {
    let adminToken: string;
    let salesmanToken: string;

    before(async () => {
      const adminRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: testAdmin.username,
          password: testAdmin.password,
        }),
      });
      const adminData = await adminRes.json();
      adminToken = adminData.data.token;

      const salesmanRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: testSalesman.username,
          password: testSalesman.password,
        }),
      });
      const salesmanData = await salesmanRes.json();
      salesmanToken = salesmanData.data.token;
    });

    it('should allow ADMIN to access admin-only endpoint', async () => {
      const res = await fetch(`${baseUrl}/api/test/admin-only`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const body = await res.json();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.message, 'Welcome Admin');
    });

    it('should forbid SALESMAN from accessing admin-only endpoint with 403', async () => {
      const res = await fetch(`${baseUrl}/api/test/admin-only`, {
        headers: { Authorization: `Bearer ${salesmanToken}` },
      });
      const body = await res.json();

      assert.strictEqual(res.status, 403);
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.message, 'Access forbidden: insufficient role permissions');
    });

    it('should allow SALESMAN to access salesman-only endpoint', async () => {
      const res = await fetch(`${baseUrl}/api/test/salesman-only`, {
        headers: { Authorization: `Bearer ${salesmanToken}` },
      });
      const body = await res.json();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.message, 'Welcome Salesman');
    });

    it('should forbid ADMIN from accessing salesman-only endpoint with 403', async () => {
      const res = await fetch(`${baseUrl}/api/test/salesman-only`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const body = await res.json();

      assert.strictEqual(res.status, 403);
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.message, 'Access forbidden: insufficient role permissions');
    });
  });
});


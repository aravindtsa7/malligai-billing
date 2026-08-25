import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import bcrypt from 'bcryptjs';
import app from '../src/app.js';
import { prisma } from '../src/core/database/prisma.js';
import { Role, Unit, RateType, PaymentType } from '../src/generated/prisma/enums.js';

describe('User Management Integration Tests (Phase 5)', () => {
  let server: Server;
  let baseUrl: string;
  let adminToken: string;
  let salesmanToken: string;
  let adminUserId: number;
  let salesmanUserId: number;

  const testAdmin = {
    username: 'phase5_test_admin',
    password: 'AdminPassword123!',
    role: Role.ADMIN,
  };

  const testSalesman = {
    username: 'phase5_test_salesman',
    password: 'SalesmanPassword123!',
    role: Role.SALESMAN,
  };

  before(async () => {
    // Start test server using the main Express app
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const address = server.address();
        if (address && typeof address === 'object') {
          baseUrl = `http://localhost:${address.port}`;
        }
        resolve();
      });
    });

    // Clean up any previous test data
    await prisma.user.deleteMany({
      where: {
        username: {
          startsWith: 'phase5_',
        },
      },
    });

    // Create test admin
    const adminHash = await bcrypt.hash(testAdmin.password, 10);
    const admin = await prisma.user.create({
      data: {
        username: testAdmin.username,
        passwordHash: adminHash,
        role: testAdmin.role,
        active: true,
      },
    });
    adminUserId = admin.id;

    // Create test salesman
    const salesmanHash = await bcrypt.hash(testSalesman.password, 10);
    const salesman = await prisma.user.create({
      data: {
        username: testSalesman.username,
        passwordHash: salesmanHash,
        role: testSalesman.role,
        active: true,
      },
    });
    salesmanUserId = salesman.id;

    // Login as admin
    const adminLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: testAdmin.username,
        password: testAdmin.password,
      }),
    });
    const adminLoginData = await adminLoginRes.json();
    adminToken = adminLoginData.data.token;

    // Login as salesman
    const salesmanLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: testSalesman.username,
        password: testSalesman.password,
      }),
    });
    const salesmanLoginData = await salesmanLoginRes.json();
    salesmanToken = salesmanLoginData.data.token;
  });

  after(async () => {
    // Clean up test data
    await prisma.billItem.deleteMany({
      where: {
        bill: {
          creator: {
            username: { startsWith: 'phase5_' },
          },
        },
      },
    });
    await prisma.stockTransaction.deleteMany({
      where: {
        creator: {
          username: { startsWith: 'phase5_' },
        },
      },
    });
    await prisma.bill.deleteMany({
      where: {
        creator: {
          username: { startsWith: 'phase5_' },
        },
      },
    });
    await prisma.product.deleteMany({
      where: {
        productCode: { startsWith: 'P5_' },
      },
    });
    await prisma.user.deleteMany({
      where: {
        username: {
          startsWith: 'phase5_',
        },
      },
    });

    await prisma.$disconnect();

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  describe('1-9. User Creation (POST /api/users)', () => {
    let createdUserId: number;

    it('1, 2, 4, 5. ADMIN creates SALESMAN successfully; role is always SALESMAN, password hashed in DB, passwordHash not returned', async () => {
      const payload = {
        username: 'phase5_created_salesman_1',
        password: 'SecurePassword123!',
      };

      const res = await fetch(`${baseUrl}/api/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify(payload),
      });

      const body = await res.json();
      assert.strictEqual(res.status, 201);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.user.username, payload.username);
      assert.strictEqual(body.data.user.role, Role.SALESMAN);
      assert.strictEqual(body.data.user.active, true);
      assert.strictEqual(body.data.user.passwordHash, undefined, 'passwordHash must never be returned');

      createdUserId = body.data.user.id;

      // Verify DB storage directly
      const dbUser = await prisma.user.findUnique({
        where: { id: createdUserId },
      });
      assert.ok(dbUser);
      assert.strictEqual(dbUser.role, Role.SALESMAN);
      assert.notStrictEqual(dbUser.passwordHash, payload.password);
      assert.ok(dbUser.passwordHash.startsWith('$2'), 'Password must be stored as bcrypt hash');
      const isMatch = await bcrypt.compare(payload.password, dbUser.passwordHash);
      assert.strictEqual(isMatch, true, 'Bcrypt compare must succeed for raw password');
    });

    it('3. Request cannot create ADMIN by supplying role=ADMIN in body', async () => {
      const payload = {
        username: 'phase5_sneak_admin',
        password: 'SecurePassword123!',
        role: 'ADMIN',
      };

      const res = await fetch(`${baseUrl}/api/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify(payload),
      });

      const body = await res.json();
      assert.strictEqual(res.status, 201);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.user.role, Role.SALESMAN, 'Role must be forced to SALESMAN');

      const dbUser = await prisma.user.findUnique({
        where: { id: body.data.user.id },
      });
      assert.strictEqual(dbUser?.role, Role.SALESMAN);
    });

    it('6. Duplicate username returns 409 Conflict', async () => {
      const payload = {
        username: 'phase5_created_salesman_1',
        password: 'AnotherPassword123!',
      };

      const res = await fetch(`${baseUrl}/api/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify(payload),
      });

      const body = await res.json();
      assert.strictEqual(res.status, 409);
      assert.strictEqual(body.success, false);
      assert.ok(body.message.includes('Unique constraint violation') || body.message.includes('already exists'));
    });

    it('7. Concurrent duplicate username creation yields exactly one 201 and one 409 (no 500)', async () => {
      const duplicateUsername = 'phase5_concurrent_user';
      const password = 'ConcurrentPassword123!';

      const [res1, res2] = await Promise.all([
        fetch(`${baseUrl}/api/users`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${adminToken}`,
          },
          body: JSON.stringify({ username: duplicateUsername, password }),
        }),
        fetch(`${baseUrl}/api/users`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${adminToken}`,
          },
          body: JSON.stringify({ username: duplicateUsername, password }),
        }),
      ]);

      const statuses = [res1.status, res2.status].sort();
      assert.deepStrictEqual(statuses, [201, 409], 'One request must succeed with 201 and one must conflict with 409');
    });

    it('8. SALESMAN cannot create users (403 Forbidden)', async () => {
      const res = await fetch(`${baseUrl}/api/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${salesmanToken}`,
        },
        body: JSON.stringify({
          username: 'phase5_forbidden_user',
          password: 'Password123!',
        }),
      });

      const body = await res.json();
      assert.strictEqual(res.status, 403);
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.message, 'Access forbidden: insufficient role permissions');
    });

    it('9. Unauthenticated request cannot create users (401 Unauthorized)', async () => {
      const res = await fetch(`${baseUrl}/api/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'phase5_unauth_user',
          password: 'Password123!',
        }),
      });

      const body = await res.json();
      assert.strictEqual(res.status, 401);
      assert.strictEqual(body.success, false);
    });

    it('Validation: Rejects empty username and short password with 400 Bad Request', async () => {
      const res = await fetch(`${baseUrl}/api/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          username: '   ',
          password: '123',
        }),
      });

      const body = await res.json();
      assert.strictEqual(res.status, 400);
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.message, 'Validation failed');
    });
  });

  describe('10-13. List Users & Get User (GET /api/users, GET /api/users/:id)', () => {
    it('10, 11. ADMIN lists users with pagination and without exposing passwordHash', async () => {
      const res = await fetch(`${baseUrl}/api/users?page=1&limit=10`, {
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      });

      const body = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.success, true);
      assert.ok(Array.isArray(body.data.users));
      assert.ok(body.data.users.length > 0);
      assert.ok(body.data.pagination);
      assert.strictEqual(body.data.pagination.page, 1);
      assert.strictEqual(body.data.pagination.limit, 10);
      assert.ok(body.data.pagination.total >= 2);

      for (const user of body.data.users) {
        assert.ok(user.id);
        assert.ok(user.username);
        assert.ok(user.role);
        assert.strictEqual(typeof user.active, 'boolean');
        assert.strictEqual(user.passwordHash, undefined, 'passwordHash must never be exposed in list');
      }
    });

    it('Filter list by role and active status', async () => {
      const res = await fetch(`${baseUrl}/api/users?role=SALESMAN&active=true`, {
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      });

      const body = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.success, true);
      for (const user of body.data.users) {
        assert.strictEqual(user.role, Role.SALESMAN);
        assert.strictEqual(user.active, true);
      }
    });

    it('12. ADMIN gets user by ID', async () => {
      const res = await fetch(`${baseUrl}/api/users/${salesmanUserId}`, {
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      });

      const body = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.user.id, salesmanUserId);
      assert.strictEqual(body.data.user.username, testSalesman.username);
      assert.strictEqual(body.data.user.role, Role.SALESMAN);
      assert.strictEqual(body.data.user.active, true);
      assert.strictEqual(body.data.user.passwordHash, undefined);
    });

    it('13. Missing user returns 404 Not Found', async () => {
      const res = await fetch(`${baseUrl}/api/users/9999999`, {
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      });

      const body = await res.json();
      assert.strictEqual(res.status, 404);
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.message, 'User not found');
    });

    it('14. Invalid user ID returns 400 Bad Request', async () => {
      const res = await fetch(`${baseUrl}/api/users/not-a-number`, {
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      });

      const body = await res.json();
      assert.strictEqual(res.status, 400);
      assert.strictEqual(body.success, false);
    });

    it('SALESMAN cannot list users (403 Forbidden)', async () => {
      const res = await fetch(`${baseUrl}/api/users`, {
        headers: {
          Authorization: `Bearer ${salesmanToken}`,
        },
      });

      const body = await res.json();
      assert.strictEqual(res.status, 403);
      assert.strictEqual(body.success, false);
    });

    it('SALESMAN cannot get user by ID (403 Forbidden)', async () => {
      const res = await fetch(`${baseUrl}/api/users/${adminUserId}`, {
        headers: {
          Authorization: `Bearer ${salesmanToken}`,
        },
      });

      const body = await res.json();
      assert.strictEqual(res.status, 403);
      assert.strictEqual(body.success, false);
    });
  });

  describe('14-19. Activate & Deactivate SALESMAN (PATCH /api/users/:id/status)', () => {
    let targetSalesmanId: number;
    let targetSalesmanToken: string;
    const targetUsername = 'phase5_deact_salesman';
    const targetPassword = 'DeactPassword123!';

    before(async () => {
      // Create dedicated salesman for deactivation tests
      const res = await fetch(`${baseUrl}/api/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          username: targetUsername,
          password: targetPassword,
        }),
      });
      const data = await res.json();
      targetSalesmanId = data.data.user.id;

      // Login to obtain active JWT
      const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: targetUsername,
          password: targetPassword,
        }),
      });
      const loginData = await loginRes.json();
      targetSalesmanToken = loginData.data.token;
    });

    it('14. ADMIN deactivates SALESMAN successfully', async () => {
      const res = await fetch(`${baseUrl}/api/users/${targetSalesmanId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ active: false }),
      });

      const body = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.user.active, false);

      const dbUser = await prisma.user.findUnique({
        where: { id: targetSalesmanId },
      });
      assert.strictEqual(dbUser?.active, false);
    });

    it('15. Deactivated SALESMAN cannot login', async () => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: targetUsername,
          password: targetPassword,
        }),
      });

      const body = await res.json();
      assert.strictEqual(res.status, 401);
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.message, 'Account is inactive');
    });

    it('16. Existing JWT for deactivated SALESMAN no longer works on authenticated endpoints', async () => {
      const res = await fetch(`${baseUrl}/api/auth/me`, {
        headers: {
          Authorization: `Bearer ${targetSalesmanToken}`,
        },
      });

      const body = await res.json();
      assert.strictEqual(res.status, 401);
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.message, 'Account is inactive');
    });

    it('17. ADMIN reactivates SALESMAN', async () => {
      const res = await fetch(`${baseUrl}/api/users/${targetSalesmanId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ active: true }),
      });

      const body = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.user.active, true);
    });

    it('18. Reactivated SALESMAN can login again', async () => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: targetUsername,
          password: targetPassword,
        }),
      });

      const body = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.success, true);
      assert.ok(body.data.token);
    });

    it('23. SALESMAN cannot activate/deactivate another user (403 Forbidden)', async () => {
      const res = await fetch(`${baseUrl}/api/users/${targetSalesmanId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${salesmanToken}`,
        },
        body: JSON.stringify({ active: false }),
      });

      const body = await res.json();
      assert.strictEqual(res.status, 403);
      assert.strictEqual(body.success, false);
    });

    it('24. User-management status endpoint cannot deactivate or mutate ADMIN account (400 Bad Request)', async () => {
      const res = await fetch(`${baseUrl}/api/users/${adminUserId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ active: false }),
      });

      const body = await res.json();
      assert.strictEqual(res.status, 400);
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.message, 'Cannot modify status of an ADMIN account');

      // Verify admin is still active in DB
      const adminInDb = await prisma.user.findUnique({
        where: { id: adminUserId },
      });
      assert.strictEqual(adminInDb?.active, true);
    });
  });

  describe('19-22. Password Reset (PATCH /api/users/:id/password)', () => {
    let targetSalesmanId: number;
    const targetUsername = 'phase5_reset_salesman';
    const oldPassword = 'OldPassword123!';
    const newPassword = 'NewResetPassword456!';

    before(async () => {
      const res = await fetch(`${baseUrl}/api/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          username: targetUsername,
          password: oldPassword,
        }),
      });
      const data = await res.json();
      targetSalesmanId = data.data.user.id;
    });

    it('19. ADMIN resets SALESMAN password successfully', async () => {
      const res = await fetch(`${baseUrl}/api/users/${targetSalesmanId}/password`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ password: newPassword }),
      });

      const body = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.message, 'User password reset successfully');
      assert.strictEqual(body.data.user.id, targetSalesmanId);
      assert.strictEqual(body.data.user.passwordHash, undefined, 'passwordHash must never be exposed');
    });

    it('20. Old password fails login after reset', async () => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: targetUsername,
          password: oldPassword,
        }),
      });

      const body = await res.json();
      assert.strictEqual(res.status, 401);
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.message, 'Invalid username or password');
    });

    it('21. New password succeeds login after reset', async () => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: targetUsername,
          password: newPassword,
        }),
      });

      const body = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.success, true);
      assert.ok(body.data.token);
    });

    it('22. SALESMAN cannot change another user password (403 Forbidden)', async () => {
      const res = await fetch(`${baseUrl}/api/users/${targetSalesmanId}/password`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${salesmanToken}`,
        },
        body: JSON.stringify({ password: 'HackerPassword789!' }),
      });

      const body = await res.json();
      assert.strictEqual(res.status, 403);
      assert.strictEqual(body.success, false);
    });

    it('24. User-management password endpoint cannot reset ADMIN account (400 Bad Request)', async () => {
      const res = await fetch(`${baseUrl}/api/users/${adminUserId}/password`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ password: 'SneakyAdminReset123!' }),
      });

      const body = await res.json();
      assert.strictEqual(res.status, 400);
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.message, 'Cannot reset password of an ADMIN account via this endpoint');
    });
  });

  describe('25. Historical Data Integrity After Salesman Deactivation', () => {
    it('Historical Bill and StockTransaction references remain valid after salesman is deactivated', async () => {
      // 1. Create a dedicated salesman
      const salesmanUsername = 'phase5_history_salesman';
      const salesmanPassword = 'HistoryPassword123!';
      const createRes = await fetch(`${baseUrl}/api/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          username: salesmanUsername,
          password: salesmanPassword,
        }),
      });
      const createData = await createRes.json();
      const histSalesmanId = createData.data.user.id;

      // 2. Salesman logs in
      const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: salesmanUsername,
          password: salesmanPassword,
        }),
      });
      const loginData = await loginRes.json();
      const histSalesmanToken = loginData.data.token;

      // 3. Admin creates a product for billing
      const prodRes = await fetch(`${baseUrl}/api/products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          productCode: 'P5_HIST_PROD_1',
          productName: 'History Test Item',
          unit: Unit.PIECE,
          normalRate: 50,
          openingStock: 100,
        }),
      });
      const prodData = await prodRes.json();
      const productId = prodData.data.product.id;

      // 4. Salesman creates a bill
      const billRes = await fetch(`${baseUrl}/api/bills`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${histSalesmanToken}`,
        },
        body: JSON.stringify({
          rateType: RateType.NORMAL,
          paymentType: PaymentType.CASH,
          items: [{ productId, quantity: 2 }],
        }),
      });
      const billData = await billRes.json();
      assert.strictEqual(billRes.status, 201);
      const billId = billData.data.bill.id;

      // 5. Admin deactivates this salesman
      const deactRes = await fetch(`${baseUrl}/api/users/${histSalesmanId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ active: false }),
      });
      assert.strictEqual(deactRes.status, 200);

      // 6. Query the bill directly via Admin API
      const getBillRes = await fetch(`${baseUrl}/api/bills/${billId}`, {
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      });
      const getBillData = await getBillRes.json();
      assert.strictEqual(getBillRes.status, 200);
      assert.strictEqual(getBillData.data.bill.createdBy, histSalesmanId);
      assert.strictEqual(getBillData.data.bill.creator.username, salesmanUsername);
      assert.strictEqual(getBillData.data.bill.creator.role, Role.SALESMAN);

      // 7. Verify stock transactions retain createdBy relation
      const stockTxns = await prisma.stockTransaction.findMany({
        where: { billId },
        include: { creator: true },
      });
      assert.strictEqual(stockTxns.length, 1);
      assert.strictEqual(stockTxns[0].createdBy, histSalesmanId);
      assert.strictEqual(stockTxns[0].creator.username, salesmanUsername);
    });
  });
});


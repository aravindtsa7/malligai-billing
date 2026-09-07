import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import express from 'express';
import bcrypt from 'bcryptjs';
import authRoutes from '../src/modules/auth/auth.routes.js';
import productRoutes from '../src/modules/products/product.routes.js';
import billingRoutes from '../src/modules/billing/billing.routes.js';
import { notFoundHandler } from '../src/core/middlewares/not-found.middleware.js';
import { errorHandler } from '../src/core/middlewares/error.middleware.js';
import { prisma } from '../src/core/database/prisma.js';
import { assertTestDatabase } from './test-helper.js';
import { Role, Unit, RateType, PaymentType } from '../src/generated/prisma/enums.js';

describe('Bill-Level Rate Override Integration Tests', () => {
  let server: Server;
  let baseUrl: string;
  let adminToken: string;
  let salesmanToken: string;
  let defaultCategoryId: number;

  const adminUser = {
    username: 'override_admin',
    password: 'AdminPassword123!',
    role: Role.ADMIN,
  };

  const salesmanUser = {
    username: 'override_salesman',
    password: 'SalesmanPassword123!',
    role: Role.SALESMAN,
  };

  before(async () => {
    await assertTestDatabase();

    const testApp = express();
    testApp.use(express.json());

    testApp.use('/api/auth', authRoutes);
    testApp.use('/api/products', productRoutes);
    testApp.use('/api/bills', billingRoutes);

    testApp.use(notFoundHandler);
    testApp.use(errorHandler);

    await new Promise<void>((resolve) => {
      server = testApp.listen(0, () => {
        const address = server.address();
        if (address && typeof address === 'object') {
          baseUrl = `http://localhost:${address.port}`;
        }
        resolve();
      });
    });

    // Clean up test state
    await prisma.billItem.deleteMany({});
    await prisma.stockTransaction.deleteMany({});
    await prisma.bill.deleteMany({});
    await prisma.product.deleteMany({});
    await prisma.user.deleteMany({
      where: {
        username: { in: [adminUser.username, salesmanUser.username] },
      },
    });

    // Create Category
    const cat = await prisma.category.upsert({
      where: { categoryName: 'OverrideCategory' },
      update: {},
      create: {
        categoryName: 'OverrideCategory',
        tamilName: 'வகை',
        displayOrder: 0,
        active: true,
      },
    });
    defaultCategoryId = cat.id;

    // Create Admin User
    const adminHash = await bcrypt.hash(adminUser.password, 10);
    await prisma.user.create({
      data: {
        username: adminUser.username,
        passwordHash: adminHash,
        role: adminUser.role,
        active: true,
      },
    });

    // Create Salesman User
    const salesmanHash = await bcrypt.hash(salesmanUser.password, 10);
    await prisma.user.create({
      data: {
        username: salesmanUser.username,
        passwordHash: salesmanHash,
        role: salesmanUser.role,
        active: true,
      },
    });

    // Login Admin
    const adminRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: adminUser.username, password: adminUser.password }),
    });
    const adminBody = await adminRes.json();
    adminToken = adminBody.data.token;

    // Login Salesman
    const salesmanRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: salesmanUser.username, password: salesmanUser.password }),
    });
    const salesmanBody = await salesmanRes.json();
    salesmanToken = salesmanBody.data.token;
  });

  after(async () => {
    await assertTestDatabase();
    await prisma.billItem.deleteMany({});
    await prisma.stockTransaction.deleteMany({});
    await prisma.bill.deleteMany({});
    await prisma.product.deleteMany({});
    await prisma.user.deleteMany({
      where: {
        username: { in: [adminUser.username, salesmanUser.username] },
      },
    });
    await prisma.$disconnect();
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  // Helper to create product
  async function createTestProduct(overrides: Record<string, unknown> = {}) {
    const code = `00${Math.floor(1000 + Math.random() * 9000)}`;
    const product = await prisma.product.create({
      data: {
        productCode: code,
        barcode: `890${code}`,
        productName: 'Oil 1L Packet',
        tamilName: 'எண்ணெய் 1லி',
        categoryId: defaultCategoryId,
        unit: Unit.PACKET,
        mrpRate: '200.00',
        originalRate: '150.00',
        normalRate: '180.00',
        retailRate: '175.00',
        functionRate: '170.00',
        currentStock: '50.000',
        active: true,
        ...overrides,
      },
    });
    return product;
  }

  it('1. normal bill without override uses master NORMAL rate', async () => {
    const product = await createTestProduct({ normalRate: '180.00' });

    const res = await fetch(`${baseUrl}/api/bills`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        rateType: 'NORMAL',
        paymentType: 'CASH',
        items: [{ productId: product.id, quantity: '2' }],
      }),
    });

    assert.equal(res.status, 201);
    const json = await res.json();
    const item = json.data.bill.items[0];
    assert.equal(item.rate, '180.00');
    assert.equal(item.amount, '360.00');
    assert.equal(json.data.bill.totalAmount, '360.00');
  });

  it('2. RETAIL no override uses retail master rate', async () => {
    const product = await createTestProduct({ retailRate: '175.00' });

    const res = await fetch(`${baseUrl}/api/bills`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        rateType: 'RETAIL',
        paymentType: 'CASH',
        items: [{ productId: product.id, quantity: '1' }],
      }),
    });

    assert.equal(res.status, 201);
    const json = await res.json();
    assert.equal(json.data.bill.items[0].rate, '175.00');
    assert.equal(json.data.bill.items[0].amount, '175.00');
  });

  it('3. FUNCTION no override uses function master rate', async () => {
    const product = await createTestProduct({ functionRate: '170.00' });

    const res = await fetch(`${baseUrl}/api/bills`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        rateType: 'FUNCTION',
        paymentType: 'CASH',
        items: [{ productId: product.id, quantity: '1' }],
      }),
    });

    assert.equal(res.status, 201);
    const json = await res.json();
    assert.equal(json.data.bill.items[0].rate, '170.00');
    assert.equal(json.data.bill.items[0].amount, '170.00');
  });

  it('4, 5, 6, 7. valid unitRateOverride is accepted, produces BillItem.rate, exact amount and total', async () => {
    const product = await createTestProduct({ normalRate: '180.00' });

    const res = await fetch(`${baseUrl}/api/bills`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        rateType: 'NORMAL',
        paymentType: 'CASH',
        items: [
          {
            productId: product.id,
            quantity: '3',
            unitRateOverride: '190.00',
          },
        ],
      }),
    });

    assert.equal(res.status, 201);
    const json = await res.json();
    const bill = json.data.bill;
    assert.equal(bill.items[0].rate, '190.00');
    assert.equal(bill.items[0].amount, '570.00'); // 190.00 x 3
    assert.equal(bill.totalAmount, '570.00');

    // Verify in database snapshot
    const dbItem = await prisma.billItem.findFirstOrThrow({ where: { billId: bill.id } });
    assert.equal(dbItem.rate.toFixed(2), '190.00');
    assert.equal(dbItem.amount.toFixed(2), '570.00');
  });

  it('8, 9, 10, 11, 12, 13. Product Master rates unchanged and stock deduction remains correct', async () => {
    const product = await createTestProduct({
      normalRate: '180.00',
      retailRate: '175.00',
      functionRate: '170.00',
      originalRate: '150.00',
      mrpRate: '200.00',
      currentStock: '50.000',
    });

    const res = await fetch(`${baseUrl}/api/bills`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        rateType: 'NORMAL',
        paymentType: 'CASH',
        items: [
          {
            productId: product.id,
            quantity: '5',
            unitRateOverride: '192.50',
          },
        ],
      }),
    });

    assert.equal(res.status, 201);

    // Verify Product Master in database is 100% UNCHANGED
    const fresh = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    assert.equal(fresh.normalRate.toFixed(2), '180.00');
    assert.equal(fresh.retailRate.toFixed(2), '175.00');
    assert.equal(fresh.functionRate.toFixed(2), '170.00');
    assert.equal(fresh.originalRate.toFixed(2), '150.00');
    assert.equal(fresh.mrpRate.toFixed(2), '200.00');
    assert.equal(fresh.productCode, product.productCode);
    assert.equal(fresh.barcode, product.barcode);

    // Stock deduction verified
    assert.equal(fresh.currentStock.toFixed(3), '45.000'); // 50 - 5
  });

  it('14. invalid override rejected (negative, non-numeric, empty string)', async () => {
    const product = await createTestProduct({ normalRate: '180.00' });

    for (const badOverride of ['-10.00', 'abc', '', '   ', '10.00.00']) {
      const res = await fetch(`${baseUrl}/api/bills`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${salesmanToken}`,
        },
        body: JSON.stringify({
          rateType: 'NORMAL',
          paymentType: 'CASH',
          items: [
            {
              productId: product.id,
              quantity: '1',
              unitRateOverride: badOverride,
            },
          ],
        }),
      });

      assert.equal(res.status, 400, `Expected 400 for bad override: ${badOverride}`);
    }
  });

  it('15. zero override rejected ("0", "0.00", "00.00")', async () => {
    const product = await createTestProduct({ normalRate: '180.00' });

    for (const zeroVal of ['0', '0.00', '00.00', '0.0']) {
      const res = await fetch(`${baseUrl}/api/bills`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${salesmanToken}`,
        },
        body: JSON.stringify({
          rateType: 'NORMAL',
          paymentType: 'CASH',
          items: [
            {
              productId: product.id,
              quantity: '1',
              unitRateOverride: zeroVal,
            },
          ],
        }),
      });

      assert.equal(res.status, 400, `Expected 400 for zero override: ${zeroVal}`);
    }
  });

  it('16. >2-decimal override rejected ("190.123")', async () => {
    const product = await createTestProduct({ normalRate: '180.00' });

    const res = await fetch(`${baseUrl}/api/bills`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        rateType: 'NORMAL',
        paymentType: 'CASH',
        items: [
          {
            productId: product.id,
            quantity: '1',
            unitRateOverride: '190.123',
          },
        ],
      }),
    });

    assert.equal(res.status, 400);
  });

  it('17. scientific notation rejected ("1e5")', async () => {
    const product = await createTestProduct({ normalRate: '180.00' });

    const res = await fetch(`${baseUrl}/api/bills`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        rateType: 'NORMAL',
        paymentType: 'CASH',
        items: [
          {
            productId: product.id,
            quantity: '1',
            unitRateOverride: '1e5',
          },
        ],
      }),
    });

    assert.equal(res.status, 400);
  });

  it('18. fractional quantity + override exact decimal math', async () => {
    const product = await createTestProduct({ normalRate: '180.00' });

    // 1.500 kg x ₹190.50 = ₹285.75
    const res = await fetch(`${baseUrl}/api/bills`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        rateType: 'NORMAL',
        paymentType: 'CASH',
        items: [
          {
            productId: product.id,
            quantity: '1.500',
            unitRateOverride: '190.50',
          },
        ],
      }),
    });

    assert.equal(res.status, 201);
    const json = await res.json();
    assert.equal(json.data.bill.items[0].rate, '190.50');
    assert.equal(json.data.bill.items[0].amount, '285.75');
    assert.equal(json.data.bill.totalAmount, '285.75');
  });

  it('19 & 20. non-overridden expectedUnitRate mismatch -> 409 and causes NO bill/stock mutation', async () => {
    const product = await createTestProduct({ normalRate: '180.00', currentStock: '30.000' });
    const initialBillCount = await prisma.bill.count();

    const res = await fetch(`${baseUrl}/api/bills`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        rateType: 'NORMAL',
        paymentType: 'CASH',
        items: [
          {
            productId: product.id,
            quantity: '2',
            expectedUnitRate: '170.00', // Mismatch! Master is 180.00
          },
        ],
      }),
    });

    assert.equal(res.status, 409);
    const json = await res.json();
    assert.equal(json.success, false);
    assert.equal(json.details.code, 'RATE_CHANGED');
    assert.equal(json.details.currentRate, '180.00');
    assert.equal(json.details.expectedUnitRate, '170.00');

    // No bill created
    const finalBillCount = await prisma.bill.count();
    assert.equal(finalBillCount, initialBillCount);

    // No stock mutation
    const fresh = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    assert.equal(fresh.currentStock.toFixed(3), '30.000');
  });

  it('21. overridden item does NOT fail merely because master changed', async () => {
    const product = await createTestProduct({ normalRate: '180.00' });

    // Client explicitly sells at ₹195.00 via unitRateOverride
    const res = await fetch(`${baseUrl}/api/bills`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        rateType: 'NORMAL',
        paymentType: 'CASH',
        items: [
          {
            productId: product.id,
            quantity: '1',
            unitRateOverride: '195.00',
          },
        ],
      }),
    });

    assert.equal(res.status, 201);
    const json = await res.json();
    assert.equal(json.data.bill.items[0].rate, '195.00');
    assert.equal(json.data.bill.totalAmount, '195.00');
  });

  it('22 & 23. historical BillItem retains override snapshot and future bill returns to master rate', async () => {
    const product = await createTestProduct({ normalRate: '180.00', currentStock: '50.000' });

    // Bill 1: override at ₹190.00
    const res1 = await fetch(`${baseUrl}/api/bills`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        rateType: 'NORMAL',
        paymentType: 'CASH',
        items: [
          {
            productId: product.id,
            quantity: '1',
            unitRateOverride: '190.00',
          },
        ],
      }),
    });
    assert.equal(res1.status, 201);
    const json1 = await res1.json();
    const bill1Id = json1.data.bill.id;

    // Bill 2: next bill without override starts again at Product Master rate ₹180.00
    const res2 = await fetch(`${baseUrl}/api/bills`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        rateType: 'NORMAL',
        paymentType: 'CASH',
        items: [
          {
            productId: product.id,
            quantity: '1',
          },
        ],
      }),
    });
    assert.equal(res2.status, 201);
    const json2 = await res2.json();
    assert.equal(json2.data.bill.items[0].rate, '180.00');
    assert.equal(json2.data.bill.items[0].amount, '180.00');

    // Historical Bill 1 remains strictly at ₹190.00
    const bill1Item = await prisma.billItem.findFirstOrThrow({ where: { billId: bill1Id } });
    assert.equal(bill1Item.rate.toFixed(2), '190.00');
    assert.equal(bill1Item.amount.toFixed(2), '190.00');

    // Product master is still ₹180.00
    const fresh = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    assert.equal(fresh.normalRate.toFixed(2), '180.00');
  });

  it('24. mixed bill: normal + overridden items computes exact total', async () => {
    const productA = await createTestProduct({ normalRate: '100.00' });
    const productB = await createTestProduct({ normalRate: '50.00' });

    // Item A: normal rate (100.00 x 2 = 200.00)
    // Item B: overridden rate (60.00 x 3 = 180.00)
    // Total = 380.00
    const res = await fetch(`${baseUrl}/api/bills`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        rateType: 'NORMAL',
        paymentType: 'CASH',
        items: [
          {
            productId: productA.id,
            quantity: '2',
            expectedUnitRate: '100.00',
          },
          {
            productId: productB.id,
            quantity: '3',
            unitRateOverride: '60.00',
          },
        ],
      }),
    });

    assert.equal(res.status, 201);
    const json = await res.json();
    assert.equal(json.data.bill.totalAmount, '380.00');
    assert.equal(json.data.bill.items[0].rate, '100.00');
    assert.equal(json.data.bill.items[0].amount, '200.00');
    assert.equal(json.data.bill.items[1].rate, '60.00');
    assert.equal(json.data.bill.items[1].amount, '180.00');
  });

  it('25. dedicated PATCH /api/products/:id/billing-rate is removed (404) and SALESMAN cannot edit Product Master', async () => {
    const product = await createTestProduct({ normalRate: '180.00' });

    // 1. PATCH /api/products/:id/billing-rate returns 404
    const patchRes = await fetch(`${baseUrl}/api/products/${product.id}/billing-rate`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        rateType: 'NORMAL',
        expectedCurrentRate: '180.00',
        newRate: '190.00',
      }),
    });
    assert.equal(patchRes.status, 404);

    // 2. Generic Product update PUT /api/products/:id: SALESMAN forbidden (403)
    const putRes = await fetch(`${baseUrl}/api/products/${product.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        productName: 'Hacked Name',
        normalRate: '999.00',
      }),
    });
    assert.equal(putRes.status, 403);

    // Product untouched
    const fresh = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    assert.equal(fresh.normalRate.toFixed(2), '180.00');
  });
});

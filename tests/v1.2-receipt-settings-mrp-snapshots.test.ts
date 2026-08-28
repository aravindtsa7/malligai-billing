import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import express from 'express';
import bcrypt from 'bcryptjs';
import authRoutes from '../src/modules/auth/auth.routes.js';
import productRoutes from '../src/modules/products/product.routes.js';
import billingRoutes from '../src/modules/billing/billing.routes.js';
import receiptSettingsRoutes from '../src/modules/receipt-settings/receipt-settings.routes.js';
import { notFoundHandler } from '../src/core/middlewares/not-found.middleware.js';
import { errorHandler } from '../src/core/middlewares/error.middleware.js';
import { prisma } from '../src/core/database/prisma.js';
import { Prisma } from '../src/generated/prisma/client.js';
import {
  Role,
  Unit,
  RateType,
  PaymentType,
  BillStatus,
} from '../src/generated/prisma/enums.js';

describe('Malligai Billing Backend V1.2 Integration Tests (Receipt Settings, Snapshots, MRP)', () => {
  let server: Server;
  let baseUrl: string;
  let adminToken: string;
  let salesmanToken: string;
  let defaultCategoryId: number;

  const adminUser = {
    username: 'v12_test_admin',
    password: 'AdminPassword123!',
    role: Role.ADMIN,
  };

  const salesmanUser = {
    username: 'v12_test_salesman',
    password: 'SalesmanPassword123!',
    role: Role.SALESMAN,
  };

  before(async () => {
    const testApp = express();
    testApp.use(express.json());

    testApp.use('/api/auth', authRoutes);
    testApp.use('/api/products', productRoutes);
    testApp.use('/api/bills', billingRoutes);
    testApp.use('/api/receipt-settings', receiptSettingsRoutes);

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

    // Cleanup test data
    await prisma.billItem.deleteMany({});
    await prisma.stockTransaction.deleteMany({});
    await prisma.bill.deleteMany({});
    await prisma.product.deleteMany({});
    await prisma.user.deleteMany({
      where: {
        username: { in: [adminUser.username, salesmanUser.username] },
      },
    });

    // Reset receipt settings to default
    await prisma.receiptSettings.deleteMany({});
    await prisma.receiptSettings.create({
      data: {
        id: 1,
        storeName: 'Malligai Billing',
        upiId: null,
        gstin: null,
        showCashier: true,
        showRateTier: true,
        showPayment: true,
        showStatus: true,
      },
    });

    // Ensure default General category exists
    const cat = await prisma.category.upsert({
      where: { categoryName: 'General' },
      update: {},
      create: {
        categoryName: 'General',
        tamilName: 'பொதுவானவை',
        displayOrder: 0,
        active: true,
      },
    });
    defaultCategoryId = cat.id;

    // Create test admin
    const adminHash = await bcrypt.hash(adminUser.password, 10);
    await prisma.user.create({
      data: {
        username: adminUser.username,
        passwordHash: adminHash,
        role: adminUser.role,
        active: true,
      },
    });

    // Create test salesman
    const salesmanHash = await bcrypt.hash(salesmanUser.password, 10);
    await prisma.user.create({
      data: {
        username: salesmanUser.username,
        passwordHash: salesmanHash,
        role: salesmanUser.role,
        active: true,
      },
    });

    // Login admin
    const adminLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: adminUser.username,
        password: adminUser.password,
      }),
    });
    const adminLoginBody = await adminLoginRes.json();
    adminToken = adminLoginBody.data.token;

    // Login salesman
    const salesmanLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: salesmanUser.username,
        password: salesmanUser.password,
      }),
    });
    const salesmanLoginBody = await salesmanLoginRes.json();
    salesmanToken = salesmanLoginBody.data.token;
  });

  after(async () => {
    await prisma.$disconnect();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  // ==================================================
  // 1-7: RECEIPT SETTINGS TESTS
  // ==================================================
  describe('Receipt Settings APIs (ADMIN Only & Validation)', () => {
    it('1. Admin GET settings returns 200 with singleton settings', async () => {
      const res = await fetch(`${baseUrl}/api/receipt-settings`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const body = await res.json();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.receiptSettings.storeName, 'Malligai Billing');
      assert.strictEqual(body.data.receiptSettings.upiId, null);
      assert.strictEqual(body.data.receiptSettings.gstin, null);
      assert.strictEqual(body.data.receiptSettings.showCashier, true);
      assert.strictEqual(body.data.receiptSettings.showRateTier, true);
      assert.strictEqual(body.data.receiptSettings.showPayment, true);
      assert.strictEqual(body.data.receiptSettings.showStatus, true);
    });

    it('2. Salesman GET settings is forbidden (403)', async () => {
      const res = await fetch(`${baseUrl}/api/receipt-settings`, {
        headers: { Authorization: `Bearer ${salesmanToken}` },
      });
      const body = await res.json();

      assert.strictEqual(res.status, 403);
      assert.strictEqual(body.success, false);
    });

    it('3. Admin PUT settings updates settings successfully', async () => {
      const res = await fetch(`${baseUrl}/api/receipt-settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          storeName: 'Malligai Stores',
          upiId: 'malligai@upi',
          gstin: '33ABCDE1234F1Z5',
          showCashier: true,
          showRateTier: false,
          showPayment: true,
          showStatus: false,
        }),
      });
      const body = await res.json();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.receiptSettings.storeName, 'Malligai Stores');
      assert.strictEqual(body.data.receiptSettings.upiId, 'malligai@upi');
      assert.strictEqual(body.data.receiptSettings.gstin, '33ABCDE1234F1Z5');
      assert.strictEqual(body.data.receiptSettings.showCashier, true);
      assert.strictEqual(body.data.receiptSettings.showRateTier, false);
      assert.strictEqual(body.data.receiptSettings.showPayment, true);
      assert.strictEqual(body.data.receiptSettings.showStatus, false);
    });

    it('4. Salesman PUT settings is forbidden (403)', async () => {
      const res = await fetch(`${baseUrl}/api/receipt-settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${salesmanToken}`,
        },
        body: JSON.stringify({
          storeName: 'Hacker Stores',
          upiId: 'hacker@upi',
          gstin: null,
          showCashier: true,
          showRateTier: true,
          showPayment: true,
          showStatus: true,
        }),
      });
      const body = await res.json();

      assert.strictEqual(res.status, 403);
      assert.strictEqual(body.success, false);
    });

    it('5. blank UPI in PUT settings transforms to null', async () => {
      const res = await fetch(`${baseUrl}/api/receipt-settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          storeName: 'Malligai Stores',
          upiId: '   ',
          gstin: '33ABCDE1234F1Z5',
          showCashier: true,
          showRateTier: true,
          showPayment: true,
          showStatus: true,
        }),
      });
      const body = await res.json();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.data.receiptSettings.upiId, null);
      assert.strictEqual(body.data.receiptSettings.gstin, '33ABCDE1234F1Z5');
    });

    it('6. blank GSTIN in PUT settings transforms to null', async () => {
      const res = await fetch(`${baseUrl}/api/receipt-settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          storeName: 'Malligai Stores',
          upiId: 'malligai@upi',
          gstin: '',
          showCashier: true,
          showRateTier: true,
          showPayment: true,
          showStatus: true,
        }),
      });
      const body = await res.json();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.data.receiptSettings.gstin, null);
      assert.strictEqual(body.data.receiptSettings.upiId, 'malligai@upi');
    });

    it('7. empty storeName rejected with 400 Bad Request', async () => {
      const res = await fetch(`${baseUrl}/api/receipt-settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          storeName: '   ',
          upiId: null,
          gstin: null,
          showCashier: true,
          showRateTier: true,
          showPayment: true,
          showStatus: true,
        }),
      });
      const body = await res.json();

      assert.strictEqual(res.status, 400);
      assert.strictEqual(body.success, false);
      assert.ok(body.details.some((d: any) => d.field === 'storeName'));
    });
  });

  // ==================================================
  // 8-13: HISTORICAL RECEIPT SETTINGS SNAPSHOT TESTS
  // ==================================================
  describe('Bill Historical Receipt Settings Snapshot', () => {
    let testProductId: number;
    let billAId: number;
    let billBId: number;

    before(async () => {
      // Create a test product
      const prodRes = await fetch(`${baseUrl}/api/products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          productCode: 'V12-PROD-SNAP-01',
          productName: 'Rice 1kg',
          tamilName: 'அரிசி 1 கிலோ',
          categoryId: defaultCategoryId,
          unit: Unit.KG,
          mrpRate: '75.00',
          normalRate: '60.00',
          openingStock: '100.000',
        }),
      });
      const prodBody = await prodRes.json();
      testProductId = prodBody.data.product.id;
    });

    it('8. Bill creation snapshots current settings', async () => {
      // Set settings to Version A
      await fetch(`${baseUrl}/api/receipt-settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          storeName: 'Malligai Stores Version A',
          upiId: 'old@upi',
          gstin: '33AAAAA0000A1Z5',
          showCashier: true,
          showRateTier: false,
          showPayment: true,
          showStatus: false,
        }),
      });

      // Create Bill A
      const res = await fetch(`${baseUrl}/api/bills`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${salesmanToken}`,
        },
        body: JSON.stringify({
          rateType: RateType.NORMAL,
          paymentType: PaymentType.CASH,
          items: [{ productId: testProductId, quantity: '2.000' }],
        }),
      });
      const body = await res.json();

      assert.strictEqual(res.status, 201);
      assert.ok(body.data.bill.receiptSnapshot);
      assert.strictEqual(body.data.bill.receiptSnapshot.storeName, 'Malligai Stores Version A');
      assert.strictEqual(body.data.bill.receiptSnapshot.upiId, 'old@upi');
      assert.strictEqual(body.data.bill.receiptSnapshot.gstin, '33AAAAA0000A1Z5');
      assert.strictEqual(body.data.bill.receiptSnapshot.showCashier, true);
      assert.strictEqual(body.data.bill.receiptSnapshot.showRateTier, false);
      assert.strictEqual(body.data.bill.receiptSnapshot.showPayment, true);
      assert.strictEqual(body.data.bill.receiptSnapshot.showStatus, false);

      billAId = body.data.bill.id;
    });

    it('9. settings change does not change old Bill A', async () => {
      // Change settings to Version B
      await fetch(`${baseUrl}/api/receipt-settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          storeName: 'Malligai Super Market Version B',
          upiId: 'new@upi',
          gstin: '33BBBBB1111B1Z5',
          showCashier: false,
          showRateTier: true,
          showPayment: false,
          showStatus: true,
        }),
      });

      // Fetch Bill A detail
      const res = await fetch(`${baseUrl}/api/bills/${billAId}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const body = await res.json();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.data.bill.receiptSnapshot.storeName, 'Malligai Stores Version A');
      assert.strictEqual(body.data.bill.receiptSnapshot.upiId, 'old@upi');
      assert.strictEqual(body.data.bill.receiptSnapshot.gstin, '33AAAAA0000A1Z5');
      assert.strictEqual(body.data.bill.receiptSnapshot.showCashier, true);
      assert.strictEqual(body.data.bill.receiptSnapshot.showRateTier, false);
      assert.strictEqual(body.data.bill.receiptSnapshot.showPayment, true);
      assert.strictEqual(body.data.bill.receiptSnapshot.showStatus, false);
    });

    it('10. new Bill receives new settings', async () => {
      // Create Bill B
      const res = await fetch(`${baseUrl}/api/bills`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${salesmanToken}`,
        },
        body: JSON.stringify({
          rateType: RateType.NORMAL,
          paymentType: PaymentType.UPI,
          items: [{ productId: testProductId, quantity: '1.000' }],
        }),
      });
      const body = await res.json();

      assert.strictEqual(res.status, 201);
      assert.strictEqual(body.data.bill.receiptSnapshot.storeName, 'Malligai Super Market Version B');
      assert.strictEqual(body.data.bill.receiptSnapshot.upiId, 'new@upi');
      assert.strictEqual(body.data.bill.receiptSnapshot.gstin, '33BBBBB1111B1Z5');
      assert.strictEqual(body.data.bill.receiptSnapshot.showCashier, false);
      assert.strictEqual(body.data.bill.receiptSnapshot.showRateTier, true);
      assert.strictEqual(body.data.bill.receiptSnapshot.showPayment, false);
      assert.strictEqual(body.data.bill.receiptSnapshot.showStatus, true);

      billBId = body.data.bill.id;
    });

    it('11. list returns receiptSnapshot on all bills', async () => {
      const res = await fetch(`${baseUrl}/api/bills`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const body = await res.json();

      assert.strictEqual(res.status, 200);
      const foundBillA = body.data.bills.find((b: any) => b.id === billAId);
      const foundBillB = body.data.bills.find((b: any) => b.id === billBId);

      assert.ok(foundBillA);
      assert.ok(foundBillB);
      assert.strictEqual(foundBillA.receiptSnapshot.storeName, 'Malligai Stores Version A');
      assert.strictEqual(foundBillB.receiptSnapshot.storeName, 'Malligai Super Market Version B');
    });

    it('12. detail returns receiptSnapshot', async () => {
      const res = await fetch(`${baseUrl}/api/bills/${billBId}`, {
        headers: { Authorization: `Bearer ${salesmanToken}` },
      });
      const body = await res.json();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.data.bill.receiptSnapshot.storeName, 'Malligai Super Market Version B');
    });

    it('13. cancellation preserves original receiptSnapshot', async () => {
      const cancelRes = await fetch(`${baseUrl}/api/bills/${billAId}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const cancelBody = await cancelRes.json();

      assert.strictEqual(cancelRes.status, 200);
      assert.strictEqual(cancelBody.data.bill.status, BillStatus.CANCELLED);
      assert.strictEqual(cancelBody.data.bill.receiptSnapshot.storeName, 'Malligai Stores Version A');
      assert.strictEqual(cancelBody.data.bill.receiptSnapshot.upiId, 'old@upi');
      assert.strictEqual(cancelBody.data.bill.receiptSnapshot.gstin, '33AAAAA0000A1Z5');
      assert.strictEqual(cancelBody.data.bill.receiptSnapshot.showCashier, true);
      assert.strictEqual(cancelBody.data.bill.receiptSnapshot.showRateTier, false);
      assert.strictEqual(cancelBody.data.bill.receiptSnapshot.showPayment, true);
      assert.strictEqual(cancelBody.data.bill.receiptSnapshot.showStatus, false);
    });
  });

  // ==================================================
  // 14-16: BILLITEM TAMIL PRODUCT NAME SNAPSHOT TESTS
  // ==================================================
  describe('BillItem Tamil Name Snapshot & Immutability', () => {
    let tamilProductId: number;
    let noTamilProductId: number;
    let billWithTamilId: number;

    before(async () => {
      // Product with Tamil name
      const res1 = await fetch(`${baseUrl}/api/products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          productCode: 'V12-TAMIL-01',
          productName: 'Cardamom',
          tamilName: 'ஏலக்காய்',
          categoryId: defaultCategoryId,
          unit: Unit.GRAM,
          mrpRate: '50.00',
          normalRate: '40.00',
          openingStock: '500.000',
        }),
      });
      const body1 = await res1.json();
      tamilProductId = body1.data.product.id;

      // Product without Tamil name
      const res2 = await fetch(`${baseUrl}/api/products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          productCode: 'V12-NO-TAMIL-01',
          productName: 'Imported Chocolate',
          tamilName: null,
          categoryId: defaultCategoryId,
          unit: Unit.PIECE,
          mrpRate: '150.00',
          normalRate: '120.00',
          openingStock: '50.000',
        }),
      });
      const body2 = await res2.json();
      noTamilProductId = body2.data.product.id;
    });

    it('14. BillItem snapshots tamilName', async () => {
      const res = await fetch(`${baseUrl}/api/bills`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${salesmanToken}`,
        },
        body: JSON.stringify({
          rateType: RateType.NORMAL,
          paymentType: PaymentType.CASH,
          items: [{ productId: tamilProductId, quantity: '50.000' }],
        }),
      });
      const body = await res.json();

      assert.strictEqual(res.status, 201);
      assert.strictEqual(body.data.bill.items[0].productName, 'Cardamom');
      assert.strictEqual(body.data.bill.items[0].tamilName, 'ஏலக்காய்');
      billWithTamilId = body.data.bill.id;
    });

    it('15. Product Tamil name changed later does not change old BillItem', async () => {
      // Update product Tamil name
      await fetch(`${baseUrl}/api/products/${tamilProductId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          productName: 'Green Cardamom',
          tamilName: 'பச்சை ஏலக்காய் புதியது',
        }),
      });

      // Verify old bill item still has original snapshot
      const res = await fetch(`${baseUrl}/api/bills/${billWithTamilId}`, {
        headers: { Authorization: `Bearer ${salesmanToken}` },
      });
      const body = await res.json();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.data.bill.items[0].productName, 'Cardamom');
      assert.strictEqual(body.data.bill.items[0].tamilName, 'ஏலக்காய்');
    });

    it('16. null Tamil name remains null in BillItem', async () => {
      const res = await fetch(`${baseUrl}/api/bills`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${salesmanToken}`,
        },
        body: JSON.stringify({
          rateType: RateType.NORMAL,
          paymentType: PaymentType.CASH,
          items: [{ productId: noTamilProductId, quantity: '2.000' }],
        }),
      });
      const body = await res.json();

      assert.strictEqual(res.status, 201);
      assert.strictEqual(body.data.bill.items[0].tamilName, null);
    });
  });

  // ==================================================
  // 17-24: PRODUCT MRP & RATE FALLBACK / CLEAR RULES
  // ==================================================
  describe('Product MRP & Rate Rules', () => {
    it('17. existing Product serialization contains mrpRate', async () => {
      const res = await fetch(`${baseUrl}/api/products`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const body = await res.json();

      assert.strictEqual(res.status, 200);
      assert.ok(body.data.products.length > 0);
      for (const p of body.data.products) {
        assert.ok(typeof p.mrpRate === 'string');
        assert.match(p.mrpRate, /^\d+\.\d{2}$/);
      }
    });

    it('18. create requires mrpRate (400 if missing or empty)', async () => {
      const resMissing = await fetch(`${baseUrl}/api/products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          productCode: 'V12-NO-MRP',
          productName: 'Missing MRP Item',
          categoryId: defaultCategoryId,
          unit: Unit.PIECE,
          normalRate: '100.00',
        }),
      });
      const bodyMissing = await resMissing.json();
      assert.strictEqual(resMissing.status, 400);
      assert.ok(bodyMissing.details.some((d: any) => d.field === 'mrpRate'));

      const resEmpty = await fetch(`${baseUrl}/api/products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          productCode: 'V12-EMPTY-MRP',
          productName: 'Empty MRP Item',
          categoryId: defaultCategoryId,
          unit: Unit.PIECE,
          mrpRate: '',
          normalRate: '100.00',
        }),
      });
      assert.strictEqual(resEmpty.status, 400);
    });

    it('19. create requires normalRate (400 if missing or empty)', async () => {
      const resMissing = await fetch(`${baseUrl}/api/products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          productCode: 'V12-NO-NORMAL',
          productName: 'Missing Normal Rate Item',
          categoryId: defaultCategoryId,
          unit: Unit.PIECE,
          mrpRate: '100.00',
        }),
      });
      const bodyMissing = await resMissing.json();
      assert.strictEqual(resMissing.status, 400);
      assert.ok(bodyMissing.details.some((d: any) => d.field === 'normalRate'));
    });

    it('20. create with originalRate omitted -> defaults to "0.00"', async () => {
      const res = await fetch(`${baseUrl}/api/products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          productCode: 'V12-NO-ORIGINAL',
          productName: 'No Original Rate Item',
          categoryId: defaultCategoryId,
          unit: Unit.PIECE,
          mrpRate: '120.00',
          normalRate: '100.00',
          retailRate: '95.00',
          functionRate: '90.00',
        }),
      });
      const body = await res.json();

      assert.strictEqual(res.status, 201);
      assert.strictEqual(body.data.product.originalRate, '0.00');
      assert.strictEqual(body.data.product.normalRate, '100.00');
    });

    it('21. create with retailRate omitted -> defaults to normalRate', async () => {
      const res = await fetch(`${baseUrl}/api/products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          productCode: 'V12-NO-RETAIL',
          productName: 'No Retail Rate Item',
          categoryId: defaultCategoryId,
          unit: Unit.PIECE,
          mrpRate: '150.00',
          normalRate: '125.00',
          originalRate: '100.00',
          functionRate: '120.00',
        }),
      });
      const body = await res.json();

      assert.strictEqual(res.status, 201);
      assert.strictEqual(body.data.product.retailRate, '125.00');
      assert.strictEqual(body.data.product.normalRate, '125.00');
    });

    it('22. create with functionRate omitted -> defaults to normalRate', async () => {
      const res = await fetch(`${baseUrl}/api/products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          productCode: 'V12-NO-FUNCTION',
          productName: 'No Function Rate Item',
          categoryId: defaultCategoryId,
          unit: Unit.PIECE,
          mrpRate: '150.00',
          normalRate: '125.00',
        }),
      });
      const body = await res.json();

      assert.strictEqual(res.status, 201);
      assert.strictEqual(body.data.product.originalRate, '0.00');
      assert.strictEqual(body.data.product.normalRate, '125.00');
      assert.strictEqual(body.data.product.retailRate, '125.00');
      assert.strictEqual(body.data.product.functionRate, '125.00');
    });

    it('23. explicit optional reset behavior on update works as specified', async () => {
      // 1. Create a product with custom rates
      const createRes = await fetch(`${baseUrl}/api/products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          productCode: 'V12-RESET-RATES',
          productName: 'Reset Rates Item',
          categoryId: defaultCategoryId,
          unit: Unit.PIECE,
          mrpRate: '200.00',
          originalRate: '100.00',
          normalRate: '150.00',
          retailRate: '140.00',
          functionRate: '130.00',
        }),
      });
      const createBody = await createRes.json();
      const pId = createBody.data.product.id;

      // 2. Reset originalRate with "" -> resets to "0.00"
      const res1 = await fetch(`${baseUrl}/api/products/${pId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ originalRate: '' }),
      });
      const body1 = await res1.json();
      assert.strictEqual(res1.status, 200);
      assert.strictEqual(body1.data.product.originalRate, '0.00');
      assert.strictEqual(body1.data.product.retailRate, '140.00'); // untouched

      // 3. Reset retailRate with "" -> resets to effective normalRate ("150.00")
      const res2 = await fetch(`${baseUrl}/api/products/${pId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ retailRate: '' }),
      });
      const body2 = await res2.json();
      assert.strictEqual(res2.status, 200);
      assert.strictEqual(body2.data.product.retailRate, '150.00');

      // 4. Update normalRate and reset functionRate in same request -> resets functionRate to NEW normalRate
      const res3 = await fetch(`${baseUrl}/api/products/${pId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ normalRate: '180.00', functionRate: '' }),
      });
      const body3 = await res3.json();
      assert.strictEqual(res3.status, 200);
      assert.strictEqual(body3.data.product.normalRate, '180.00');
      assert.strictEqual(body3.data.product.functionRate, '180.00');
      assert.strictEqual(body3.data.product.retailRate, '150.00'); // omitted remains unchanged

      // 5. Attempting to clear mrpRate or normalRate to empty string is rejected with 400
      const resClearMrp = await fetch(`${baseUrl}/api/products/${pId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ mrpRate: '' }),
      });
      assert.strictEqual(resClearMrp.status, 400);

      const resClearNormal = await fetch(`${baseUrl}/api/products/${pId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ normalRate: '' }),
      });
      assert.strictEqual(resClearNormal.status, 400);
    });

    it('24. Product update can change MRP', async () => {
      const createRes = await fetch(`${baseUrl}/api/products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          productCode: 'V12-CHANGE-MRP',
          productName: 'Change MRP Item',
          categoryId: defaultCategoryId,
          unit: Unit.PIECE,
          mrpRate: '100.00',
          normalRate: '90.00',
        }),
      });
      const createBody = await createRes.json();
      const pId = createBody.data.product.id;

      const updateRes = await fetch(`${baseUrl}/api/products/${pId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ mrpRate: '110.00' }),
      });
      const updateBody = await updateRes.json();

      assert.strictEqual(updateRes.status, 200);
      assert.strictEqual(updateBody.data.product.mrpRate, '110.00');
    });
  });

  // ==================================================
  // 25-29: BILLING RATE SAFETY INVARIANT TESTS
  // ==================================================
  describe('Billing Rate Safety Invariant (MRP & OriginalRate Never Used for Billing)', () => {
    let invariantProdId: number;

    before(async () => {
      const res = await fetch(`${baseUrl}/api/products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          productCode: 'V12-INVARIANT-PROD',
          productName: 'Pricing Invariant Item',
          categoryId: defaultCategoryId,
          unit: Unit.PIECE,
          mrpRate: '500.00',
          originalRate: '10.00',
          normalRate: '100.00',
          retailRate: '90.00',
          functionRate: '80.00',
          openingStock: '100.000',
        }),
      });
      const body = await res.json();
      invariantProdId = body.data.product.id;
    });

    it('25. NORMAL rateType strictly uses normalRate (100.00) and not MRP or originalRate', async () => {
      const res = await fetch(`${baseUrl}/api/bills`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${salesmanToken}`,
        },
        body: JSON.stringify({
          rateType: RateType.NORMAL,
          paymentType: PaymentType.CASH,
          items: [{ productId: invariantProdId, quantity: '2.000' }],
        }),
      });
      const body = await res.json();

      assert.strictEqual(res.status, 201);
      assert.strictEqual(body.data.bill.items[0].rate, '100.00');
      assert.strictEqual(body.data.bill.items[0].amount, '200.00');
      assert.strictEqual(body.data.bill.totalAmount, '200.00');
    });

    it('26. RETAIL rateType strictly uses retailRate (90.00) and not MRP or originalRate', async () => {
      const res = await fetch(`${baseUrl}/api/bills`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${salesmanToken}`,
        },
        body: JSON.stringify({
          rateType: RateType.RETAIL,
          paymentType: PaymentType.CASH,
          items: [{ productId: invariantProdId, quantity: '2.000' }],
        }),
      });
      const body = await res.json();

      assert.strictEqual(res.status, 201);
      assert.strictEqual(body.data.bill.items[0].rate, '90.00');
      assert.strictEqual(body.data.bill.items[0].amount, '180.00');
      assert.strictEqual(body.data.bill.totalAmount, '180.00');
    });

    it('27. FUNCTION rateType strictly uses functionRate (80.00) and not MRP or originalRate', async () => {
      const res = await fetch(`${baseUrl}/api/bills`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${salesmanToken}`,
        },
        body: JSON.stringify({
          rateType: RateType.FUNCTION,
          paymentType: PaymentType.CASH,
          items: [{ productId: invariantProdId, quantity: '2.000' }],
        }),
      });
      const body = await res.json();

      assert.strictEqual(res.status, 201);
      assert.strictEqual(body.data.bill.items[0].rate, '80.00');
      assert.strictEqual(body.data.bill.items[0].amount, '160.00');
      assert.strictEqual(body.data.bill.totalAmount, '160.00');
    });

    it('28 & 29. Proof that MRP (500.00) and originalRate (10.00) NEVER enter billing calculation', async () => {
      const allBills = await prisma.billItem.findMany({
        where: { productId: invariantProdId },
      });

      assert.strictEqual(allBills.length, 3);
      for (const item of allBills) {
        const formattedRate = new Prisma.Decimal(String(item.rate)).toFixed(2);
        assert.notStrictEqual(formattedRate, '500.00');
        assert.notStrictEqual(formattedRate, '10.00');
        assert.ok(['100.00', '90.00', '80.00'].includes(formattedRate));
      }
    });
  });
});

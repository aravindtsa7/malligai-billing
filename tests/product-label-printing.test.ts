import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import express from 'express';
import bcrypt from 'bcryptjs';
import authRoutes from '../src/modules/auth/auth.routes.js';
import productRoutes from '../src/modules/products/product.routes.js';
import labelSettingsRoutes from '../src/modules/label-settings/label-settings.routes.js';
import { notFoundHandler } from '../src/core/middlewares/not-found.middleware.js';
import { errorHandler } from '../src/core/middlewares/error.middleware.js';
import { prisma } from '../src/core/database/prisma.js';
import { Role, Unit, LabelSize } from '../src/generated/prisma/enums.js';

describe('Product Label Printing & Cross-Column Collision Integration Tests', () => {
  let server: Server;
  let baseUrl: string;
  let adminToken: string;
  let salesmanToken: string;
  let defaultCategoryId: number;

  const adminUser = {
    username: 'label_test_admin',
    password: 'AdminPassword123!',
    role: Role.ADMIN,
  };

  const salesmanUser = {
    username: 'label_test_salesman',
    password: 'SalesmanPassword123!',
    role: Role.SALESMAN,
  };

  let productAId: number;
  let productBId: number;
  let inactiveProductId: number;
  let leadingZeroProductId: number;

  async function assertProductScanNamespaceInvariant(): Promise<void> {
    const crossRowCollisions = await prisma.$queryRaw<Array<{ left_id: number; right_id: number }>>`
      SELECT left_product.id AS left_id, right_product.id AS right_id
      FROM products AS left_product
      INNER JOIN products AS right_product
        ON left_product.id <> right_product.id
       AND left_product.product_code = right_product.barcode
      LIMIT 1
    `;
    const selfCollisions = await prisma.$queryRaw<Array<{ id: number }>>`
      SELECT id
      FROM products
      WHERE barcode IS NOT NULL
        AND product_code = barcode
      LIMIT 1
    `;

    assert.deepStrictEqual(crossRowCollisions, [], 'No productCode may equal another product barcode');
    assert.deepStrictEqual(selfCollisions, [], 'A productCode may not equal its own barcode');
  }

  before(async () => {
    const testApp = express();
    testApp.use(express.json());

    testApp.use('/api/auth', authRoutes);
    testApp.use('/api/products', productRoutes);
    testApp.use('/api/label-settings', labelSettingsRoutes);

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
    await prisma.stockTransaction.deleteMany({});
    await prisma.billItem.deleteMany({});
    await prisma.bill.deleteMany({});
    await prisma.product.deleteMany({});
    await prisma.labelSettings.deleteMany({});
    await prisma.user.deleteMany({
      where: {
        username: { in: [adminUser.username, salesmanUser.username] },
      },
    });

    // Reset label settings to default singleton
    await prisma.labelSettings.create({
      data: {
        id: 1,
        storeName: 'MALLIGAI',
        defaultLabelSize: LabelSize.LABEL_50X40,
      },
    });

    // Ensure category exists
    const cat = await prisma.category.upsert({
      where: { categoryName: 'Label Test Category' },
      update: {},
      create: {
        categoryName: 'Label Test Category',
        tamilName: 'லேபிள் சோதனை',
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
    const adminLoginData = await adminLoginRes.json();
    adminToken = adminLoginData.data.token;

    // Login salesman
    const salesmanLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: salesmanUser.username,
        password: salesmanUser.password,
      }),
    });
    const salesmanLoginData = await salesmanLoginRes.json();
    salesmanToken = salesmanLoginData.data.token;

    // Seed test products
    // Product A: productCode = "1211", barcode = "8901111111111"
    const prodARes = await fetch(`${baseUrl}/api/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        productCode: '1211',
        barcode: '8901111111111',
        productName: 'Product A (1211)',
        categoryId: defaultCategoryId,
        unit: Unit.PIECE,
        mrpRate: '100.00',
        normalRate: '90.00',
      }),
    });
    const prodAData = await prodARes.json();
    productAId = prodAData.data.product.id;

    // Product B: productCode = "89001", barcode = "8902222222222"
    const prodBRes = await fetch(`${baseUrl}/api/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        productCode: '89001',
        barcode: '8902222222222',
        productName: 'Product B (89001)',
        categoryId: defaultCategoryId,
        unit: Unit.KG,
        mrpRate: '200.00',
        normalRate: '180.00',
      }),
    });
    const prodBData = await prodBRes.json();
    productBId = prodBData.data.product.id;

    // Inactive Product: productCode = "INACT-001", barcode = "8903333333333", active = false
    const inactRes = await fetch(`${baseUrl}/api/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        productCode: 'INACT-001',
        barcode: '8903333333333',
        productName: 'Inactive Product',
        categoryId: defaultCategoryId,
        unit: Unit.PACKET,
        mrpRate: '50.00',
        normalRate: '45.00',
      }),
    });
    const inactData = await inactRes.json();
    inactiveProductId = inactData.data.product.id;
    await prisma.product.update({
      where: { id: inactiveProductId },
      data: { active: false },
    });

    // Leading Zero Product: productCode = "001211", barcode = null
    const leadZeroRes = await fetch(`${baseUrl}/api/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        productCode: '001211',
        productName: 'Leading Zero Product',
        categoryId: defaultCategoryId,
        unit: Unit.PIECE,
        mrpRate: '60.00',
        normalRate: '55.00',
      }),
    });
    const leadZeroData = await leadZeroRes.json();
    leadingZeroProductId = leadZeroData.data.product.id;
  });

  after(async () => {
    await prisma.stockTransaction.deleteMany({});
    await prisma.billItem.deleteMany({});
    await prisma.bill.deleteMany({});
    await prisma.product.deleteMany({});
    await prisma.labelSettings.deleteMany({});
    await prisma.user.deleteMany({
      where: {
        username: { in: [adminUser.username, salesmanUser.username] },
      },
    });

    await prisma.$disconnect();

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  describe('SCAN API (GET /api/products/scan/:value)', () => {
    it('1. productCode scan returns product', async () => {
      const res = await fetch(`${baseUrl}/api/products/scan/1211`, {
        headers: { Authorization: `Bearer ${salesmanToken}` },
      });
      const body = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.product.id, productAId);
      assert.strictEqual(body.data.product.productCode, '1211');
      assert.strictEqual(body.data.product.barcode, '8901111111111');
      assert.strictEqual(body.data.product.productName, 'Product A (1211)');
    });

    it('2. manufacturer barcode scan returns product', async () => {
      const res = await fetch(`${baseUrl}/api/products/scan/8901111111111`, {
        headers: { Authorization: `Bearer ${salesmanToken}` },
      });
      const body = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.product.id, productAId);
      assert.strictEqual(body.data.product.productCode, '1211');
      assert.strictEqual(body.data.product.barcode, '8901111111111');
    });

    it('3. leading-zero productCode works (e.g. "001211")', async () => {
      const res = await fetch(`${baseUrl}/api/products/scan/001211`, {
        headers: { Authorization: `Bearer ${salesmanToken}` },
      });
      const body = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.product.id, leadingZeroProductId);
      assert.strictEqual(body.data.product.productCode, '001211');
    });

    it('4. unknown value returns 404', async () => {
      const res = await fetch(`${baseUrl}/api/products/scan/UNKNOWN-SCAN-CODE-999`, {
        headers: { Authorization: `Bearer ${salesmanToken}` },
      });
      const body = await res.json();
      assert.strictEqual(res.status, 404);
      assert.strictEqual(body.success, false);
    });

    it('5. inactive product behavior', async () => {
      const res = await fetch(`${baseUrl}/api/products/scan/INACT-001`, {
        headers: { Authorization: `Bearer ${salesmanToken}` },
      });
      const body = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.product.id, inactiveProductId);
      assert.strictEqual(body.data.product.productCode, 'INACT-001');
      assert.strictEqual(body.data.product.active, false);
    });

    it('6. ADMIN access permitted', async () => {
      const res = await fetch(`${baseUrl}/api/products/scan/1211`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const body = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.product.id, productAId);
    });

    it('7. SALESMAN access permitted', async () => {
      const res = await fetch(`${baseUrl}/api/products/scan/1211`, {
        headers: { Authorization: `Bearer ${salesmanToken}` },
      });
      const body = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.product.id, productAId);
    });

    it('8. unauthorized rejected (401)', async () => {
      const res = await fetch(`${baseUrl}/api/products/scan/1211`);
      const body = await res.json();
      assert.strictEqual(res.status, 401);
      assert.strictEqual(body.success, false);
    });
  });

  describe('CREATE Cross-Column Collision Safety (POST /api/products)', () => {
    it('9. productCode duplicate rejected (409)', async () => {
      const res = await fetch(`${baseUrl}/api/products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          productCode: '1211', // same as Product A productCode
          productName: 'Duplicate ProductCode Item',
          categoryId: defaultCategoryId,
          unit: Unit.PIECE,
          mrpRate: '100.00',
          normalRate: '90.00',
        }),
      });
      const body = await res.json();
      assert.strictEqual(res.status, 409);
      assert.strictEqual(body.success, false);
    });

    it('10. barcode duplicate rejected (409)', async () => {
      const res = await fetch(`${baseUrl}/api/products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          productCode: 'UNIQUE-CODE-001',
          barcode: '8901111111111', // same as Product A barcode
          productName: 'Duplicate Barcode Item',
          categoryId: defaultCategoryId,
          unit: Unit.PIECE,
          mrpRate: '100.00',
          normalRate: '90.00',
        }),
      });
      const body = await res.json();
      assert.strictEqual(res.status, 409);
      assert.strictEqual(body.success, false);
    });

    it("11. productCode matching another product's barcode rejected (409)", async () => {
      const res = await fetch(`${baseUrl}/api/products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          productCode: '8901111111111', // matches Product A barcode!
          productName: 'Collision Item 1',
          categoryId: defaultCategoryId,
          unit: Unit.PIECE,
          mrpRate: '100.00',
          normalRate: '90.00',
        }),
      });
      const body = await res.json();
      assert.strictEqual(res.status, 409);
      assert.strictEqual(body.success, false);
    });

    it("12. barcode matching another product's productCode rejected (409)", async () => {
      const res = await fetch(`${baseUrl}/api/products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          productCode: 'UNIQUE-CODE-002',
          barcode: '89001', // matches Product B productCode!
          productName: 'Collision Item 2',
          categoryId: defaultCategoryId,
          unit: Unit.PIECE,
          mrpRate: '100.00',
          normalRate: '90.00',
        }),
      });
      const body = await res.json();
      assert.strictEqual(res.status, 409);
      assert.strictEqual(body.success, false);
    });
  });

  describe('UPDATE Cross-Column Collision Safety (PUT /api/products/:id)', () => {
    it("13. productCode -> another product barcode rejected (409)", async () => {
      const res = await fetch(`${baseUrl}/api/products/${productBId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          productCode: '8901111111111', // Product A's barcode
        }),
      });
      const body = await res.json();
      assert.strictEqual(res.status, 409);
      assert.strictEqual(body.success, false);
    });

    it("14. barcode -> another product productCode rejected (409)", async () => {
      const res = await fetch(`${baseUrl}/api/products/${productBId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          barcode: '1211', // Product A's productCode
        }),
      });
      const body = await res.json();
      assert.strictEqual(res.status, 409);
      assert.strictEqual(body.success, false);
    });

    it('15. own existing values do not false-positive (200)', async () => {
      const res = await fetch(`${baseUrl}/api/products/${productAId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          productCode: '1211', // same own productCode
          barcode: '8901111111111', // same own barcode
          productName: 'Product A Updated Name',
          normalRate: '95.00',
        }),
      });
      const body = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.product.productName, 'Product A Updated Name');
      assert.strictEqual(body.data.product.normalRate, '95.00');
    });

    it('16. clearing optional barcode still works (200)', async () => {
      const res = await fetch(`${baseUrl}/api/products/${productAId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          barcode: null,
        }),
      });
      const body = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.product.barcode, null);

      // Verify product A barcode is now null in DB
      const dbProd = await prisma.product.findUnique({ where: { id: productAId } });
      assert.strictEqual(dbProd?.barcode, null);
    });
  });

  describe('SCAN NAMESPACE CONCURRENCY', () => {
    it('concurrent create/create cannot commit a cross-column collision', async () => {
      const createCodeRequest = fetch(`${baseUrl}/api/products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          productCode: 'RACE-A',
          productName: 'Race Create Code',
          categoryId: defaultCategoryId,
          unit: Unit.PIECE,
          mrpRate: '10.00',
          normalRate: '9.00',
        }),
      });
      const createBarcodeRequest = fetch(`${baseUrl}/api/products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          productCode: 'RACE-B',
          barcode: 'RACE-A',
          productName: 'Race Create Barcode',
          categoryId: defaultCategoryId,
          unit: Unit.PIECE,
          mrpRate: '10.00',
          normalRate: '9.00',
        }),
      });

      const responses = await Promise.all([createCodeRequest, createBarcodeRequest]);
      assert.deepStrictEqual(
        responses.map((response) => response.status).sort(),
        [201, 409]
      );
      await assertProductScanNamespaceInvariant();
    });

    it('concurrent create/update cannot commit a cross-column collision', async () => {
      const updateTarget = await prisma.product.create({
        data: {
          productCode: 'RACE-C-EXISTING',
          productName: 'Race Create Update Target',
          categoryId: defaultCategoryId,
          unit: Unit.PIECE,
          mrpRate: '10.00',
          normalRate: '9.00',
        },
      });

      const createRequest = fetch(`${baseUrl}/api/products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          productCode: 'RACE-C',
          productName: 'Race Create Update Creator',
          categoryId: defaultCategoryId,
          unit: Unit.PIECE,
          mrpRate: '10.00',
          normalRate: '9.00',
        }),
      });
      const updateRequest = fetch(`${baseUrl}/api/products/${updateTarget.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ barcode: 'RACE-C' }),
      });

      const responses = await Promise.all([createRequest, updateRequest]);
      assert.deepStrictEqual(
        responses.map((response) => response.status).sort(),
        [201, 409]
      );
      await assertProductScanNamespaceInvariant();
    });

    it('concurrent update/update cannot commit a cross-column collision', async () => {
      const [codeTarget, barcodeTarget] = await Promise.all([
        prisma.product.create({
          data: {
            productCode: 'RACE-D-CODE-TARGET',
            productName: 'Race Update Code Target',
            categoryId: defaultCategoryId,
            unit: Unit.PIECE,
            mrpRate: '10.00',
            normalRate: '9.00',
          },
        }),
        prisma.product.create({
          data: {
            productCode: 'RACE-D-BARCODE-TARGET',
            productName: 'Race Update Barcode Target',
            categoryId: defaultCategoryId,
            unit: Unit.PIECE,
            mrpRate: '10.00',
            normalRate: '9.00',
          },
        }),
      ]);

      const codeUpdateRequest = fetch(`${baseUrl}/api/products/${codeTarget.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ productCode: 'RACE-D' }),
      });
      const barcodeUpdateRequest = fetch(`${baseUrl}/api/products/${barcodeTarget.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ barcode: 'RACE-D' }),
      });

      const responses = await Promise.all([codeUpdateRequest, barcodeUpdateRequest]);
      assert.deepStrictEqual(
        responses.map((response) => response.status).sort(),
        [200, 409]
      );
      await assertProductScanNamespaceInvariant();
    });

    it('validates and writes both final scan fields together', async () => {
      const target = await prisma.product.create({
        data: {
          productCode: 'FINAL-OLD-CODE',
          barcode: 'FINAL-OLD-BARCODE',
          productName: 'Both Fields Target',
          categoryId: defaultCategoryId,
          unit: Unit.PIECE,
          mrpRate: '10.00',
          normalRate: '9.00',
        },
      });

      const response = await fetch(`${baseUrl}/api/products/${target.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          productCode: 'FINAL-NEW-CODE',
          barcode: 'FINAL-NEW-BARCODE',
        }),
      });

      assert.strictEqual(response.status, 200);
      const committed = await prisma.product.findUniqueOrThrow({ where: { id: target.id } });
      assert.strictEqual(committed.productCode, 'FINAL-NEW-CODE');
      assert.strictEqual(committed.barcode, 'FINAL-NEW-BARCODE');
      await assertProductScanNamespaceInvariant();
    });

    it('rejects a productCode/barcode self collision', async () => {
      const response = await fetch(`${baseUrl}/api/products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          productCode: 'SAME',
          barcode: 'SAME',
          productName: 'Self Collision',
          categoryId: defaultCategoryId,
          unit: Unit.PIECE,
          mrpRate: '10.00',
          normalRate: '9.00',
        }),
      });

      assert.strictEqual(response.status, 409);
      await assertProductScanNamespaceInvariant();
    });

    it('clears a barcode supplied as a blank string', async () => {
      const target = await prisma.product.create({
        data: {
          productCode: 'BLANK-BARCODE-CODE',
          barcode: 'BLANK-BARCODE-OLD',
          productName: 'Blank Barcode Target',
          categoryId: defaultCategoryId,
          unit: Unit.PIECE,
          mrpRate: '10.00',
          normalRate: '9.00',
        },
      });

      const response = await fetch(`${baseUrl}/api/products/${target.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ barcode: '   ' }),
      });

      assert.strictEqual(response.status, 200);
      const committed = await prisma.product.findUniqueOrThrow({ where: { id: target.id } });
      assert.strictEqual(committed.barcode, null);
      await assertProductScanNamespaceInvariant();
    });
  });

  describe('LABEL SETTINGS (GET & PUT /api/label-settings)', () => {
    it('17. default singleton read', async () => {
      const res = await fetch(`${baseUrl}/api/label-settings`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const body = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.labelSettings.storeName, 'MALLIGAI');
      assert.strictEqual(body.data.labelSettings.defaultLabelSize, LabelSize.LABEL_50X40);
    });

    it('18. ADMIN update', async () => {
      const res = await fetch(`${baseUrl}/api/label-settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          storeName: 'MALLIGAI STORES',
          defaultLabelSize: LabelSize.LABEL_50X50,
        }),
      });
      const body = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.message, 'Label settings updated successfully');
      assert.strictEqual(body.data.labelSettings.storeName, 'MALLIGAI STORES');
      assert.strictEqual(body.data.labelSettings.defaultLabelSize, LabelSize.LABEL_50X50);
    });

    it('19. SALESMAN denied (403)', async () => {
      // GET
      const getRes = await fetch(`${baseUrl}/api/label-settings`, {
        headers: { Authorization: `Bearer ${salesmanToken}` },
      });
      const getBody = await getRes.json();
      assert.strictEqual(getRes.status, 403);
      assert.strictEqual(getBody.success, false);

      // PUT
      const putRes = await fetch(`${baseUrl}/api/label-settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${salesmanToken}`,
        },
        body: JSON.stringify({
          storeName: 'SALESMAN STORE',
          defaultLabelSize: LabelSize.LABEL_50X40,
        }),
      });
      const putBody = await putRes.json();
      assert.strictEqual(putRes.status, 403);
      assert.strictEqual(putBody.success, false);
    });

    it('20. empty storeName rejected (400)', async () => {
      const res = await fetch(`${baseUrl}/api/label-settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          storeName: '   ',
          defaultLabelSize: LabelSize.LABEL_50X40,
        }),
      });
      const body = await res.json();
      assert.strictEqual(res.status, 400);
      assert.strictEqual(body.success, false);
    });

    it('21. LABEL_50X40 accepted (200)', async () => {
      const res = await fetch(`${baseUrl}/api/label-settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          storeName: 'MALLIGAI',
          defaultLabelSize: 'LABEL_50X40',
        }),
      });
      const body = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.labelSettings.defaultLabelSize, 'LABEL_50X40');
    });

    it('22. LABEL_50X50 accepted (200)', async () => {
      const res = await fetch(`${baseUrl}/api/label-settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          storeName: 'MALLIGAI',
          defaultLabelSize: 'LABEL_50X50',
        }),
      });
      const body = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.labelSettings.defaultLabelSize, 'LABEL_50X50');
    });

    it('23. invalid label size rejected (400)', async () => {
      const res = await fetch(`${baseUrl}/api/label-settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          storeName: 'MALLIGAI',
          defaultLabelSize: 'LABEL_100X100',
        }),
      });
      const body = await res.json();
      assert.strictEqual(res.status, 400);
      assert.strictEqual(body.success, false);
    });

    it('recovers the id=1 singleton atomically under concurrent GET requests', async () => {
      await prisma.labelSettings.deleteMany({});

      const [first, second] = await Promise.all([
        fetch(`${baseUrl}/api/label-settings`, {
          headers: { Authorization: `Bearer ${adminToken}` },
        }),
        fetch(`${baseUrl}/api/label-settings`, {
          headers: { Authorization: `Bearer ${adminToken}` },
        }),
      ]);

      assert.strictEqual(first.status, 200);
      assert.strictEqual(second.status, 200);
      const rows = await prisma.labelSettings.findMany();
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].id, 1);
      assert.strictEqual(rows[0].storeName, 'MALLIGAI');
      assert.strictEqual(rows[0].defaultLabelSize, LabelSize.LABEL_50X40);
    });
  });
});

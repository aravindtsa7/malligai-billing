import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import express from 'express';
import bcrypt from 'bcryptjs';
import authRoutes from '../src/modules/auth/auth.routes.js';
import categoryRoutes from '../src/modules/categories/category.routes.js';
import productRoutes from '../src/modules/products/product.routes.js';
import billingRoutes from '../src/modules/billing/billing.routes.js';
import { notFoundHandler } from '../src/core/middlewares/not-found.middleware.js';
import { errorHandler } from '../src/core/middlewares/error.middleware.js';
import { prisma } from '../src/core/database/prisma.js';
import {
  Role,
  Unit,
  StockTransactionType,
  RateType,
  PaymentType,
} from '../src/generated/prisma/enums.js';
import { formatQuantity } from '../src/modules/products/product.types.js';

describe('Category Master & Product Integration Tests (V1.1)', () => {
  let server: Server;
  let baseUrl: string;
  let adminToken: string;
  let salesmanToken: string;

  const adminUser = {
    username: 'cat_test_admin',
    password: 'AdminPassword123!',
    role: Role.ADMIN,
  };

  const salesmanUser = {
    username: 'cat_test_salesman',
    password: 'SalesmanPassword123!',
    role: Role.SALESMAN,
  };

  let testCategoryRiceId: number;
  let testCategoryOilId: number;
  let testCategoryInactiveId: number;

  before(async () => {
    const testApp = express();
    testApp.use(express.json());

    testApp.use('/api/auth', authRoutes);
    testApp.use('/api/categories', categoryRoutes);
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

    // Cleanup test data
    await prisma.billItem.deleteMany({});
    await prisma.stockTransaction.deleteMany({});
    await prisma.bill.deleteMany({});
    await prisma.billSequence.deleteMany({});
    await prisma.product.deleteMany({});
    await prisma.category.deleteMany({
      where: {
        categoryName: { not: 'General' },
      },
    });
    await prisma.user.deleteMany({
      where: {
        username: { in: [adminUser.username, salesmanUser.username] },
      },
    });

    // Ensure General category exists
    await prisma.category.upsert({
      where: { categoryName: 'General' },
      update: {},
      create: {
        categoryName: 'General',
        tamilName: 'பொதுவானவை',
        displayOrder: 0,
        active: true,
      },
    });

    // Create users
    const adminHash = await bcrypt.hash(adminUser.password, 10);
    await prisma.user.create({
      data: {
        username: adminUser.username,
        passwordHash: adminHash,
        role: adminUser.role,
        active: true,
      },
    });

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
  });

  after(async () => {
    await prisma.billItem.deleteMany({});
    await prisma.stockTransaction.deleteMany({});
    await prisma.bill.deleteMany({});
    await prisma.billSequence.deleteMany({});
    await prisma.product.deleteMany({});
    await prisma.category.deleteMany({
      where: {
        categoryName: { not: 'General' },
      },
    });
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

  // ==========================================
  // CATEGORY ACCESS & CRUD TESTS (1 - 13)
  // ==========================================

  it('1. ADMIN can create category', async () => {
    const res = await fetch(`${baseUrl}/api/categories`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        categoryName: 'Rice',
        tamilName: 'அரிசி',
        displayOrder: 1,
      }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 201);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.category.categoryName, 'Rice');
    assert.strictEqual(body.data.category.tamilName, 'அரிசி');
    assert.strictEqual(body.data.category.displayOrder, 1);
    assert.strictEqual(body.data.category.active, true);
    testCategoryRiceId = body.data.category.id;
  });

  it('2. SALESMAN cannot create category -> 403', async () => {
    const res = await fetch(`${baseUrl}/api/categories`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        categoryName: 'Spices',
        displayOrder: 2,
      }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 403);
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.message, 'Access forbidden: insufficient role permissions');
  });

  it('3. Unauthenticated create -> 401', async () => {
    const res = await fetch(`${baseUrl}/api/categories`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        categoryName: 'Snacks',
      }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 401);
    assert.strictEqual(body.success, false);
  });

  it('4. ADMIN and SALESMAN can list/read categories', async () => {
    // ADMIN list
    const adminRes = await fetch(`${baseUrl}/api/categories`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const adminBody = await adminRes.json();
    assert.strictEqual(adminRes.status, 200);
    assert.strictEqual(adminBody.success, true);
    assert.ok(Array.isArray(adminBody.data.categories));
    assert.ok(adminBody.data.categories.some((c: any) => c.categoryName === 'Rice'));

    // SALESMAN list
    const salesmanRes = await fetch(`${baseUrl}/api/categories`, {
      headers: { Authorization: `Bearer ${salesmanToken}` },
    });
    const salesmanBody = await salesmanRes.json();
    assert.strictEqual(salesmanRes.status, 200);
    assert.strictEqual(salesmanBody.success, true);
    assert.ok(Array.isArray(salesmanBody.data.categories));

    // Get single category by ID
    const getRes = await fetch(`${baseUrl}/api/categories/${testCategoryRiceId}`, {
      headers: { Authorization: `Bearer ${salesmanToken}` },
    });
    const getBody = await getRes.json();
    assert.strictEqual(getRes.status, 200);
    assert.strictEqual(getBody.data.category.id, testCategoryRiceId);
    assert.strictEqual(getBody.data.category.categoryName, 'Rice');
  });

  it('5. Duplicate categoryName -> 409', async () => {
    const res = await fetch(`${baseUrl}/api/categories`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        categoryName: 'Rice', // duplicate
        displayOrder: 2,
      }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 409);
    assert.strictEqual(body.success, false);
  });

  it('6. Concurrent duplicate category create -> exactly one success / one conflict', async () => {
    const payload = {
      categoryName: 'Concurrent Oil',
      displayOrder: 10,
    };

    const req1 = fetch(`${baseUrl}/api/categories`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify(payload),
    });

    const req2 = fetch(`${baseUrl}/api/categories`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify(payload),
    });

    const [res1, res2] = await Promise.all([req1, req2]);
    const statuses = [res1.status, res2.status].sort();
    assert.deepStrictEqual(statuses, [201, 409]);

    const created = await prisma.category.findMany({
      where: { categoryName: 'Concurrent Oil' },
    });
    assert.strictEqual(created.length, 1);
  });

  it('7. Tamil category name round-trips correctly', async () => {
    const res = await fetch(`${baseUrl}/api/categories`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        categoryName: 'Oil',
        tamilName: 'எண்ணெய்',
        displayOrder: 2,
      }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 201);
    assert.strictEqual(body.data.category.categoryName, 'Oil');
    assert.strictEqual(body.data.category.tamilName, 'எண்ணெய்');
    testCategoryOilId = body.data.category.id;

    // Fetch back to verify persistence
    const fetchRes = await fetch(`${baseUrl}/api/categories/${testCategoryOilId}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const fetchBody = await fetchRes.json();
    assert.strictEqual(fetchBody.data.category.tamilName, 'எண்ணெய்');
  });

  it('8. displayOrder deterministic sorting (displayOrder ASC, categoryName ASC, id ASC)', async () => {
    // Create categories with distinct displayOrders
    await prisma.category.createMany({
      data: [
        { categoryName: 'B_Order_5', displayOrder: 5, active: true },
        { categoryName: 'A_Order_5', displayOrder: 5, active: true },
        { categoryName: 'Order_1', displayOrder: 1, active: true },
        { categoryName: 'Order_10', displayOrder: 10, active: true },
      ],
    });

    const res = await fetch(`${baseUrl}/api/categories`, {
      headers: { Authorization: `Bearer ${salesmanToken}` },
    });
    const body = await res.json();
    assert.strictEqual(res.status, 200);

    const categories = body.data.categories;
    for (let i = 0; i < categories.length - 1; i++) {
      const current = categories[i];
      const next = categories[i + 1];

      if (current.displayOrder === next.displayOrder) {
        assert.ok(
          current.categoryName.localeCompare(next.categoryName) <= 0,
          `Expected "${current.categoryName}" <= "${next.categoryName}" on same displayOrder`
        );
      } else {
        assert.ok(
          current.displayOrder < next.displayOrder,
          `Expected displayOrder ${current.displayOrder} < ${next.displayOrder}`
        );
      }
    }
  });

  it('9. ADMIN can update category', async () => {
    const res = await fetch(`${baseUrl}/api/categories/${testCategoryRiceId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        categoryName: 'Rice & Grains',
        tamilName: 'அரிசி மற்றும் தானியங்கள்',
        displayOrder: 3,
      }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.data.category.categoryName, 'Rice & Grains');
    assert.strictEqual(body.data.category.tamilName, 'அரிசி மற்றும் தானியங்கள்');
    assert.strictEqual(body.data.category.displayOrder, 3);
  });

  it('10. SALESMAN cannot update category -> 403', async () => {
    const res = await fetch(`${baseUrl}/api/categories/${testCategoryRiceId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        categoryName: 'Hacked Rice',
      }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 403);
    assert.strictEqual(body.success, false);
  });

  it('11. ADMIN can deactivate/reactivate category', async () => {
    // Create dedicated category to deactivate
    const cat = await prisma.category.create({
      data: {
        categoryName: 'Seasonal Fruits',
        displayOrder: 20,
        active: true,
      },
    });
    testCategoryInactiveId = cat.id;

    // Deactivate
    const deactRes = await fetch(`${baseUrl}/api/categories/${testCategoryInactiveId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ active: false }),
    });
    const deactBody = await deactRes.json();
    assert.strictEqual(deactRes.status, 200);
    assert.strictEqual(deactBody.data.category.active, false);

    // Verify in DB
    const dbCatDeact = await prisma.category.findUnique({ where: { id: testCategoryInactiveId } });
    assert.strictEqual(dbCatDeact?.active, false);

    // Reactivate
    const reactRes = await fetch(`${baseUrl}/api/categories/${testCategoryInactiveId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ active: true }),
    });
    const reactBody = await reactRes.json();
    assert.strictEqual(reactRes.status, 200);
    assert.strictEqual(reactBody.data.category.active, true);

    // Put it back to inactive for subsequent negative tests
    await fetch(`${baseUrl}/api/categories/${testCategoryInactiveId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ active: false }),
    });
  });

  it('12. SALESMAN cannot change status -> 403', async () => {
    const res = await fetch(`${baseUrl}/api/categories/${testCategoryRiceId}/status`, {
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

  it('13. Category cannot be deleted because no delete API exists', async () => {
    const res = await fetch(`${baseUrl}/api/categories/${testCategoryRiceId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });

    // Unhandled route returns 404
    assert.strictEqual(res.status, 404);
  });

  // ==========================================
  // PRODUCT & CATEGORY INTEGRATION TESTS (14 - 26)
  // ==========================================

  let createdProdId: number;

  it('14. New Product requires categoryId', async () => {
    const res = await fetch(`${baseUrl}/api/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        productCode: 'PROD-NO-CAT',
        productName: 'Product without Category',
        unit: Unit.KG,
        originalRate: '10.00',
        normalRate: '15.00',
        retailRate: '14.00',
        functionRate: '13.00',
      }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 400);
    assert.strictEqual(body.success, false);
    assert.ok(body.details.some((d: any) => d.field === 'categoryId'));
  });

  it('15. Product create with valid active category succeeds', async () => {
    const res = await fetch(`${baseUrl}/api/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        productCode: 'PROD-CAT-01',
        barcode: '8901111222333',
        productName: 'Ponni Boiled Rice 1kg',
        tamilName: 'பொன்னி புழுங்கல் அரிசி',
        categoryId: testCategoryRiceId,
        unit: Unit.KG,
        mrpRate: '70.00',
        originalRate: '50.00',
        normalRate: '60.00',
        retailRate: '58.00',
        functionRate: '55.00',
        openingStock: '20.000',
      }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 201);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.product.categoryId, testCategoryRiceId);
    assert.strictEqual(body.data.product.category.id, testCategoryRiceId);
    assert.strictEqual(body.data.product.category.categoryName, 'Rice & Grains');
    createdProdId = body.data.product.id;
  });

  it('16. Missing category -> controlled failure (404)', async () => {
    const res = await fetch(`${baseUrl}/api/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        productCode: 'PROD-NONEXISTENT-CAT',
        productName: 'Invalid Category Product',
        categoryId: 999999,
        unit: Unit.PIECE,
        mrpRate: '20.00',
        originalRate: '10.00',
        normalRate: '15.00',
        retailRate: '14.00',
        functionRate: '13.00',
      }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 404);
    assert.strictEqual(body.success, false);
  });

  it('17. Inactive category -> create blocked (400)', async () => {
    const res = await fetch(`${baseUrl}/api/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        productCode: 'PROD-INACTIVE-CAT',
        productName: 'Product on Inactive Category',
        categoryId: testCategoryInactiveId,
        unit: Unit.PIECE,
        mrpRate: '20.00',
        originalRate: '10.00',
        normalRate: '15.00',
        retailRate: '14.00',
        functionRate: '13.00',
      }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 400);
    assert.strictEqual(body.success, false);
    assert.match(body.message, /inactive/i);
  });

  it('18. Product update can change category to another active category', async () => {
    const res = await fetch(`${baseUrl}/api/products/${createdProdId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        categoryId: testCategoryOilId,
      }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.data.product.categoryId, testCategoryOilId);
    assert.strictEqual(body.data.product.category.id, testCategoryOilId);
    assert.strictEqual(body.data.product.category.categoryName, 'Oil');
  });

  it('19. Product update to inactive category blocked (400)', async () => {
    const res = await fetch(`${baseUrl}/api/products/${createdProdId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        categoryId: testCategoryInactiveId,
      }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 400);
    assert.strictEqual(body.success, false);
    assert.match(body.message, /inactive/i);
  });

  it('20. Product responses include correct category information across all read endpoints', async () => {
    // Reset product back to Rice category
    await fetch(`${baseUrl}/api/products/${createdProdId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ categoryId: testCategoryRiceId }),
    });

    // 1. GET /products/:id
    const resId = await fetch(`${baseUrl}/api/products/${createdProdId}`, {
      headers: { Authorization: `Bearer ${salesmanToken}` },
    });
    const bodyId = await resId.json();
    assert.strictEqual(resId.status, 200);
    assert.strictEqual(bodyId.data.product.categoryId, testCategoryRiceId);
    assert.strictEqual(bodyId.data.product.category.id, testCategoryRiceId);
    assert.strictEqual(bodyId.data.product.category.categoryName, 'Rice & Grains');

    // 2. GET /products/barcode/:barcode
    const resBarcode = await fetch(`${baseUrl}/api/products/barcode/8901111222333`, {
      headers: { Authorization: `Bearer ${salesmanToken}` },
    });
    const bodyBarcode = await resBarcode.json();
    assert.strictEqual(resBarcode.status, 200);
    assert.strictEqual(bodyBarcode.data.product.categoryId, testCategoryRiceId);
    assert.strictEqual(bodyBarcode.data.product.category.categoryName, 'Rice & Grains');

    // 3. GET /products
    const resList = await fetch(`${baseUrl}/api/products`, {
      headers: { Authorization: `Bearer ${salesmanToken}` },
    });
    const bodyList = await resList.json();
    const prodInList = bodyList.data.products.find((p: any) => p.id === createdProdId);
    assert.ok(prodInList);
    assert.strictEqual(prodInList.categoryId, testCategoryRiceId);
    assert.strictEqual(prodInList.category.categoryName, 'Rice & Grains');
  });

  it('21. GET /products?categoryId=X returns only products in that category', async () => {
    // Create an oil product
    const oilProd = await prisma.product.create({
      data: {
        productCode: 'PROD-OIL-FILTER-01',
        productName: 'Groundnut Oil 1L',
        categoryId: testCategoryOilId,
        unit: Unit.LITRE,
        originalRate: '150.00',
        normalRate: '180.00',
        retailRate: '175.00',
        functionRate: '170.00',
        currentStock: '15.000',
        active: true,
      },
    });

    const res = await fetch(`${baseUrl}/api/products?categoryId=${testCategoryOilId}`, {
      headers: { Authorization: `Bearer ${salesmanToken}` },
    });
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.ok(body.data.products.length > 0);
    assert.ok(body.data.products.every((p: any) => p.categoryId === testCategoryOilId));
    assert.ok(body.data.products.some((p: any) => p.id === oilProd.id));
    assert.ok(!body.data.products.some((p: any) => p.id === createdProdId));
  });

  it('22. GET /products without categoryId preserves all-product behavior', async () => {
    const res = await fetch(`${baseUrl}/api/products`, {
      headers: { Authorization: `Bearer ${salesmanToken}` },
    });
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.ok(body.data.products.some((p: any) => p.categoryId === testCategoryRiceId));
    assert.ok(body.data.products.some((p: any) => p.categoryId === testCategoryOilId));
  });

  it('23. Search q + categoryId filters within category', async () => {
    // Search for "Groundnut" with oil category -> matches
    const resMatch = await fetch(
      `${baseUrl}/api/products/search?q=Groundnut&categoryId=${testCategoryOilId}`,
      {
        headers: { Authorization: `Bearer ${salesmanToken}` },
      }
    );
    const bodyMatch = await resMatch.json();
    assert.strictEqual(resMatch.status, 200);
    assert.strictEqual(bodyMatch.data.products.length, 1);
    assert.strictEqual(bodyMatch.data.products[0].productCode, 'PROD-OIL-FILTER-01');

    // Search for "Groundnut" with rice category -> 0 matches
    const resNoMatch = await fetch(
      `${baseUrl}/api/products/search?q=Groundnut&categoryId=${testCategoryRiceId}`,
      {
        headers: { Authorization: `Bearer ${salesmanToken}` },
      }
    );
    const bodyNoMatch = await resNoMatch.json();
    assert.strictEqual(resNoMatch.status, 200);
    assert.strictEqual(bodyNoMatch.data.products.length, 0);

    // Search for "Groundnut" without categoryId -> matches
    const resAll = await fetch(`${baseUrl}/api/products/search?q=Groundnut`, {
      headers: { Authorization: `Bearer ${salesmanToken}` },
    });
    const bodyAll = await resAll.json();
    assert.strictEqual(resAll.status, 200);
    assert.ok(bodyAll.data.products.some((p: any) => p.productCode === 'PROD-OIL-FILTER-01'));
  });

  it('24. Barcode lookup still works and includes category', async () => {
    const res = await fetch(`${baseUrl}/api/products/barcode/8901111222333`, {
      headers: { Authorization: `Bearer ${salesmanToken}` },
    });
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.data.product.barcode, '8901111222333');
    assert.ok(body.data.product.category);
    assert.strictEqual(body.data.product.category.categoryName, 'Rice & Grains');
  });

  it('25. currentStock protections remain intact', async () => {
    const res = await fetch(`${baseUrl}/api/products/${createdProdId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        currentStock: '99999.000',
      }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 400);
    assert.strictEqual(body.success, false);

    const product = await prisma.product.findUnique({ where: { id: createdProdId } });
    assert.strictEqual(formatQuantity(product?.currentStock), '20.000');
  });

  it('26. opening stock still creates correct ledger entry', async () => {
    const res = await fetch(`${baseUrl}/api/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        productCode: 'PROD-LEDGER-CAT-01',
        productName: 'Ledger Test Item',
        categoryId: testCategoryRiceId,
        unit: Unit.PACKET,
        mrpRate: '20.00',
        originalRate: '10.00',
        normalRate: '15.00',
        retailRate: '14.00',
        functionRate: '13.00',
        openingStock: '12.500',
      }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 201);
    const prodId = body.data.product.id;

    const tx = await prisma.stockTransaction.findFirst({
      where: { productId: prodId, type: StockTransactionType.OPENING_STOCK },
    });
    assert.ok(tx);
    assert.strictEqual(formatQuantity(tx.quantity), '12.500');
    assert.strictEqual(formatQuantity(tx.newStock), '12.500');
  });

  // ==========================================
  // MIGRATION & HISTORICAL SAFETY TESTS (27 - 30)
  // ==========================================

  it('27. Existing/backfilled product can reference General category', async () => {
    const generalCat = await prisma.category.findUniqueOrThrow({
      where: { categoryName: 'General' },
    });

    const legacyProd = await prisma.product.create({
      data: {
        productCode: 'PROD-LEGACY-01',
        productName: 'Legacy Migrated Product',
        categoryId: generalCat.id,
        unit: Unit.KG,
        mrpRate: '50.00',
        originalRate: '30.00',
        normalRate: '40.00',
        retailRate: '38.00',
        functionRate: '35.00',
        currentStock: '10.000',
        active: true,
      },
      include: { category: true },
    });

    assert.strictEqual(legacyProd.categoryId, generalCat.id);
    assert.strictEqual(legacyProd.category.categoryName, 'General');
  });

  it('28. Category deactivation does not delete products or modify stock', async () => {
    const cat = await prisma.category.create({
      data: {
        categoryName: 'Temp Category',
        displayOrder: 50,
        active: true,
      },
    });

    const prod = await prisma.product.create({
      data: {
        productCode: 'PROD-TEMP-CAT-01',
        productName: 'Temp Product',
        categoryId: cat.id,
        unit: Unit.BOX,
        mrpRate: '150.00',
        originalRate: '100.00',
        normalRate: '120.00',
        retailRate: '115.00',
        functionRate: '110.00',
        currentStock: '8.000',
        active: true,
      },
    });

    // Deactivate category
    await prisma.category.update({
      where: { id: cat.id },
      data: { active: false },
    });

    // Product still exists, category still references it, stock untouched
    const prodAfter = await prisma.product.findUnique({
      where: { id: prod.id },
      include: { category: true },
    });
    assert.ok(prodAfter);
    assert.strictEqual(prodAfter.categoryId, cat.id);
    assert.strictEqual(prodAfter.category.active, false);
    assert.strictEqual(formatQuantity(prodAfter.currentStock), '8.000');
  });

  it('29. Historical Bill/BillItem behavior remains unchanged', async () => {
    // Create bill with product
    const billRes = await fetch(`${baseUrl}/api/bills`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        rateType: RateType.NORMAL,
        paymentType: PaymentType.CASH,
        items: [{ productId: createdProdId, quantity: '2.000' }],
      }),
    });

    const billBody = await billRes.json();
    assert.strictEqual(billRes.status, 201);
    assert.strictEqual(billBody.success, true);
    assert.strictEqual(billBody.data.bill.items.length, 1);
    assert.strictEqual(billBody.data.bill.items[0].productId, createdProdId);
  });

  it('30. Stock transactions remain valid', async () => {
    const txs = await prisma.stockTransaction.findMany({
      where: { productId: createdProdId },
    });

    assert.ok(txs.length > 0);
    assert.ok(txs.some((t) => t.type === StockTransactionType.OPENING_STOCK));
    assert.ok(txs.some((t) => t.type === StockTransactionType.SALE));
  });

  // ==========================================
  // CONCURRENCY & SERIALIZATION TESTS (31 - 32)
  // ==========================================

  it('31. Concurrency: Product create vs Category deactivation serializes cleanly', async () => {
    // 1. Create a fresh active category
    const cat = await prisma.category.create({
      data: {
        categoryName: 'Concurrent_Create_Cat_' + Date.now(),
        displayOrder: 100,
        active: true,
      },
    });

    // 2. Launch concurrent Product create and Category deactivation
    const createReq = fetch(`${baseUrl}/api/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        productCode: 'PROD-CONC-CREATE-' + Date.now(),
        productName: 'Concurrent Create Product',
        categoryId: cat.id,
        unit: Unit.PIECE,
        mrpRate: '20.00',
        originalRate: '10.00',
        normalRate: '15.00',
        retailRate: '14.00',
        functionRate: '13.00',
      }),
    });

    const deactReq = fetch(`${baseUrl}/api/categories/${cat.id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ active: false }),
    });

    const [createRes, deactRes] = await Promise.all([createReq, deactReq]);
    assert.strictEqual(deactRes.status, 200);

    // Deactivation must have succeeded
    const catInDb = await prisma.category.findUniqueOrThrow({ where: { id: cat.id } });
    assert.strictEqual(catInDb.active, false);

    // Create must either succeed (if it won lock before deactivation) or fail with 400 (if deactivation won lock)
    if (createRes.status === 201) {
      const createBody = await createRes.json();
      assert.strictEqual(createBody.success, true);
      assert.strictEqual(createBody.data.product.categoryId, cat.id);
    } else {
      assert.strictEqual(createRes.status, 400);
      const createBody = await createRes.json();
      assert.strictEqual(createBody.success, false);
      assert.match(createBody.message, /inactive/i);
    }

    // After deactivation is committed, no subsequent create may succeed
    const postDeactRes = await fetch(`${baseUrl}/api/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        productCode: 'PROD-POST-DEACT-' + Date.now(),
        productName: 'Post Deact Product',
        categoryId: cat.id,
        unit: Unit.PIECE,
        mrpRate: '20.00',
        originalRate: '10.00',
        normalRate: '15.00',
        retailRate: '14.00',
        functionRate: '13.00',
      }),
    });
    assert.strictEqual(postDeactRes.status, 400);
  });

  it('32. Concurrency: Product update vs Category deactivation serializes cleanly', async () => {
    // 1. Create a fresh active category and product in General category
    const cat = await prisma.category.create({
      data: {
        categoryName: 'Concurrent_Update_Cat_' + Date.now(),
        displayOrder: 101,
        active: true,
      },
    });

    const generalCat = await prisma.category.findUniqueOrThrow({ where: { categoryName: 'General' } });
    const prod = await prisma.product.create({
      data: {
        productCode: 'PROD-CONC-UPDATE-' + Date.now(),
        productName: 'Update Target Product',
        categoryId: generalCat.id,
        unit: Unit.KG,
        originalRate: '20.00',
        normalRate: '25.00',
        retailRate: '24.00',
        functionRate: '23.00',
        currentStock: '5.000',
        active: true,
      },
    });

    // 2. Launch concurrent Product update (reassign to new category) and Category deactivation
    const updateReq = fetch(`${baseUrl}/api/products/${prod.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        categoryId: cat.id,
      }),
    });

    const deactReq = fetch(`${baseUrl}/api/categories/${cat.id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ active: false }),
    });

    const [updateRes, deactRes] = await Promise.all([updateReq, deactReq]);
    assert.strictEqual(deactRes.status, 200);

    const catInDb = await prisma.category.findUniqueOrThrow({ where: { id: cat.id } });
    assert.strictEqual(catInDb.active, false);

    if (updateRes.status === 200) {
      const updateBody = await updateRes.json();
      assert.strictEqual(updateBody.success, true);
      assert.strictEqual(updateBody.data.product.categoryId, cat.id);
    } else {
      assert.strictEqual(updateRes.status, 400);
      const updateBody = await updateRes.json();
      assert.strictEqual(updateBody.success, false);
      assert.match(updateBody.message, /inactive/i);
    }

    // After deactivation is committed, no subsequent update to this category may succeed
    const postDeactUpdateRes = await fetch(`${baseUrl}/api/products/${prod.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        categoryId: cat.id,
      }),
    });
    assert.strictEqual(postDeactUpdateRes.status, 400);
  });

  // ==========================================
  // MALFORMED CATEGORY FILTER TESTS (33 - 34)
  // ==========================================

  it('33. Malformed categoryId in GET /api/products returns HTTP 400 and never 500', async () => {
    const invalidValues = ['abc', '0', '-1', '1.5', 'true'];

    for (const val of invalidValues) {
      const res = await fetch(`${baseUrl}/api/products?categoryId=${val}`, {
        headers: { Authorization: `Bearer ${salesmanToken}` },
      });
      assert.strictEqual(res.status, 400, `Expected 400 for categoryId=${val}`);
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.message, 'Validation failed');
    }

    // Repeated query param: ?categoryId=1&categoryId=2
    const resRepeated = await fetch(`${baseUrl}/api/products?categoryId=1&categoryId=2`, {
      headers: { Authorization: `Bearer ${salesmanToken}` },
    });
    assert.strictEqual(resRepeated.status, 400);
    const bodyRepeated = await resRepeated.json();
    assert.strictEqual(bodyRepeated.success, false);
  });

  it('34. Malformed categoryId in GET /api/products/search returns HTTP 400 and never 500', async () => {
    const invalidValues = ['abc', '0', '-1', '1.5'];

    for (const val of invalidValues) {
      const res = await fetch(`${baseUrl}/api/products/search?q=test&categoryId=${val}`, {
        headers: { Authorization: `Bearer ${salesmanToken}` },
      });
      assert.strictEqual(res.status, 400, `Expected 400 for search categoryId=${val}`);
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.message, 'Validation failed');
    }
  });
});



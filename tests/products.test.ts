import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import express from 'express';
import bcrypt from 'bcryptjs';
import authRoutes from '../src/modules/auth/auth.routes.js';
import productRoutes from '../src/modules/products/product.routes.js';
import { notFoundHandler } from '../src/core/middlewares/not-found.middleware.js';
import { errorHandler } from '../src/core/middlewares/error.middleware.js';
import { prisma } from '../src/core/database/prisma.js';
import { Role, Unit, StockTransactionType } from '../src/generated/prisma/enums.js';
import { formatQuantity } from '../src/modules/products/product.types.js';

describe('Product and Stock Foundation Integration Tests', () => {
  let server: Server;
  let baseUrl: string;
  let adminToken: string;
  let salesmanToken: string;

  const adminUser = {
    username: 'prod_test_admin',
    password: 'AdminPassword123!',
    role: Role.ADMIN,
  };

  const salesmanUser = {
    username: 'prod_test_salesman',
    password: 'SalesmanPassword123!',
    role: Role.SALESMAN,
  };

  before(async () => {
    const testApp = express();
    testApp.use(express.json());

    testApp.use('/api/auth', authRoutes);
    testApp.use('/api/products', productRoutes);

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

    // Cleanup users & existing test products
    await prisma.stockTransaction.deleteMany({});
    await prisma.product.deleteMany({});
    await prisma.user.deleteMany({
      where: {
        username: { in: [adminUser.username, salesmanUser.username] },
      },
    });

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
  });

  after(async () => {
    await prisma.stockTransaction.deleteMany({});
    await prisma.product.deleteMany({});
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

  let createdProductId: number;

  it('1. ADMIN creates product successfully', async () => {
    const res = await fetch(`${baseUrl}/api/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        productCode: 'PROD-001',
        barcode: '8901234567890',
        productName: 'Ponni Rice',
        tamilName: 'பொன்னி அரிசி',
        unit: Unit.KG,
        originalRate: '52.50',
        normalRate: '60.00',
        retailRate: '58.00',
        functionRate: '55.00',
        openingStock: '25.500',
      }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 201);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.product.productCode, 'PROD-001');
    assert.strictEqual(body.data.product.barcode, '8901234567890');
    assert.strictEqual(body.data.product.productName, 'Ponni Rice');
    assert.strictEqual(body.data.product.tamilName, 'பொன்னி அரிசி');
    assert.strictEqual(body.data.product.unit, Unit.KG);
    assert.strictEqual(body.data.product.active, true);
    createdProductId = body.data.product.id;
  });

  it('2. SALESMAN cannot create product (403 Forbidden)', async () => {
    const res = await fetch(`${baseUrl}/api/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        productCode: 'PROD-002',
        productName: 'Sugar',
        unit: Unit.KG,
        originalRate: '40.00',
        normalRate: '45.00',
        retailRate: '44.00',
        functionRate: '42.00',
      }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 403);
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.message, 'Access forbidden: insufficient role permissions');
  });

  it('3. all 4 rates are stored and returned correctly without ordering restrictions', async () => {
    const res = await fetch(`${baseUrl}/api/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        productCode: 'PROD-RATES',
        productName: 'Special Ghee',
        unit: Unit.LITRE,
        originalRate: '600.00',
        normalRate: '650.50',
        retailRate: '620.25',
        functionRate: '700.00',
      }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 201);
    assert.strictEqual(body.data.product.originalRate, '600.00');
    assert.strictEqual(body.data.product.normalRate, '650.50');
    assert.strictEqual(body.data.product.retailRate, '620.25');
    assert.strictEqual(body.data.product.functionRate, '700.00');
  });

  it('4. fractional opening stock is supported (e.g. 2.500)', async () => {
    const res = await fetch(`${baseUrl}/api/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        productCode: 'PROD-FRAC',
        productName: 'Cardamom',
        unit: Unit.KG,
        originalRate: '2000.00',
        normalRate: '2500.00',
        retailRate: '2400.00',
        functionRate: '2300.00',
        openingStock: '2.500',
      }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 201);
    assert.strictEqual(body.data.product.currentStock, '2.500');
  });

  it('5. OPENING_STOCK ledger entry is created atomically', async () => {
    const tx = await prisma.stockTransaction.findFirst({
      where: {
        product: { productCode: 'PROD-001' },
        type: StockTransactionType.OPENING_STOCK,
      },
    });

    assert.ok(tx);
    assert.strictEqual(tx.type, StockTransactionType.OPENING_STOCK);
    assert.strictEqual(formatQuantity(tx.quantity), '25.500');
    assert.strictEqual(formatQuantity(tx.previousStock), '0.000');
    assert.strictEqual(formatQuantity(tx.newStock), '25.500');
  });

  it('6. duplicate productCode is rejected with 409 Conflict', async () => {
    const res = await fetch(`${baseUrl}/api/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        productCode: 'PROD-001',
        productName: 'Duplicate Rice',
        unit: Unit.KG,
        originalRate: '50.00',
        normalRate: '60.00',
        retailRate: '58.00',
        functionRate: '55.00',
      }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 409);
    assert.strictEqual(body.success, false);
  });

  it('7. duplicate barcode is rejected with 409 Conflict', async () => {
    const res = await fetch(`${baseUrl}/api/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        productCode: 'PROD-NEW-UNIQUE',
        barcode: '8901234567890', // same as PROD-001
        productName: 'Another Item',
        unit: Unit.PACKET,
        originalRate: '10.00',
        normalRate: '15.00',
        retailRate: '14.00',
        functionRate: '13.00',
      }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 409);
    assert.strictEqual(body.success, false);
  });

  it('8. search works across productCode, productName, tamilName, and barcode', async () => {
    // Search by productCode
    const resCode = await fetch(`${baseUrl}/api/products/search?q=PROD-001`, {
      headers: { Authorization: `Bearer ${salesmanToken}` },
    });
    const bodyCode = await resCode.json();
    assert.strictEqual(resCode.status, 200);
    assert.ok(bodyCode.data.products.some((p: any) => p.productCode === 'PROD-001'));

    // Search by productName
    const resName = await fetch(`${baseUrl}/api/products/search?q=Ponni`, {
      headers: { Authorization: `Bearer ${salesmanToken}` },
    });
    const bodyName = await resName.json();
    assert.strictEqual(resName.status, 200);
    assert.ok(bodyName.data.products.some((p: any) => p.productCode === 'PROD-001'));

    // Search by tamilName
    const resTamil = await fetch(`${baseUrl}/api/products/search?q=பொன்னி`, {
      headers: { Authorization: `Bearer ${salesmanToken}` },
    });
    const bodyTamil = await resTamil.json();
    assert.strictEqual(resTamil.status, 200);
    assert.ok(bodyTamil.data.products.some((p: any) => p.productCode === 'PROD-001'));
  });

  it('9. barcode lookup works', async () => {
    const res = await fetch(`${baseUrl}/api/products/barcode/8901234567890`, {
      headers: { Authorization: `Bearer ${salesmanToken}` },
    });

    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.data.product.productCode, 'PROD-001');
    assert.strictEqual(body.data.product.barcode, '8901234567890');
  });

  it('10. ADMIN updates rates successfully', async () => {
    const res = await fetch(`${baseUrl}/api/products/${createdProductId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        normalRate: '65.00',
        retailRate: '62.00',
      }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.data.product.normalRate, '65.00');
    assert.strictEqual(body.data.product.retailRate, '62.00');
  });

  it('11. SALESMAN cannot update product (403 Forbidden)', async () => {
    const res = await fetch(`${baseUrl}/api/products/${createdProductId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        normalRate: '70.00',
      }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 403);
    assert.strictEqual(body.success, false);
  });

  it('12. product update explicitly rejects currentStock with 400 Bad Request', async () => {
    const res = await fetch(`${baseUrl}/api/products/${createdProductId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        productName: 'Ponni Rice Premium',
        currentStock: '99999.000', // attempt to modify stock via update endpoint
      }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 400);
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.message, 'Validation failed');
    assert.ok(body.details.some((d: any) => d.field === 'currentStock'));

    // Stock must remain unchanged at 25.500
    const dbProduct = await prisma.product.findUnique({ where: { id: createdProductId } });
    assert.strictEqual(formatQuantity(dbProduct?.currentStock), '25.500');
  });

  it('13. SALESMAN cannot perform stock-in (403 Forbidden)', async () => {
    const res = await fetch(`${baseUrl}/api/products/${createdProductId}/stock-in`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        quantity: '5.000',
      }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 403);
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.message, 'Access forbidden: insufficient role permissions');
  });

  it('14. SALESMAN cannot perform stock-adjustment (403 Forbidden)', async () => {
    const res = await fetch(`${baseUrl}/api/products/${createdProductId}/stock-adjustment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        type: StockTransactionType.ADJUSTMENT_IN,
        quantity: '5.000',
      }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 403);
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.message, 'Access forbidden: insufficient role permissions');
  });

  it('15. STOCK_IN updates stock and creates ledger entry', async () => {
    const res = await fetch(`${baseUrl}/api/products/${createdProductId}/stock-in`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        quantity: '10.500',
        note: 'New batch received',
      }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.success, true);
    // Previous was 25.500, + 10.500 = 36.000
    assert.strictEqual(body.data.product.currentStock, '36.000');
    assert.strictEqual(body.data.transaction.type, StockTransactionType.STOCK_IN);
    assert.strictEqual(body.data.transaction.quantity, '10.500');
    assert.strictEqual(body.data.transaction.previousStock, '25.500');
    assert.strictEqual(body.data.transaction.newStock, '36.000');
    assert.strictEqual(body.data.transaction.note, 'New batch received');
  });

  it('16. ADJUSTMENT_IN works correctly', async () => {
    const res = await fetch(`${baseUrl}/api/products/${createdProductId}/stock-adjustment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        type: StockTransactionType.ADJUSTMENT_IN,
        quantity: '4.000',
        note: 'Physical audit correction',
      }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 200);
    // Previous 36.000 + 4.000 = 40.000
    assert.strictEqual(body.data.product.currentStock, '40.000');
    assert.strictEqual(body.data.transaction.type, StockTransactionType.ADJUSTMENT_IN);
    assert.strictEqual(body.data.transaction.newStock, '40.000');
  });

  it('17. ADJUSTMENT_OUT works correctly', async () => {
    const res = await fetch(`${baseUrl}/api/products/${createdProductId}/stock-adjustment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        type: StockTransactionType.ADJUSTMENT_OUT,
        quantity: '5.250',
        note: 'Damaged packet written off',
      }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 200);
    // Previous 40.000 - 5.250 = 34.750
    assert.strictEqual(body.data.product.currentStock, '34.750');
    assert.strictEqual(body.data.transaction.type, StockTransactionType.ADJUSTMENT_OUT);
    assert.strictEqual(body.data.transaction.previousStock, '40.000');
    assert.strictEqual(body.data.transaction.newStock, '34.750');
  });

  it('18. ADJUSTMENT_OUT cannot make stock negative (400 Bad Request)', async () => {
    const res = await fetch(`${baseUrl}/api/products/${createdProductId}/stock-adjustment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        type: StockTransactionType.ADJUSTMENT_OUT,
        quantity: '50.000', // Current is 34.750
        note: 'Excess reduction',
      }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 400);
    assert.strictEqual(body.success, false);
    assert.match(body.message, /Insufficient stock/);

    // Verify stock in database remains untouched
    const product = await prisma.product.findUnique({ where: { id: createdProductId } });
    assert.strictEqual(formatQuantity(product?.currentStock), '34.750');
  });

  it('19. failed stock operation does not partially update data (transaction rollback)', async () => {
    const txCountBefore = await prisma.stockTransaction.count({ where: { productId: createdProductId } });

    await fetch(`${baseUrl}/api/products/${createdProductId}/stock-adjustment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        type: StockTransactionType.ADJUSTMENT_OUT,
        quantity: '100.000',
      }),
    });

    const txCountAfter = await prisma.stockTransaction.count({ where: { productId: createdProductId } });
    assert.strictEqual(txCountAfter, txCountBefore, 'No orphan ledger entry should be created on failure');
  });

  it('20. inactive product cannot have stock modified', async () => {
    const inactiveProd = await prisma.product.create({
      data: {
        productCode: 'PROD-INACTIVE',
        productName: 'Discontinued Brand',
        unit: Unit.PIECE,
        originalRate: '10.00',
        normalRate: '15.00',
        retailRate: '14.00',
        functionRate: '13.00',
        currentStock: '5.000',
        active: false,
      },
    });

    const res = await fetch(`${baseUrl}/api/products/${inactiveProd.id}/stock-in`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        quantity: '10.000',
      }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 400);
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.message, 'Cannot modify stock for inactive product');
  });

  it('21. fractional quantities are preserved accurately across calculations', async () => {
    const prod = await prisma.product.create({
      data: {
        productCode: 'PROD-PRECISE',
        productName: 'Gold Dust Spice',
        unit: Unit.GRAM,
        originalRate: '100.00',
        normalRate: '150.00',
        retailRate: '140.00',
        functionRate: '130.00',
        currentStock: '0.125',
        active: true,
      },
    });

    const res = await fetch(`${baseUrl}/api/products/${prod.id}/stock-in`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        quantity: '0.375',
      }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 200);
    // 0.125 + 0.375 = 0.500
    assert.strictEqual(body.data.product.currentStock, '0.500');
  });

  it('22. concurrent stock updates do not lose updates (row locking stress test)', async () => {
    const concurrentProd = await prisma.product.create({
      data: {
        productCode: 'PROD-CONCURRENT',
        productName: 'High Concurrency Oil',
        unit: Unit.LITRE,
        originalRate: '120.00',
        normalRate: '140.00',
        retailRate: '135.00',
        functionRate: '130.00',
        currentStock: '0.000',
        active: true,
      },
    });

    // Fire 10 parallel stock-in requests of quantity 1.000 each
    const parallelRequests = Array.from({ length: 10 }).map(() =>
      fetch(`${baseUrl}/api/products/${concurrentProd.id}/stock-in`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          quantity: '1.000',
          note: 'Concurrent test batch',
        }),
      })
    );

    const responses = await Promise.all(parallelRequests);
    for (const r of responses) {
      assert.strictEqual(r.status, 200);
    }

    // Verify final stock is exactly 10.000 in DB
    const finalProduct = await prisma.product.findUnique({ where: { id: concurrentProd.id } });
    assert.strictEqual(formatQuantity(finalProduct?.currentStock), '10.000');

    // Verify 10 stock transactions were created
    const txCount = await prisma.stockTransaction.count({ where: { productId: concurrentProd.id } });
    assert.strictEqual(txCount, 10);
  });

  it('23. concurrent duplicate productCode creation produces exactly one 201 and one 409 conflict', async () => {
    const productPayload = {
      productCode: 'PROD-CONCURRENT-DUP-CODE',
      productName: 'Concurrent Code Item',
      unit: Unit.PACKET,
      originalRate: '10.00',
      normalRate: '15.00',
      retailRate: '14.00',
      functionRate: '13.00',
    };

    const req1 = fetch(`${baseUrl}/api/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify(productPayload),
    });

    const req2 = fetch(`${baseUrl}/api/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify(productPayload),
    });

    const [res1, res2] = await Promise.all([req1, req2]);
    const statuses = [res1.status, res2.status].sort();

    // Exactly one should succeed with 201, exactly one should conflict with 409, zero with 500
    assert.deepStrictEqual(statuses, [201, 409]);

    const productsInDb = await prisma.product.findMany({
      where: { productCode: 'PROD-CONCURRENT-DUP-CODE' },
    });
    assert.strictEqual(productsInDb.length, 1);
  });

  it('24. concurrent duplicate barcode creation produces exactly one 201 and one 409 conflict', async () => {
    const req1 = fetch(`${baseUrl}/api/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        productCode: 'PROD-RACE-BARCODE-1',
        barcode: '8909999888877',
        productName: 'Barcode Item 1',
        unit: Unit.PACKET,
        originalRate: '20.00',
        normalRate: '25.00',
        retailRate: '24.00',
        functionRate: '22.00',
      }),
    });

    const req2 = fetch(`${baseUrl}/api/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        productCode: 'PROD-RACE-BARCODE-2',
        barcode: '8909999888877',
        productName: 'Barcode Item 2',
        unit: Unit.PACKET,
        originalRate: '20.00',
        normalRate: '25.00',
        retailRate: '24.00',
        functionRate: '22.00',
      }),
    });

    const [res1, res2] = await Promise.all([req1, req2]);
    const statuses = [res1.status, res2.status].sort();

    // Exactly one should succeed with 201, exactly one should conflict with 409, zero with 500
    assert.deepStrictEqual(statuses, [201, 409]);

    const productsInDb = await prisma.product.findMany({
      where: { barcode: '8909999888877' },
    });
    assert.strictEqual(productsInDb.length, 1);
  });
});

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
import {
  Role,
  Unit,
  RateType,
  PaymentType,
  BillStatus,
  StockTransactionType,
} from '../src/generated/prisma/enums.js';
import { formatQuantity, formatRate, getBillDatePrefix } from '../src/modules/billing/billing.types.js';
import { billingService } from '../src/modules/billing/billing.service.js';

describe('Billing Module & Automatic Stock Deduction Integration Tests', () => {
  let server: Server;
  let baseUrl: string;
  let adminToken: string;
  let salesmanToken: string;
  let defaultCategoryId: number;

  const adminUser = {
    username: 'bill_test_admin',
    password: 'AdminPassword123!',
    role: Role.ADMIN,
  };

  const salesmanUser = {
    username: 'bill_test_salesman',
    password: 'SalesmanPassword123!',
    role: Role.SALESMAN,
  };

  before(async () => {
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
    await prisma.billSequence.deleteMany({});
    await prisma.product.deleteMany({});
    await prisma.user.deleteMany({
      where: {
        username: { in: [adminUser.username, salesmanUser.username] },
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

  let prodRiceId: number;
  let prodDalId: number;
  let prodOilId: number;
  let prodInactiveId: number;

  it('Setup: Create base products for billing tests', async () => {
    const rice = await prisma.product.create({
      data: {
        productCode: 'BILL-RICE-01',
        productName: 'Sona Masoori Rice',
        categoryId: defaultCategoryId,
        unit: Unit.KG,
        originalRate: '45.00',
        normalRate: '60.00',
        retailRate: '58.00',
        functionRate: '55.00',
        currentStock: '50.000',
        active: true,
      },
    });
    prodRiceId = rice.id;

    const dal = await prisma.product.create({
      data: {
        productCode: 'BILL-DAL-01',
        productName: 'Toor Dal',
        categoryId: defaultCategoryId,
        unit: Unit.KG,
        originalRate: '120.00',
        normalRate: '150.00',
        retailRate: '145.00',
        functionRate: '140.00',
        currentStock: '20.000',
        active: true,
      },
    });
    prodDalId = dal.id;

    const oil = await prisma.product.create({
      data: {
        productCode: 'BILL-OIL-01',
        productName: 'Gingelly Oil',
        categoryId: defaultCategoryId,
        unit: Unit.LITRE,
        originalRate: '200.00',
        normalRate: '240.00',
        retailRate: '235.00',
        functionRate: '225.00',
        currentStock: '10.000',
        active: true,
      },
    });
    prodOilId = oil.id;

    const inactive = await prisma.product.create({
      data: {
        productCode: 'BILL-INACTIVE-01',
        productName: 'Discontinued Item',
        categoryId: defaultCategoryId,
        unit: Unit.PACKET,
        originalRate: '10.00',
        normalRate: '15.00',
        retailRate: '14.00',
        functionRate: '13.00',
        currentStock: '10.000',
        active: false,
      },
    });
    prodInactiveId = inactive.id;
  });

  it('1. ADMIN creates NORMAL bill', async () => {
    const res = await fetch(`${baseUrl}/api/bills`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        rateType: RateType.NORMAL,
        paymentType: PaymentType.CASH,
        items: [
          {
            productId: prodRiceId,
            quantity: '2.000',
          },
        ],
      }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 201);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.bill.rateType, RateType.NORMAL);
    assert.strictEqual(body.data.bill.paymentType, PaymentType.CASH);
    assert.strictEqual(body.data.bill.status, BillStatus.COMPLETED);
    assert.strictEqual(body.data.bill.subtotal, '120.00'); // 2 * 60.00
    assert.strictEqual(body.data.bill.totalAmount, '120.00');
    assert.strictEqual(body.data.bill.items.length, 1);
    assert.strictEqual(body.data.bill.items[0].productCode, 'BILL-RICE-01');
    assert.strictEqual(body.data.bill.items[0].rate, '60.00');
    assert.strictEqual(body.data.bill.items[0].amount, '120.00');
  });

  it('2. SALESMAN creates bill', async () => {
    const res = await fetch(`${baseUrl}/api/bills`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        rateType: RateType.NORMAL,
        paymentType: PaymentType.UPI,
        items: [
          {
            productId: prodRiceId,
            quantity: '1.000',
          },
        ],
      }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 201);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.bill.paymentType, PaymentType.UPI);
    assert.strictEqual(body.data.bill.creator.role, Role.SALESMAN);
  });

  it('3. NORMAL uses normalRate', async () => {
    const res = await fetch(`${baseUrl}/api/bills`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        rateType: RateType.NORMAL,
        paymentType: PaymentType.CASH,
        items: [
          {
            productId: prodDalId,
            quantity: '1.000',
          },
        ],
      }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 201);
    assert.strictEqual(body.data.bill.items[0].rate, '150.00');
    assert.strictEqual(body.data.bill.items[0].amount, '150.00');
  });

  it('4. RETAIL uses retailRate', async () => {
    const res = await fetch(`${baseUrl}/api/bills`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        rateType: RateType.RETAIL,
        paymentType: PaymentType.CASH,
        items: [
          {
            productId: prodDalId,
            quantity: '1.000',
          },
        ],
      }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 201);
    assert.strictEqual(body.data.bill.items[0].rate, '145.00');
    assert.strictEqual(body.data.bill.items[0].amount, '145.00');
    assert.strictEqual(body.data.bill.totalAmount, '145.00');
  });

  it('5. FUNCTION uses functionRate', async () => {
    const res = await fetch(`${baseUrl}/api/bills`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        rateType: RateType.FUNCTION,
        paymentType: PaymentType.UPI,
        items: [
          {
            productId: prodDalId,
            quantity: '1.000',
          },
        ],
      }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 201);
    assert.strictEqual(body.data.bill.items[0].rate, '140.00');
    assert.strictEqual(body.data.bill.items[0].amount, '140.00');
    assert.strictEqual(body.data.bill.totalAmount, '140.00');
  });

  it('6. originalRate is never used as customer sale rate', async () => {
    // prodDal originalRate is 120.00. Test NORMAL (150), RETAIL (145), FUNCTION (140) are all not 120.00
    const bills = await prisma.billItem.findMany({
      where: { productId: prodDalId },
    });
    for (const item of bills) {
      assert.notStrictEqual(formatRate(item.rate), '120.00');
    }
  });

  it('7. fractional quantity billing works', async () => {
    const res = await fetch(`${baseUrl}/api/bills`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        rateType: RateType.NORMAL,
        paymentType: PaymentType.CASH,
        items: [
          {
            productId: prodRiceId,
            quantity: '2.500',
          },
        ],
      }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 201);
    assert.strictEqual(body.data.bill.items[0].quantity, '2.500');
    // 2.500 * 60.00 = 150.00
    assert.strictEqual(body.data.bill.items[0].amount, '150.00');
    assert.strictEqual(body.data.bill.totalAmount, '150.00');
  });

  it('8. item amount calculation is exact', async () => {
    // 1.375 KG of Rice at 60.00 = 82.50
    const res = await fetch(`${baseUrl}/api/bills`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        rateType: RateType.NORMAL,
        paymentType: PaymentType.CASH,
        items: [
          {
            productId: prodRiceId,
            quantity: '1.375',
          },
        ],
      }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 201);
    assert.strictEqual(body.data.bill.items[0].quantity, '1.375');
    assert.strictEqual(body.data.bill.items[0].rate, '60.00');
    assert.strictEqual(body.data.bill.items[0].amount, '82.50');
  });

  it('9. total calculation is exact for multiple items', async () => {
    // Rice: 2.000 * 60.00 = 120.00
    // Dal: 1.500 * 150.00 = 225.00
    // Oil: 0.500 * 240.00 = 120.00
    // Total = 465.00
    const res = await fetch(`${baseUrl}/api/bills`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        rateType: RateType.NORMAL,
        paymentType: PaymentType.CASH,
        items: [
          { productId: prodRiceId, quantity: '2.000' },
          { productId: prodDalId, quantity: '1.500' },
          { productId: prodOilId, quantity: '0.500' },
        ],
      }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 201);
    assert.strictEqual(body.data.bill.items.length, 3);
    assert.strictEqual(body.data.bill.subtotal, '465.00');
    assert.strictEqual(body.data.bill.totalAmount, '465.00');
  });

  it('10. successful bill deducts stock', async () => {
    const prodBefore = await prisma.product.findUniqueOrThrow({ where: { id: prodOilId } });
    const stockBefore = Number(prodBefore.currentStock);

    const res = await fetch(`${baseUrl}/api/bills`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        rateType: RateType.NORMAL,
        paymentType: PaymentType.CASH,
        items: [
          { productId: prodOilId, quantity: '1.250' },
        ],
      }),
    });

    assert.strictEqual(res.status, 201);

    const prodAfter = await prisma.product.findUniqueOrThrow({ where: { id: prodOilId } });
    const expectedStock = (stockBefore - 1.25).toFixed(3);
    assert.strictEqual(formatQuantity(prodAfter.currentStock), expectedStock);
  });

  it('11. SALE ledger entry created', async () => {
    const latestBill = await prisma.bill.findFirst({
      orderBy: { id: 'desc' },
    });
    assert.ok(latestBill);

    const saleTx = await prisma.stockTransaction.findFirst({
      where: {
        billId: latestBill.id,
        type: StockTransactionType.SALE,
      },
    });

    assert.ok(saleTx);
    assert.strictEqual(saleTx.type, StockTransactionType.SALE);
    assert.strictEqual(saleTx.note, `Bill #${latestBill.billNumber}`);
  });

  it('12. correct previousStock/newStock stored', async () => {
    const prod = await prisma.product.findUniqueOrThrow({ where: { id: prodOilId } });
    const prevStockStr = formatQuantity(prod.currentStock);

    const res = await fetch(`${baseUrl}/api/bills`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        rateType: RateType.NORMAL,
        paymentType: PaymentType.CASH,
        items: [{ productId: prodOilId, quantity: '0.750' }],
      }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 201);
    const billId = body.data.bill.id;

    const tx = await prisma.stockTransaction.findFirst({
      where: { billId, productId: prodOilId },
    });

    assert.ok(tx);
    assert.strictEqual(formatQuantity(tx.quantity), '0.750');
    assert.strictEqual(formatQuantity(tx.previousStock), prevStockStr);
    const expectedNewStock = (Number(prevStockStr) - 0.75).toFixed(3);
    assert.strictEqual(formatQuantity(tx.newStock), expectedNewStock);
  });

  it('13. insufficient stock rejects whole bill', async () => {
    const res = await fetch(`${baseUrl}/api/bills`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        rateType: RateType.NORMAL,
        paymentType: PaymentType.CASH,
        items: [{ productId: prodOilId, quantity: '9999.000' }],
      }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 400);
    assert.strictEqual(body.success, false);
    assert.match(body.message, /Insufficient stock/);
  });

  it('14. failed multi-product bill rolls back all mutations', async () => {
    const riceBefore = await prisma.product.findUniqueOrThrow({ where: { id: prodRiceId } });
    const dalBefore = await prisma.product.findUniqueOrThrow({ where: { id: prodDalId } });
    const billCountBefore = await prisma.bill.count();
    const txCountBefore = await prisma.stockTransaction.count();

    // Item 1 (Rice) has enough stock, but Item 2 (Dal) requests 99999.000
    const res = await fetch(`${baseUrl}/api/bills`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        rateType: RateType.NORMAL,
        paymentType: PaymentType.CASH,
        items: [
          { productId: prodRiceId, quantity: '1.000' },
          { productId: prodDalId, quantity: '99999.000' },
        ],
      }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 400);
    assert.strictEqual(body.success, false);

    // Verify all mutations rolled back
    const riceAfter = await prisma.product.findUniqueOrThrow({ where: { id: prodRiceId } });
    const dalAfter = await prisma.product.findUniqueOrThrow({ where: { id: prodDalId } });
    const billCountAfter = await prisma.bill.count();
    const txCountAfter = await prisma.stockTransaction.count();

    assert.strictEqual(formatQuantity(riceAfter.currentStock), formatQuantity(riceBefore.currentStock));
    assert.strictEqual(formatQuantity(dalAfter.currentStock), formatQuantity(dalBefore.currentStock));
    assert.strictEqual(billCountAfter, billCountBefore);
    assert.strictEqual(txCountAfter, txCountBefore);
  });

  it('15. inactive product cannot be billed', async () => {
    const res = await fetch(`${baseUrl}/api/bills`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        rateType: RateType.NORMAL,
        paymentType: PaymentType.CASH,
        items: [{ productId: prodInactiveId, quantity: '1.000' }],
      }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 400);
    assert.strictEqual(body.success, false);
    assert.match(body.message, /inactive/);
  });

  it('16. invalid product cannot be billed', async () => {
    const res = await fetch(`${baseUrl}/api/bills`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        rateType: RateType.NORMAL,
        paymentType: PaymentType.CASH,
        items: [{ productId: 999999, quantity: '1.000' }],
      }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 404);
    assert.strictEqual(body.success, false);
    assert.match(body.message, /not found/);
  });

  it('17. zero quantity rejected', async () => {
    const res = await fetch(`${baseUrl}/api/bills`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        rateType: RateType.NORMAL,
        paymentType: PaymentType.CASH,
        items: [{ productId: prodRiceId, quantity: '0' }],
      }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 400);
    assert.strictEqual(body.success, false);
  });

  it('18. negative quantity rejected', async () => {
    const res = await fetch(`${baseUrl}/api/bills`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        rateType: RateType.NORMAL,
        paymentType: PaymentType.CASH,
        items: [{ productId: prodRiceId, quantity: '-2.5' }],
      }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 400);
    assert.strictEqual(body.success, false);
  });

  it('19. empty item list rejected', async () => {
    const res = await fetch(`${baseUrl}/api/bills`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        rateType: RateType.NORMAL,
        paymentType: PaymentType.CASH,
        items: [],
      }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 400);
    assert.strictEqual(body.success, false);
  });

  it('20. frontend-supplied rate/amount/total fields cannot manipulate pricing', async () => {
    const res = await fetch(`${baseUrl}/api/bills`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        rateType: RateType.NORMAL,
        paymentType: PaymentType.CASH,
        subtotal: '0.01', // malicious override
        totalAmount: '0.01', // malicious override
        items: [
          {
            productId: prodRiceId,
            quantity: '1.000',
            rate: '0.01', // malicious override
            amount: '0.01', // malicious override
          },
        ],
      }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 201);
    assert.strictEqual(body.data.bill.items[0].rate, '60.00'); // Genuine DB rate
    assert.strictEqual(body.data.bill.items[0].amount, '60.00');
    assert.strictEqual(body.data.bill.subtotal, '60.00');
    assert.strictEqual(body.data.bill.totalAmount, '60.00');
  });

  it('21. product price change after billing does not change historical BillItem rate', async () => {
    // 1. Create a bill with current rice rate (60.00)
    const billRes = await fetch(`${baseUrl}/api/bills`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        rateType: RateType.NORMAL,
        paymentType: PaymentType.CASH,
        items: [{ productId: prodRiceId, quantity: '1.000' }],
      }),
    });
    const billBody = await billRes.json();
    const billId = billBody.data.bill.id;
    assert.strictEqual(billBody.data.bill.items[0].rate, '60.00');

    // 2. Admin updates rice normalRate to 999.00
    await fetch(`${baseUrl}/api/products/${prodRiceId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        normalRate: '999.00',
      }),
    });

    // 3. Fetch historical bill - rate must STILL be 60.00
    const histRes = await fetch(`${baseUrl}/api/bills/${billId}`, {
      headers: { Authorization: `Bearer ${salesmanToken}` },
    });
    const histBody = await histRes.json();
    assert.strictEqual(histRes.status, 200);
    assert.strictEqual(histBody.data.bill.items[0].rate, '60.00');
    assert.strictEqual(histBody.data.bill.items[0].amount, '60.00');

    // Reset rice rate back to 60.00
    await fetch(`${baseUrl}/api/products/${prodRiceId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        normalRate: '60.00',
      }),
    });
  });

  it('22. duplicate products in one request follow the chosen safe rule (explicit rejection)', async () => {
    const res = await fetch(`${baseUrl}/api/bills`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        rateType: RateType.NORMAL,
        paymentType: PaymentType.CASH,
        items: [
          { productId: prodRiceId, quantity: '1.000' },
          { productId: prodRiceId, quantity: '2.000' }, // Duplicate product ID
        ],
      }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 400);
    assert.strictEqual(body.success, false);
    assert.match(body.message, /Validation failed/);
    assert.ok(body.details.some((d: any) => d.message.includes('Duplicate product ID')));
  });

  it('23. concurrent bills against insufficient combined stock cannot oversell', async () => {
    // Setup dedicated product with stock = 5.000
    const limitedProd = await prisma.product.create({
      data: {
        productCode: 'BILL-CONC-STOCK-TEST',
        productName: 'Limited Edition Saffron',
        categoryId: defaultCategoryId,
        unit: Unit.GRAM,
        originalRate: '300.00',
        normalRate: '400.00',
        retailRate: '380.00',
        functionRate: '350.00',
        currentStock: '5.000',
        active: true,
      },
    });

    const billCountBefore = await prisma.bill.count();
    const txCountBefore = await prisma.stockTransaction.count({ where: { productId: limitedProd.id } });

    // Request A wants 4.000
    const reqA = fetch(`${baseUrl}/api/bills`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        rateType: RateType.NORMAL,
        paymentType: PaymentType.CASH,
        items: [{ productId: limitedProd.id, quantity: '4.000' }],
      }),
    });

    // Request B wants 4.000
    const reqB = fetch(`${baseUrl}/api/bills`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        rateType: RateType.NORMAL,
        paymentType: PaymentType.UPI,
        items: [{ productId: limitedProd.id, quantity: '4.000' }],
      }),
    });

    const [resA, resB] = await Promise.all([reqA, reqB]);
    const statuses = [resA.status, resB.status].sort();

    // Exactly one must succeed (201), exactly one must fail (400)
    assert.deepStrictEqual(statuses, [201, 400]);

    // Final stock in DB must be exactly 5.000 - 4.000 = 1.000
    const finalProd = await prisma.product.findUniqueOrThrow({ where: { id: limitedProd.id } });
    assert.strictEqual(formatQuantity(finalProd.currentStock), '1.000');

    // Exactly one new bill created
    const billCountAfter = await prisma.bill.count();
    assert.strictEqual(billCountAfter, billCountBefore + 1);

    // Exactly one new SALE transaction created for this product
    const txCountAfter = await prisma.stockTransaction.count({ where: { productId: limitedProd.id } });
    assert.strictEqual(txCountAfter, txCountBefore + 1);
  });

  it('24. concurrent bill numbers remain unique', async () => {
    // Create a product with ample stock
    const ampleProd = await prisma.product.create({
      data: {
        productCode: 'BILL-CONC-NUM-TEST',
        productName: 'Abundant Salt',
        categoryId: defaultCategoryId,
        unit: Unit.PACKET,
        originalRate: '10.00',
        normalRate: '20.00',
        retailRate: '18.00',
        functionRate: '16.00',
        currentStock: '1000.000',
        active: true,
      },
    });

    // Fire 8 concurrent bill creation requests simultaneously
    const requests = Array.from({ length: 8 }).map((_, idx) =>
      fetch(`${baseUrl}/api/bills`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idx % 2 === 0 ? adminToken : salesmanToken}`,
        },
        body: JSON.stringify({
          rateType: RateType.NORMAL,
          paymentType: PaymentType.CASH,
          items: [{ productId: ampleProd.id, quantity: '1.000' }],
        }),
      })
    );

    const responses = await Promise.all(requests);
    const billNumbers: string[] = [];

    for (const r of responses) {
      assert.strictEqual(r.status, 201);
      const b = await r.json();
      billNumbers.push(b.data.bill.billNumber);
    }

    // Verify all 8 bill numbers are strictly unique
    assert.strictEqual(billNumbers.length, 8);
    const uniqueNumbers = new Set(billNumbers);
    assert.strictEqual(uniqueNumbers.size, 8, 'Every concurrent bill must receive a unique bill number');
  });

  it('25. bill detail returns stored item snapshots and creator metadata', async () => {
    const createRes = await fetch(`${baseUrl}/api/bills`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        rateType: RateType.FUNCTION,
        paymentType: PaymentType.UPI,
        items: [
          { productId: prodRiceId, quantity: '3.000' },
          { productId: prodDalId, quantity: '2.000' },
        ],
      }),
    });

    const createBody = await createRes.json();
    const createdId = createBody.data.bill.id;

    // Fetch by ID
    const getRes = await fetch(`${baseUrl}/api/bills/${createdId}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const getBody = await getRes.json();

    assert.strictEqual(getRes.status, 200);
    assert.strictEqual(getBody.success, true);
    assert.strictEqual(getBody.data.bill.id, createdId);
    assert.strictEqual(getBody.data.bill.creator.username, salesmanUser.username);
    assert.strictEqual(getBody.data.bill.creator.role, Role.SALESMAN);
    assert.strictEqual((getBody.data.bill.creator as any).passwordHash, undefined);
    assert.strictEqual(getBody.data.bill.items.length, 2);

    const riceItem = getBody.data.bill.items.find((i: any) => i.productId === prodRiceId);
    assert.ok(riceItem);
    assert.strictEqual(riceItem.productCode, 'BILL-RICE-01');
    assert.strictEqual(riceItem.productName, 'Sona Masoori Rice');
    assert.strictEqual(riceItem.unit, Unit.KG);
    assert.strictEqual(riceItem.quantity, '3.000');
    assert.strictEqual(riceItem.rateType, RateType.FUNCTION);
    assert.strictEqual(riceItem.rate, '55.00'); // Rice function rate
    assert.strictEqual(riceItem.amount, '165.00');
  });

  it('26. ADMIN and SALESMAN can read bill history with pagination', async () => {
    // Admin list bills
    const adminRes = await fetch(`${baseUrl}/api/bills?page=1&limit=5`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const adminBody = await adminRes.json();
    assert.strictEqual(adminRes.status, 200);
    assert.strictEqual(adminBody.success, true);
    assert.ok(adminBody.data.bills.length > 0);
    assert.strictEqual(adminBody.data.pagination.page, 1);
    assert.strictEqual(adminBody.data.pagination.limit, 5);
    assert.ok(adminBody.data.pagination.total > 0);

    // Verify salesman credentials are never exposed in bill list
    for (const b of adminBody.data.bills) {
      assert.ok(b.billNumber);
      assert.ok(b.totalAmount);
      assert.ok(b.status);
      if (b.creator) {
        assert.strictEqual(b.creator.passwordHash, undefined);
      }
    }

    // Salesman list bills
    const salesmanRes = await fetch(`${baseUrl}/api/bills?page=1&limit=5`, {
      headers: { Authorization: `Bearer ${salesmanToken}` },
    });
    const salesmanBody = await salesmanRes.json();
    assert.strictEqual(salesmanRes.status, 200);
    assert.strictEqual(salesmanBody.success, true);
    assert.ok(salesmanBody.data.bills.length > 0);
  });

  it('27. bill prefix is always strictly based on Asia/Kolkata (IST) calendar date', () => {
    // 18:29:59.999 UTC on Aug 25 is 23:59:59.999 IST on Aug 25
    const justBeforeMidnight = new Date('2026-08-25T18:29:59.999Z');
    assert.strictEqual(getBillDatePrefix(justBeforeMidnight), 'BILL-20260825');

    // 18:30:00.000 UTC on Aug 25 is 00:00:00.000 IST on Aug 26 (Midnight rollover in IST)
    const exactMidnight = new Date('2026-08-25T18:30:00.000Z');
    assert.strictEqual(getBillDatePrefix(exactMidnight), 'BILL-20260826');

    // 18:45:00.000 UTC on Aug 25 is 00:15:00.000 IST on Aug 26
    const fifteenPastMidnight = new Date('2026-08-25T18:45:00.000Z');
    assert.strictEqual(getBillDatePrefix(fifteenPastMidnight), 'BILL-20260826');

    // Year boundary: 18:29:59.999 UTC on Dec 31 is 23:59:59.999 IST on Dec 31
    const endOfYear = new Date('2026-12-31T18:29:59.999Z');
    assert.strictEqual(getBillDatePrefix(endOfYear), 'BILL-20261231');

    // Year boundary: 18:30:00.000 UTC on Dec 31 is 00:00:00.000 IST on Jan 1
    const newYearInIst = new Date('2026-12-31T18:30:00.000Z');
    assert.strictEqual(getBillDatePrefix(newYearInIst), 'BILL-20270101');
  });

  it('28. first-sequence-row race on empty BillSequence prefix is safe under concurrency', async () => {
    const testDate = new Date('2030-01-01T00:00:00.000Z');
    const testPrefix = 'BILL-20300101';

    // 1. Ensure no sequence row exists for the test prefix
    await prisma.billItem.deleteMany({ where: { bill: { billNumber: { startsWith: testPrefix } } } });
    await prisma.stockTransaction.deleteMany({ where: { note: { contains: testPrefix } } });
    await prisma.bill.deleteMany({ where: { billNumber: { startsWith: testPrefix } } });
    await prisma.billSequence.deleteMany({ where: { prefix: testPrefix } });

    const seqBefore = await prisma.billSequence.findUnique({ where: { prefix: testPrefix } });
    assert.strictEqual(seqBefore, null, 'Sequence row must NOT exist before concurrent requests start');

    const adminUserRecord = await prisma.user.findUniqueOrThrow({ where: { username: adminUser.username } });

    // 2. Issue 4 concurrent bill creation requests simultaneously against the empty sequence prefix
    const concurrentRequests = Array.from({ length: 4 }).map(() =>
      billingService.createBill(
        {
          rateType: RateType.NORMAL,
          paymentType: PaymentType.CASH,
          items: [{ productId: prodRiceId, quantity: '0.100' }],
        },
        adminUserRecord.id,
        testDate
      )
    );

    // 3. Await all concurrent operations
    const createdBills = await Promise.all(concurrentRequests);

    // 4. Prove no errors / 500 equivalent occurred and all 4 succeeded
    assert.strictEqual(createdBills.length, 4);

    // 5. Prove all bill numbers are strictly unique and contiguous
    const billNumbers = createdBills.map((b) => b.billNumber);
    const uniqueNumbers = new Set(billNumbers);
    assert.strictEqual(uniqueNumbers.size, 4, 'All generated bill numbers must be unique');

    const expectedNumbers = [
      `${testPrefix}-0001`,
      `${testPrefix}-0002`,
      `${testPrefix}-0003`,
      `${testPrefix}-0004`,
    ];
    assert.deepStrictEqual(billNumbers.sort(), expectedNumbers, 'Sequence numbers must be contiguous starting from 0001');

    // 6. Prove exactly one BillSequence row exists in DB with lastNumber = 4
    const seqAfter = await prisma.billSequence.findUnique({ where: { prefix: testPrefix } });
    assert.ok(seqAfter, 'BillSequence row must be created');
    assert.strictEqual(seqAfter.lastNumber, 4, 'BillSequence.lastNumber must reflect the total created bills');

    const allSeqsForPrefix = await prisma.billSequence.findMany({ where: { prefix: testPrefix } });
    assert.strictEqual(allSeqsForPrefix.length, 1, 'Exactly one sequence row must exist for the prefix');

    // Cleanup
    await prisma.billItem.deleteMany({ where: { bill: { billNumber: { startsWith: testPrefix } } } });
    await prisma.stockTransaction.deleteMany({ where: { note: { contains: testPrefix } } });
    await prisma.bill.deleteMany({ where: { billNumber: { startsWith: testPrefix } } });
    await prisma.billSequence.deleteMany({ where: { prefix: testPrefix } });
  });

  /* -------------------------------------------------------------------------- */
  /* PHASE 4: BILL CANCELLATION + AUTOMATIC STOCK RESTORATION TESTS             */
  /* -------------------------------------------------------------------------- */

  let testCancelProdId: number;
  let testCancelBillId: number;
  let adminUserId: number;

  it('Phase 4 Setup: Fetch admin user record and create dedicated product for cancellation tests', async () => {
    const userRec = await prisma.user.findUniqueOrThrow({ where: { username: adminUser.username } });
    adminUserId = userRec.id;

    const prod = await prisma.product.create({
      data: {
        productCode: 'CAN-PROD-01',
        productName: 'Turmeric Powder',
        categoryId: defaultCategoryId,
        unit: Unit.PACKET,
        originalRate: '20.00',
        normalRate: '35.00',
        retailRate: '32.00',
        functionRate: '30.00',
        currentStock: '20.000',
        active: true,
      },
    });
    testCancelProdId = prod.id;
  });

  it('P4 - 1, 4, 5, 6, 7. ADMIN cancels completed bill successfully, restores stock, sets audit fields', async () => {
    // 1. Create a bill selling 3.000 units (stock 20.000 -> 17.000)
    const billRes = await fetch(`${baseUrl}/api/bills`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        rateType: RateType.NORMAL,
        paymentType: PaymentType.CASH,
        items: [{ productId: testCancelProdId, quantity: '3.000' }],
      }),
    });
    const billData = await billRes.json();
    assert.strictEqual(billRes.status, 201);
    testCancelBillId = billData.data.bill.id;

    const prodAfterSale = await prisma.product.findUniqueOrThrow({ where: { id: testCancelProdId } });
    assert.strictEqual(formatQuantity(prodAfterSale.currentStock), '17.000');

    // 2. Admin cancels the bill
    const cancelRes = await fetch(`${baseUrl}/api/bills/${testCancelBillId}/cancel`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });
    const cancelData = await cancelRes.json();

    // 3. Verify HTTP 200 and serialized response
    assert.strictEqual(cancelRes.status, 200);
    assert.strictEqual(cancelData.success, true);
    assert.strictEqual(cancelData.message, 'Bill cancelled successfully');
    assert.strictEqual(cancelData.data.bill.id, testCancelBillId);
    assert.strictEqual(cancelData.data.bill.status, BillStatus.CANCELLED);
    assert.ok(cancelData.data.bill.cancelledAt, 'cancelledAt must be populated');
    assert.strictEqual(cancelData.data.bill.cancelledBy, adminUserId);
    assert.strictEqual(cancelData.data.bill.canceller.id, adminUserId);
    assert.strictEqual(cancelData.data.bill.canceller.username, adminUser.username);
    assert.strictEqual(cancelData.data.bill.canceller.role, Role.ADMIN);
    assert.strictEqual((cancelData.data.bill.canceller as any).passwordHash, undefined);

    // 4. Verify product stock restored to exact original quantity (17.000 + 3.000 = 20.000)
    const prodAfterCancel = await prisma.product.findUniqueOrThrow({ where: { id: testCancelProdId } });
    assert.strictEqual(formatQuantity(prodAfterCancel.currentStock), '20.000');
  });

  it('P4 - 2. SALESMAN cannot cancel bill (403 Forbidden)', async () => {
    // Create a new bill
    const billRes = await fetch(`${baseUrl}/api/bills`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        rateType: RateType.NORMAL,
        paymentType: PaymentType.CASH,
        items: [{ productId: testCancelProdId, quantity: '1.000' }],
      }),
    });
    const billData = await billRes.json();
    assert.strictEqual(billRes.status, 201);
    const billId = billData.data.bill.id;

    // Salesman attempts cancellation
    const cancelRes = await fetch(`${baseUrl}/api/bills/${billId}/cancel`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${salesmanToken}`,
      },
    });
    const cancelData = await cancelRes.json();
    assert.strictEqual(cancelRes.status, 403);
    assert.strictEqual(cancelData.success, false);
    assert.match(cancelData.message, /insufficient role permissions/i);

    // Verify bill status remains COMPLETED
    const billInDb = await prisma.bill.findUniqueOrThrow({ where: { id: billId } });
    assert.strictEqual(billInDb.status, BillStatus.COMPLETED);
    assert.strictEqual(billInDb.cancelledAt, null);
    assert.strictEqual(billInDb.cancelledBy, null);
  });

  it('P4 - 3. unauthenticated request cannot cancel bill (401 Unauthorized)', async () => {
    const cancelRes = await fetch(`${baseUrl}/api/bills/${testCancelBillId}/cancel`, {
      method: 'POST',
    });
    const cancelData = await cancelRes.json();
    assert.strictEqual(cancelRes.status, 401);
    assert.strictEqual(cancelData.success, false);
  });

  it('P4 - 8, 9, 10, 11. Fractional quantity cancellation restores exact stock & creates valid SALE_CANCEL ledger', async () => {
    const fracProd = await prisma.product.create({
      data: {
        productCode: 'CAN-FRAC-PROD-01',
        productName: 'Premium Cardamom',
        categoryId: defaultCategoryId,
        unit: Unit.KG,
        originalRate: '1500.00',
        normalRate: '2000.00',
        retailRate: '1900.00',
        functionRate: '1800.00',
        currentStock: '10.000',
        active: true,
      },
    });

    // Create bill with fractional quantity: 2.375 KG (stock: 10.000 -> 7.625)
    const billRes = await fetch(`${baseUrl}/api/bills`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        rateType: RateType.NORMAL,
        paymentType: PaymentType.CASH,
        items: [{ productId: fracProd.id, quantity: '2.375' }],
      }),
    });
    const billData = await billRes.json();
    const billId = billData.data.bill.id;
    const billNumber = billData.data.bill.billNumber;

    const prodMid = await prisma.product.findUniqueOrThrow({ where: { id: fracProd.id } });
    assert.strictEqual(formatQuantity(prodMid.currentStock), '7.625');

    // Cancel the fractional bill
    const cancelRes = await fetch(`${baseUrl}/api/bills/${billId}/cancel`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });
    assert.strictEqual(cancelRes.status, 200);

    // Stock restored to exactly 10.000
    const prodFinal = await prisma.product.findUniqueOrThrow({ where: { id: fracProd.id } });
    assert.strictEqual(formatQuantity(prodFinal.currentStock), '10.000');

    // Verify stock transactions: exactly 1 SALE and 1 SALE_CANCEL
    const txs = await prisma.stockTransaction.findMany({
      where: { billId },
      orderBy: { id: 'asc' },
    });
    assert.strictEqual(txs.length, 2);

    // 11. Original SALE ledger remains unchanged
    const saleTx = txs[0];
    assert.strictEqual(saleTx.type, StockTransactionType.SALE);
    assert.strictEqual(formatQuantity(saleTx.quantity), '2.375');
    assert.strictEqual(formatQuantity(saleTx.previousStock), '10.000');
    assert.strictEqual(formatQuantity(saleTx.newStock), '7.625');
    assert.strictEqual(saleTx.billId, billId);

    // 9 & 10. SALE_CANCEL ledger entry details
    const cancelTx = txs[1];
    assert.strictEqual(cancelTx.type, StockTransactionType.SALE_CANCEL);
    assert.strictEqual(formatQuantity(cancelTx.quantity), '2.375');
    assert.strictEqual(formatQuantity(cancelTx.previousStock), '7.625');
    assert.strictEqual(formatQuantity(cancelTx.newStock), '10.000');
    assert.strictEqual(cancelTx.createdBy, adminUserId);
    assert.strictEqual(cancelTx.billId, billId);
    assert.ok(cancelTx.note?.includes(billNumber));
  });

  it('P4 - 12, 13. BillItems snapshots and bill financial totals remain immutable after cancellation', async () => {
    // Create multi-item bill
    const billRes = await fetch(`${baseUrl}/api/bills`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        rateType: RateType.NORMAL,
        paymentType: PaymentType.UPI,
        items: [
          { productId: prodRiceId, quantity: '2.000' },
          { productId: prodDalId, quantity: '1.500' },
        ],
      }),
    });
    const billData = await billRes.json();
    const billId = billData.data.bill.id;
    const originalSubtotal = billData.data.bill.subtotal;
    const originalTotalAmount = billData.data.bill.totalAmount;
    const originalItems = billData.data.bill.items;

    // Cancel bill
    const cancelRes = await fetch(`${baseUrl}/api/bills/${billId}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const cancelData = await cancelRes.json();
    assert.strictEqual(cancelRes.status, 200);

    const cancelledBill = cancelData.data.bill;
    assert.strictEqual(cancelledBill.subtotal, originalSubtotal);
    assert.strictEqual(cancelledBill.totalAmount, originalTotalAmount);
    assert.strictEqual(cancelledBill.rateType, RateType.NORMAL);
    assert.strictEqual(cancelledBill.paymentType, PaymentType.UPI);
    assert.strictEqual(cancelledBill.items.length, 2);

    for (let i = 0; i < originalItems.length; i++) {
      const orig = originalItems[i];
      const canc = cancelledBill.items[i];
      assert.strictEqual(canc.productId, orig.productId);
      assert.strictEqual(canc.productCode, orig.productCode);
      assert.strictEqual(canc.productName, orig.productName);
      assert.strictEqual(canc.unit, orig.unit);
      assert.strictEqual(canc.quantity, orig.quantity);
      assert.strictEqual(canc.rateType, orig.rateType);
      assert.strictEqual(canc.rate, orig.rate);
      assert.strictEqual(canc.amount, orig.amount);
    }
  });

  it('P4 - 14. cancelling a non-existent bill returns 404', async () => {
    const res = await fetch(`${baseUrl}/api/bills/999999/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const data = await res.json();
    assert.strictEqual(res.status, 404);
    assert.strictEqual(data.success, false);
    assert.match(data.message, /not found/i);
  });

  it('P4 - 15, 16. cancelling an already CANCELLED bill returns controlled conflict (409) and does not restore stock again', async () => {
    const prod = await prisma.product.create({
      data: {
        productCode: 'CAN-SEQ-DOUBLE-01',
        productName: 'Cumin Seeds',
        categoryId: defaultCategoryId,
        unit: Unit.KG,
        originalRate: '200.00',
        normalRate: '260.00',
        retailRate: '250.00',
        functionRate: '240.00',
        currentStock: '10.000',
        active: true,
      },
    });

    const billRes = await fetch(`${baseUrl}/api/bills`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        rateType: RateType.NORMAL,
        paymentType: PaymentType.CASH,
        items: [{ productId: prod.id, quantity: '2.000' }],
      }),
    });
    const billData = await billRes.json();
    const billId = billData.data.bill.id;

    // First cancel (succeeds)
    const cancel1 = await fetch(`${baseUrl}/api/bills/${billId}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(cancel1.status, 200);

    const stockAfterFirstCancel = await prisma.product.findUniqueOrThrow({ where: { id: prod.id } });
    assert.strictEqual(formatQuantity(stockAfterFirstCancel.currentStock), '10.000');

    // Sequential second cancel (must fail with 409 Conflict)
    const cancel2 = await fetch(`${baseUrl}/api/bills/${billId}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const cancel2Data = await cancel2.json();
    assert.strictEqual(cancel2.status, 409);
    assert.strictEqual(cancel2Data.success, false);
    assert.match(cancel2Data.message, /already cancelled/i);

    // Stock must remain 10.000 (NOT 12.000!)
    const stockAfterSecondCancel = await prisma.product.findUniqueOrThrow({ where: { id: prod.id } });
    assert.strictEqual(formatQuantity(stockAfterSecondCancel.currentStock), '10.000');

    // Exactly one SALE_CANCEL transaction exists
    const cancelTxs = await prisma.stockTransaction.findMany({
      where: { billId, type: StockTransactionType.SALE_CANCEL },
    });
    assert.strictEqual(cancelTxs.length, 1);
  });

  it('P4 - 17. concurrent double cancellation: exactly one 200 and one 409, stock restored once', async () => {
    const prod = await prisma.product.create({
      data: {
        productCode: 'CAN-CONC-DOUBLE-01',
        productName: 'Fenugreek Seeds',
        categoryId: defaultCategoryId,
        unit: Unit.KG,
        originalRate: '80.00',
        normalRate: '110.00',
        retailRate: '105.00',
        functionRate: '100.00',
        currentStock: '10.000',
        active: true,
      },
    });

    const billRes = await fetch(`${baseUrl}/api/bills`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        rateType: RateType.NORMAL,
        paymentType: PaymentType.CASH,
        items: [{ productId: prod.id, quantity: '3.000' }],
      }),
    });
    const billData = await billRes.json();
    const billId = billData.data.bill.id;

    // Fire 2 concurrent cancellation requests simultaneously
    const reqA = fetch(`${baseUrl}/api/bills/${billId}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const reqB = fetch(`${baseUrl}/api/bills/${billId}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    const [resA, resB] = await Promise.all([reqA, reqB]);
    const statuses = [resA.status, resB.status].sort();

    // Exactly one 200 OK and one 409 Conflict
    assert.deepStrictEqual(statuses, [200, 409]);

    // Stock must be restored exactly once (10.000 - 3.000 + 3.000 = 10.000, NOT 13.000)
    const finalProd = await prisma.product.findUniqueOrThrow({ where: { id: prod.id } });
    assert.strictEqual(formatQuantity(finalProd.currentStock), '10.000');

    // Exactly one SALE_CANCEL ledger entry
    const cancelTxs = await prisma.stockTransaction.findMany({
      where: { billId, type: StockTransactionType.SALE_CANCEL },
    });
    assert.strictEqual(cancelTxs.length, 1);

    // Bill status is CANCELLED
    const billInDb = await prisma.bill.findUniqueOrThrow({ where: { id: billId } });
    assert.strictEqual(billInDb.status, BillStatus.CANCELLED);
  });

  it('P4 - 18. multi-product cancellation restores stock for every item atomically', async () => {
    const p1 = await prisma.product.create({
      data: {
        productCode: 'CAN-MULTI-01',
        productName: 'Multi Item 1',
        categoryId: defaultCategoryId,
        unit: Unit.KG,
        normalRate: '50.00',
        currentStock: '10.000',
        active: true,
      },
    });
    const p2 = await prisma.product.create({
      data: {
        productCode: 'CAN-MULTI-02',
        productName: 'Multi Item 2',
        categoryId: defaultCategoryId,
        unit: Unit.LITRE,
        normalRate: '120.00',
        currentStock: '15.000',
        active: true,
      },
    });
    const p3 = await prisma.product.create({
      data: {
        productCode: 'CAN-MULTI-03',
        productName: 'Multi Item 3',
        categoryId: defaultCategoryId,
        unit: Unit.PIECE,
        normalRate: '25.00',
        currentStock: '30.000',
        active: true,
      },
    });

    // Create bill with 3 items
    const billRes = await fetch(`${baseUrl}/api/bills`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        rateType: RateType.NORMAL,
        paymentType: PaymentType.CASH,
        items: [
          { productId: p1.id, quantity: '2.000' },
          { productId: p2.id, quantity: '3.000' },
          { productId: p3.id, quantity: '5.000' },
        ],
      }),
    });
    const billData = await billRes.json();
    const billId = billData.data.bill.id;

    // Verify stock deducted
    assert.strictEqual(formatQuantity((await prisma.product.findUniqueOrThrow({ where: { id: p1.id } })).currentStock), '8.000');
    assert.strictEqual(formatQuantity((await prisma.product.findUniqueOrThrow({ where: { id: p2.id } })).currentStock), '12.000');
    assert.strictEqual(formatQuantity((await prisma.product.findUniqueOrThrow({ where: { id: p3.id } })).currentStock), '25.000');

    // Cancel the multi-item bill
    const cancelRes = await fetch(`${baseUrl}/api/bills/${billId}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(cancelRes.status, 200);

    // Verify all 3 products restored
    assert.strictEqual(formatQuantity((await prisma.product.findUniqueOrThrow({ where: { id: p1.id } })).currentStock), '10.000');
    assert.strictEqual(formatQuantity((await prisma.product.findUniqueOrThrow({ where: { id: p2.id } })).currentStock), '15.000');
    assert.strictEqual(formatQuantity((await prisma.product.findUniqueOrThrow({ where: { id: p3.id } })).currentStock), '30.000');

    // Exactly 3 SALE_CANCEL ledger entries
    const cancelTxs = await prisma.stockTransaction.findMany({
      where: { billId, type: StockTransactionType.SALE_CANCEL },
    });
    assert.strictEqual(cancelTxs.length, 3);
  });

  it('P4 - 19. failed multi-product cancellation rolls back all changes atomically', async () => {
    // 1. Create a valid product
    const validProd = await prisma.product.create({
      data: {
        productCode: 'CAN-ROLLBACK-VALID',
        productName: 'Rollback Valid Product',
        categoryId: defaultCategoryId,
        unit: Unit.KG,
        normalRate: '50.00',
        currentStock: '8.000',
        active: true,
      },
    });

    // 2. Create a bill with two items: Item 1 is valid, Item 2 points to a non-existent product ID
    // We insert via raw SQL bypassing foreign key checks in a transaction to simulate mid-transaction failure
    const billNumber = 'BILL-ROLLBACK-TEST-0001';
    await prisma.$executeRaw`
      INSERT INTO bills (bill_number, rate_type, payment_type, subtotal, total_amount, status, created_by, receipt_store_name, created_at, updated_at)
      VALUES (${billNumber}, 'NORMAL', 'CASH', 100.00, 100.00, 'COMPLETED', ${adminUserId}, 'Malligai Billing', NOW(3), NOW(3))
    `;
    const [billRow] = await prisma.$queryRaw<Array<{ id: number }>>`
      SELECT id FROM bills WHERE bill_number = ${billNumber}
    `;
    const testRollbackBillId = billRow.id;

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET FOREIGN_KEY_CHECKS = 0`;
      await tx.$executeRaw`
        INSERT INTO bill_items (bill_id, product_id, product_code, product_name, unit, quantity, rate_type, rate, amount, created_at)
        VALUES (${testRollbackBillId}, ${validProd.id}, 'CAN-ROLLBACK-VALID', 'Rollback Valid Product', 'KG', 2.000, 'NORMAL', 50.00, 100.00, NOW(3)),
               (${testRollbackBillId}, 999998, 'CAN-NONEXISTENT', 'Missing Product', 'KG', 1.000, 'NORMAL', 50.00, 50.00, NOW(3))
      `;
      await tx.$executeRaw`SET FOREIGN_KEY_CHECKS = 1`;
    });

    // 3. Attempt cancellation - will fail on second item because product 999998 does not exist
    const cancelRes = await fetch(`${baseUrl}/api/bills/${testRollbackBillId}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(cancelRes.status, 404);

    // 4. Verify validProd stock was NOT modified (atomicity rollback!)
    const validProdAfter = await prisma.product.findUniqueOrThrow({ where: { id: validProd.id } });
    assert.strictEqual(formatQuantity(validProdAfter.currentStock), '8.000');

    // 5. Verify no SALE_CANCEL transactions exist
    const cancelTxs = await prisma.stockTransaction.findMany({
      where: { billId: testRollbackBillId, type: StockTransactionType.SALE_CANCEL },
    });
    assert.strictEqual(cancelTxs.length, 0);

    // 6. Verify bill status remained COMPLETED
    const billAfter = await prisma.bill.findUniqueOrThrow({ where: { id: testRollbackBillId } });
    assert.strictEqual(billAfter.status, BillStatus.COMPLETED);

    // Cleanup
    await prisma.$executeRaw`SET FOREIGN_KEY_CHECKS = 0`;
    await prisma.billItem.deleteMany({ where: { billId: testRollbackBillId } });
    await prisma.bill.delete({ where: { id: testRollbackBillId } });
    await prisma.$executeRaw`SET FOREIGN_KEY_CHECKS = 1`;
  });

  it('P4 - 20. product becoming inactive after sale does not prevent cancellation and restores stock', async () => {
    const prod = await prisma.product.create({
      data: {
        productCode: 'CAN-INACTIVE-RESTORE',
        productName: 'Seasonal Mango Pickle',
        categoryId: defaultCategoryId,
        unit: Unit.PACKET,
        originalRate: '40.00',
        normalRate: '60.00',
        retailRate: '55.00',
        functionRate: '50.00',
        currentStock: '10.000',
        active: true,
      },
    });

    // Create bill (stock 10.000 -> 6.000)
    const billRes = await fetch(`${baseUrl}/api/bills`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        rateType: RateType.NORMAL,
        paymentType: PaymentType.CASH,
        items: [{ productId: prod.id, quantity: '4.000' }],
      }),
    });
    const billData = await billRes.json();
    const billId = billData.data.bill.id;

    // Deactivate product
    await prisma.product.update({
      where: { id: prod.id },
      data: { active: false },
    });

    // Cancel bill on inactive product
    const cancelRes = await fetch(`${baseUrl}/api/bills/${billId}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(cancelRes.status, 200);

    // Stock must be restored to 10.000 while product remains inactive
    const prodAfter = await prisma.product.findUniqueOrThrow({ where: { id: prod.id } });
    assert.strictEqual(formatQuantity(prodAfter.currentStock), '10.000');
    assert.strictEqual(prodAfter.active, false);
  });

  it('P4 - 21. post-sale stock changes are preserved correctly (currentStock + quantity rule)', async () => {
    // 1. Initial Opening stock = 10.000
    const prod = await prisma.product.create({
      data: {
        productCode: 'CAN-POST-SALE-STOCK',
        productName: 'Asafoetida Compounded',
        categoryId: defaultCategoryId,
        unit: Unit.BOX,
        originalRate: '50.00',
        normalRate: '75.00',
        retailRate: '70.00',
        functionRate: '65.00',
        currentStock: '10.000',
        active: true,
      },
    });

    // 2. Bill sells 3.000 -> remaining stock = 7.000
    const billRes = await fetch(`${baseUrl}/api/bills`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        rateType: RateType.NORMAL,
        paymentType: PaymentType.CASH,
        items: [{ productId: prod.id, quantity: '3.000' }],
      }),
    });
    const billData = await billRes.json();
    const billId = billData.data.bill.id;

    const stockAfterSale = await prisma.product.findUniqueOrThrow({ where: { id: prod.id } });
    assert.strictEqual(formatQuantity(stockAfterSale.currentStock), '7.000');

    // 3. Admin performs stock-in +5.000 -> current stock = 12.000
    const stockInRes = await fetch(`${baseUrl}/api/products/${prod.id}/stock-in`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        quantity: '5.000',
        note: 'Supplier delivery batch 2',
      }),
    });
    assert.strictEqual(stockInRes.status, 200);

    const stockAfterStockIn = await prisma.product.findUniqueOrThrow({ where: { id: prod.id } });
    assert.strictEqual(formatQuantity(stockAfterStockIn.currentStock), '12.000');

    // 4. Cancel the bill
    const cancelRes = await fetch(`${baseUrl}/api/bills/${billId}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(cancelRes.status, 200);

    // 5. Final stock MUST equal 12.000 + 3.000 = 15.000 (NOT reset back to 10.000!)
    const stockFinal = await prisma.product.findUniqueOrThrow({ where: { id: prod.id } });
    assert.strictEqual(formatQuantity(stockFinal.currentStock), '15.000');

    // Verify SALE_CANCEL transaction recorded previousStock = 12.000 and newStock = 15.000
    const cancelTx = await prisma.stockTransaction.findFirstOrThrow({
      where: { billId, type: StockTransactionType.SALE_CANCEL },
    });
    assert.strictEqual(formatQuantity(cancelTx.previousStock), '12.000');
    assert.strictEqual(formatQuantity(cancelTx.newStock), '15.000');
  });

  it('P4 - 22. concurrent cancellation and sale on the same product do not corrupt stock', async () => {
    // Product stock = 10.000
    const prod = await prisma.product.create({
      data: {
        productCode: 'CAN-CONC-SALE-CANCEL',
        productName: 'Mustard Seeds',
        categoryId: defaultCategoryId,
        unit: Unit.KG,
        originalRate: '70.00',
        normalRate: '90.00',
        retailRate: '85.00',
        functionRate: '80.00',
        currentStock: '10.000',
        active: true,
      },
    });

    // Bill 1 sells 3.000 -> stock becomes 7.000
    const bill1Res = await fetch(`${baseUrl}/api/bills`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        rateType: RateType.NORMAL,
        paymentType: PaymentType.CASH,
        items: [{ productId: prod.id, quantity: '3.000' }],
      }),
    });
    const bill1Data = await bill1Res.json();
    const bill1Id = bill1Data.data.bill.id;

    // Simultaneously fire:
    // Request 1: Cancel Bill 1 (+3.000)
    // Request 2: Create Bill 2 selling 2.000 (-2.000)
    const cancelReq = fetch(`${baseUrl}/api/bills/${bill1Id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    const saleReq = fetch(`${baseUrl}/api/bills`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        rateType: RateType.NORMAL,
        paymentType: PaymentType.UPI,
        items: [{ productId: prod.id, quantity: '2.000' }],
      }),
    });

    const [cancelRes, saleRes] = await Promise.all([cancelReq, saleReq]);
    assert.strictEqual(cancelRes.status, 200);
    assert.strictEqual(saleRes.status, 201);

    // Final stock in DB must be exactly 7.000 + 3.000 - 2.000 = 8.000
    const finalProd = await prisma.product.findUniqueOrThrow({ where: { id: prod.id } });
    assert.strictEqual(formatQuantity(finalProd.currentStock), '8.000');
  });

  it('P4 - 23. bill detail returns CANCELLED status and cancellation audit fields without exposing passwordHash', async () => {
    const res = await fetch(`${baseUrl}/api/bills/${testCancelBillId}`, {
      headers: { Authorization: `Bearer ${salesmanToken}` },
    });
    const data = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.data.bill.id, testCancelBillId);
    assert.strictEqual(data.data.bill.status, BillStatus.CANCELLED);
    assert.ok(data.data.bill.cancelledAt);
    assert.strictEqual(data.data.bill.cancelledBy, adminUserId);
    assert.strictEqual(data.data.bill.canceller.id, adminUserId);
    assert.strictEqual(data.data.bill.canceller.username, adminUser.username);
    assert.strictEqual((data.data.bill.canceller as any).passwordHash, undefined);
    assert.strictEqual((data.data.bill.creator as any).passwordHash, undefined);
  });

  it('P4 - 24. list API continues returning cancelled bills with status filter and cancellation metadata', async () => {
    // Filter by CANCELLED
    const res = await fetch(`${baseUrl}/api/bills?status=CANCELLED`, {
      headers: { Authorization: `Bearer ${salesmanToken}` },
    });
    const data = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    assert.ok(data.data.bills.length > 0);

    for (const b of data.data.bills) {
      assert.strictEqual(b.status, BillStatus.CANCELLED);
      assert.ok(b.cancelledAt);
      assert.ok(b.cancelledBy);
      if (b.canceller) {
        assert.strictEqual(b.canceller.passwordHash, undefined);
      }
    }
  });
});


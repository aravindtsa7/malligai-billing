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
});


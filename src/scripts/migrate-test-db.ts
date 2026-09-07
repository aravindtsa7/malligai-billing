import { execSync } from 'node:child_process';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../generated/prisma/client.js';
import 'dotenv/config';

async function main() {
  const testDbUrl =
    process.env.DATABASE_URL_TEST ||
    process.env.DATABASE_URL?.replace(/\/([^/?]+)(\?.*)?$/, '/$1_test$2');

  if (!testDbUrl) {
    throw new Error('Neither DATABASE_URL_TEST nor DATABASE_URL is defined');
  }

  const url = new URL(testDbUrl);
  const dbName = url.pathname.replace(/^\/+/, '');

  if (!dbName.endsWith('_test') || dbName === 'malligai_billing') {
    throw new Error(
      `[SAFETY VIOLATION] Refusing to run test migrations against non-test database "${dbName}".`
    );
  }

  console.log(`[migrate:test] Ensuring test database "${dbName}" exists...`);
  const normalUrl = new URL(process.env.DATABASE_URL || 'mysql://root:kani_1234@localhost:3306/malligai_billing');
  const adminAdapter = new PrismaMariaDb({
    host: normalUrl.hostname,
    port: Number(normalUrl.port || 3306),
    user: decodeURIComponent(normalUrl.username),
    password: decodeURIComponent(normalUrl.password),
    database: 'malligai_billing',
    connectionLimit: 1,
  });
  const adminPrisma = new PrismaClient({ adapter: adminAdapter });
  try {
    await adminPrisma.$executeRawUnsafe(
      `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
    );
  } finally {
    await adminPrisma.$disconnect();
  }

  console.log(`[migrate:test] Deploying migrations to "${dbName}"...`);
  execSync('npx.cmd prisma migrate deploy', {
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL_TEST: testDbUrl,
    },
  });

  console.log(`[migrate:test] Successfully deployed migrations to "${dbName}".`);
}

main().catch((err) => {
  console.error('[migrate:test] Migration failed:', err.message);
  process.exit(1);
});


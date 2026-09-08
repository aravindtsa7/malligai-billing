import 'dotenv/config';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../../generated/prisma/client.js';

const isTest =
  process.env.NODE_ENV === 'test' ||
  process.env.npm_lifecycle_event === 'test';

if (isTest && process.env.NODE_ENV !== 'test') {
  process.env.NODE_ENV = 'test';
}

const databaseUrl = isTest
  ? (process.env.DATABASE_URL_TEST || process.env.DATABASE_URL?.replace(/\/([^/?]+)(\?.*)?$/, '/$1_test$2'))
  : process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(isTest ? 'DATABASE_URL_TEST (or DATABASE_URL) is not configured' : 'DATABASE_URL is not configured');
}

const url = new URL(databaseUrl);

const databaseName = url.pathname.replace(/^\/+/, '');

if (!databaseName) {
  throw new Error('Database name is missing from DATABASE_URL');
}

// HARD SAFETY GUARD: Automated tests must NEVER run against normal DB or any non-test DB
if (isTest || process.env.NODE_ENV === 'test') {
  if (databaseName === 'malligai_billing' || !databaseName.endsWith('_test')) {
    throw new Error(
      `[FATAL DATABASE SAFETY GUARD] Tests cannot run against database "${databaseName}". ` +
      `Resolved database name must end with "_test" and cannot be "malligai_billing". Aborting immediately.`
    );
  }
}

const adapter = new PrismaMariaDb({
  host: url.hostname,
  port: Number(url.port || 3306),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: databaseName,
  connectionLimit: 5,
});

export const prisma = new PrismaClient({
  adapter,
});
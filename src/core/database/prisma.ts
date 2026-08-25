import 'dotenv/config';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../../generated/prisma/client.js';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is not configured');
}

const url = new URL(databaseUrl);

const databaseName = url.pathname.replace(/^\/+/, '');

if (!databaseName) {
  throw new Error('Database name is missing from DATABASE_URL');
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
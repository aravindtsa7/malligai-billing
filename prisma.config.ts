import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

const isTest = process.env.NODE_ENV === 'test' || process.env.PRISMA_TARGET === 'test';
const datasourceUrl = isTest
  ? (process.env.DATABASE_URL_TEST || env('DATABASE_URL').replace(/\/([^/?]+)(\?.*)?$/, '/$1_test$2'))
  : env('DATABASE_URL');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: datasourceUrl,
  },
});
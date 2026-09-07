import 'dotenv/config';

process.env.NODE_ENV = 'test';

if (!process.env.DATABASE_URL_TEST && process.env.DATABASE_URL) {
  process.env.DATABASE_URL_TEST = process.env.DATABASE_URL.replace(/\/([^/?]+)(\?.*)?$/, '/$1_test$2');
}


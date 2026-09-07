import { prisma } from '../src/core/database/prisma.js';

/**
 * Hard runtime safety guard.
 * Queries `SELECT DATABASE()` live from the MySQL/MariaDB server connection
 * to guarantee that the test suite is connected to an isolated test database.
 * Fails immediately if connected to `malligai_billing` or any non-test database.
 */
export async function assertTestDatabase(client = prisma): Promise<string> {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error(
      `[FATAL DATABASE SAFETY GUARD] NODE_ENV must be 'test' during test execution (currently: '${process.env.NODE_ENV}'). Execution aborted.`
    );
  }

  const rows: any = await client.$queryRawUnsafe('SELECT DATABASE() AS currentDb');
  const currentDb = rows[0]?.currentDb || rows[0]?.['DATABASE()'];

  if (!currentDb) {
    throw new Error('[FATAL DATABASE SAFETY GUARD] Unable to resolve current database name from connection.');
  }

  if (currentDb === 'malligai_billing' || !currentDb.endsWith('_test')) {
    throw new Error(
      `[FATAL DATABASE SAFETY GUARD] Tests are connected to unsafe database '${currentDb}'! ` +
      `Automated tests are strictly prohibited from executing against non-test databases. Execution aborted immediately.`
    );
  }

  return currentDb;
}


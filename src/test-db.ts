import { prisma } from './core/database/prisma.js';

async function main(): Promise<void> {
  const userCount = await prisma.user.count();

  console.log('Database connection successful');
  console.log(`Users count: ${userCount}`);
}

main()
  .catch((error) => {
    console.error('Database connection failed');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
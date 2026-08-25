import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma } from '../core/database/prisma.js';
import { env } from '../core/config/env.js';
import { Role } from '../generated/prisma/enums.js';

async function seedAdmin(): Promise<void> {
  const username = env.INITIAL_ADMIN_USERNAME;
  const rawPassword = env.INITIAL_ADMIN_PASSWORD;

  if (!username || !rawPassword) {
    console.error('❌ INITIAL_ADMIN_USERNAME and INITIAL_ADMIN_PASSWORD must be configured in environment.');
    process.exit(1);
  }

  console.log(`🌱 Checking initial admin user: "${username}"...`);

  const passwordHash = await bcrypt.hash(rawPassword, 10);

  const existingUser = await prisma.user.findUnique({
    where: { username },
  });

  if (existingUser) {
    const updated = await prisma.user.update({
      where: { id: existingUser.id },
      data: {
        role: Role.ADMIN,
        active: true,
        passwordHash,
      },
    });

    console.log(`✅ Admin user "${updated.username}" (ID: ${updated.id}) updated successfully.`);
  } else {
    const created = await prisma.user.create({
      data: {
        username,
        passwordHash,
        role: Role.ADMIN,
        active: true,
      },
    });

    console.log(`✅ Admin user "${created.username}" (ID: ${created.id}) created successfully.`);
  }
}

seedAdmin()
  .catch((error) => {
    console.error('❌ Failed to seed initial admin user:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });


import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Crée un super-admin initial. Il devra enrôler sa 2FA à la première connexion.
async function main() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password || password.length < 12) {
    throw new Error('SEED_ADMIN_EMAIL et SEED_ADMIN_PASSWORD (>= 12 caractères) sont requis.');
  }
  await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, passwordHash: await bcrypt.hash(password, 12), role: Role.SUPER_ADMIN },
  });
  console.log(`Super-admin prêt : ${email}`);
}
main().finally(() => prisma.$disconnect());

import { prisma } from "@/lib/db";
import { createOpaqueToken, hashToken } from "@/lib/auth/tokens";

const verificationLifetimeMs = 24 * 60 * 60 * 1000;
const resetLifetimeMs = 60 * 60 * 1000;

export async function issueEmailVerificationToken(userId: string) {
  const token = createOpaqueToken();
  await prisma.$transaction([
    prisma.emailVerificationToken.deleteMany({ where: { userId } }),
    prisma.emailVerificationToken.create({ data: { userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + verificationLifetimeMs) } }),
  ]);
  return token;
}

export async function issuePasswordResetToken(userId: string) {
  const token = createOpaqueToken();
  await prisma.$transaction([
    prisma.passwordResetToken.deleteMany({ where: { userId } }),
    prisma.passwordResetToken.create({ data: { userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + resetLifetimeMs) } }),
  ]);
  return token;
}

export async function consumeEmailVerificationToken(token: string) {
  const record = await prisma.emailVerificationToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!record || record.expiresAt <= new Date()) {
    if (record) await prisma.emailVerificationToken.delete({ where: { id: record.id } });
    return false;
  }
  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } }),
    prisma.emailVerificationToken.delete({ where: { id: record.id } }),
  ]);
  return true;
}

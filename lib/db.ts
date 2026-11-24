import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
// Prisma CLI commands (including `prisma migrate deploy`) read DATABASE_URL from
// schema.prisma. Runtime Vercel Functions prefer a provider's pooled URL when
// supplied, preventing concurrent function instances from exhausting direct DB
// connections. Local PostgreSQL continues to use DATABASE_URL unchanged.
const connectionUrl = process.env.DATABASE_URL_POOLED ?? process.env.DATABASE_URL;

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ datasources: { db: { url: connectionUrl } } });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

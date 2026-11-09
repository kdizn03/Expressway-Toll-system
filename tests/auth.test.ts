import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../lib/auth/password";
import { createOpaqueToken, hashToken } from "../lib/auth/tokens";
import { consumeRateLimit } from "../lib/auth/rate-limit";
import { isAdmin, ownsRecord } from "../lib/auth/authorization";
import { registerSchema, resetPasswordSchema, routeSearchSchema } from "../lib/validation";

describe("authentication security primitives", () => {
  it("hashes passwords and rejects invalid credentials", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).not.toContain("correct horse battery staple");
    await expect(verifyPassword("correct horse battery staple", hash)).resolves.toBe(true);
    await expect(verifyPassword("not the password", hash)).resolves.toBe(false);
  });

  it("uses opaque tokens and only persists deterministic hashes", () => {
    const token = createOpaqueToken();
    expect(token.length).toBeGreaterThan(32);
    expect(hashToken(token)).toHaveLength(64);
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toContain(token);
  });

  it("validates registration and reset confirmation without accepting short passwords", () => {
    expect(registerSchema.safeParse({ fullName: "Ana Santos", email: " ANA@EXAMPLE.COM ", password: "a secure password", confirmPassword: "a secure password" }).success).toBe(true);
    expect(registerSchema.safeParse({ fullName: "Ana", email: "ana@example.com", password: "short", confirmPassword: "short" }).success).toBe(false);
    expect(resetPasswordSchema.safeParse({ token: createOpaqueToken(), password: "a secure password", confirmPassword: "different password" }).success).toBe(false);
  });

  it("limits repeated credential actions", () => {
    const key = `test:${createOpaqueToken()}`;
    expect(consumeRateLimit(key, 2, 60_000).allowed).toBe(true);
    expect(consumeRateLimit(key, 2, 60_000).allowed).toBe(true);
    expect(consumeRateLimit(key, 2, 60_000).allowed).toBe(false);
  });

  it("enforces roles and user ownership independently of interface visibility", () => {
    const user = { id: "user-a", role: "USER" as const };
    const admin = { id: "admin-a", role: "ADMIN" as const };
    expect(isAdmin(user)).toBe(false);
    expect(isAdmin(admin)).toBe(true);
    expect(ownsRecord(user, "user-a")).toBe(true);
    expect(ownsRecord(user, "user-b")).toBe(false);
  });

  it("keeps route planning input public and independent of a user identity", () => {
    expect(routeSearchSchema.safeParse({ origin: "Baguio City", destination: "Manila", vehicleClass: "CLASS_1" }).success).toBe(true);
  });
});

import { randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
const keyLength = 64;

function deriveKey(password: string, salt: string, length: number) {
  return new Promise<Buffer>((resolve, reject) => {
    nodeScrypt(password, salt, length, { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, derived) => error ? reject(error) : resolve(derived));
  });
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("base64url");
  const derived = await deriveKey(password, salt, keyLength);
  return `scrypt$${salt}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, salt, expected] = encoded.split("$");
  if (algorithm !== "scrypt" || !salt || !expected) return false;
  const expectedBuffer = Buffer.from(expected, "base64url");
  const derived = await deriveKey(password, salt, expectedBuffer.length);
  return expectedBuffer.length === derived.length && timingSafeEqual(expectedBuffer, derived);
}

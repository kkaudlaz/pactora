import { createHash, randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const MAX_MEMORY = 128 * 1024 * 1024;

function derivePin(pin: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    nodeScrypt(pin, salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: MAX_MEMORY }, (error, key) => {
      if (error) reject(error);
      else resolve(key as Buffer);
    });
  });
}

function assertPinFormat(pin: string): void {
  if (!/^\\d{6,12}$/.test(pin)) throw new Error("PIN must contain 6 to 12 digits.");
}

/** Hash a PIN for database storage. Online attempt rate limiting is still mandatory. */
export async function hashPin(pin: string): Promise<string> {
  assertPinFormat(pin);
  const salt = randomBytes(16);
  const derived = await derivePin(pin, salt);
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

/** Verify only hashes produced by this module; malformed/unsupported encodings fail closed. */
export async function verifyPin(pin: string, encodedHash: string): Promise<boolean> {
  if (!/^\\d{6,12}$/.test(pin)) return false;
  const parts = encodedHash.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt" || parts[1] !== String(SCRYPT_N) || parts[2] !== String(SCRYPT_R) || parts[3] !== String(SCRYPT_P)) return false;
  if (!/^[a-f0-9]{32}$/.test(parts[4]) || !/^[a-f0-9]{128}$/.test(parts[5])) return false;
  const expected = Buffer.from(parts[5], "hex");
  const actual = await derivePin(pin, Buffer.from(parts[4], "hex"));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** A QR grant token is a bearer secret. Display the raw token once; persist only its hash. */
export function createAccessToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashAccessToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

import { PrismaClient } from "@prisma/client";
import { randomBytes, scrypt as nodeScrypt } from "node:crypto";
import { promisify } from "node:util";

const prisma = new PrismaClient();
const scrypt = promisify(nodeScrypt);

async function hashPassword(password) {
  if (password.length < 12 || password.length > 256) throw new Error("OWNER_PASSWORD must be 12 to 256 characters.");
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
  return `scrypt$16384$8$1$${salt.toString("hex")}$${Buffer.from(key).toString("hex")}`;
}

try {
  const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
  const password = process.env.OWNER_PASSWORD;
  const displayName = process.env.OWNER_DISPLAY_NAME?.trim() || "Pactora Owner";
  if (!email || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) throw new Error("Set OWNER_EMAIL to a valid email address.");
  if (!password) throw new Error("Set OWNER_PASSWORD in your local environment; do not put it in a committed file.");
  const passwordHash = await hashPassword(password);
  const existing = await prisma.member.findUnique({ where: { email } });
  if (existing && existing.role !== "OWNER") throw new Error("That email already belongs to a non-owner member; no changes were made.");
  const owner = await prisma.member.upsert({
    where: { email },
    create: { email, displayName, role: "OWNER", passwordHash },
    update: { displayName, role: "OWNER", passwordHash, disabledAt: null },
    select: { id: true, email: true, displayName: true, role: true },
  });
  console.log(`Owner ready: ${owner.email} (${owner.role}). No password was printed.`);
} finally {
  await prisma.$disconnect();
}

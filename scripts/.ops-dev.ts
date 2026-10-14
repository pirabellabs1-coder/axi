import { PrismaClient } from "@prisma/client";
type L = (p?: string) => void; const l = (process as unknown as { loadEnvFile?: L }).loadEnvFile; if (typeof l === "function") { try { l(".env"); } catch {} }
const db = new PrismaClient();
db.posDevice.findMany({ where: { storeId: "cmv2hxyeh0082ibksgrola5ul" }, select: { id: true, name: true, tokenPrefix: true, revokedAt: true, createdAt: true } })
  .then((r) => console.log("appareils:", JSON.stringify(r)))
  .then(() => db.auditLog.findMany({ where: { action: { startsWith: "pos." } }, orderBy: { createdAt: "desc" }, take: 5, select: { action: true, target: true, metadata: true } }))
  .then((r) => console.log("audit pos:", JSON.stringify(r)))
  .finally(() => db.$disconnect());

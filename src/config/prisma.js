const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");

// 1. יצירת חיבור דרך דרייבר PG של PostgreSQL
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// 2. יצירת ה-Adapter של Prisma 7
const adapter = new PrismaPg(pool);

// 3. אתחול PrismaClient עם ה-Adapter
const prisma = new PrismaClient({ adapter });

module.exports = prisma;

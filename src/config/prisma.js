require("dotenv").config();
const dns = require("dns");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");

// חלק מרשתות (בעיקר ראוטרים ביתיים) מפרסמות כתובות IPv6 ב-DNS בלי ניתוב IPv6 תקין בפועל.
// Node עלול לנסות IPv6 קודם ולהיתקע/להיכשל בשקט על חיבורים ל-DB מרוחק (כמו Neon).
// מעדיפים IPv4 במפורש, בדיוק כמו שדפדפנים/curl כבר עושים אוטומטית (Happy Eyeballs).
dns.setDefaultResultOrder("ipv4first");

if (!process.env.DATABASE_URL) {
  console.error("שגיאה קריטית: DATABASE_URL אינו מוגדר ב-process.env!");
}

// 1. יצירת חיבור דרך דרייבר PG של PostgreSQL
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// 2. יצירת ה-Adapter של Prisma 7
const adapter = new PrismaPg(pool);

// 3. אתחול PrismaClient עם ה-Adapter
const prisma = new PrismaClient({ adapter });

module.exports = prisma;

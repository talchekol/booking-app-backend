const prisma = require("../config/prisma");

async function resolveBusinessBySlug(req, res, next) {
  try {
    const { slug } = req.params;

    if (!slug) {
      return res.status(400).json({ error: "Slug is required" });
    }

    const business = await prisma.business.findUnique({
      where: { slug },
    });

    if (!business) {
      return res.status(404).json({ error: "Business not found" });
    }

    // שומרים את העסק על גבי ה-request כדי שהקונטרולרים הבאים יוכלו להשתמש בו ישירות
    req.business = business;
    next();
  } catch (error) {
    next(error);
  }
}

// מידלוור מנהלי: מזהה את העסק השייך למשתמש המאומת (רץ אחרי authenticateToken+requireAdmin)
// בכוונה לא משתמש ב-getTargetBusinessId מ-controllers/business.js, כי אותה פונקציה כוללת
// גם fallback גלובלי ("אין עסק? קח את הראשון בכל ה-DB") שאסור שיחול בנתיבי ניהול - אם למנהל
// אין עסק בבעלותו, זה חייב להיכשל עם 404, לא "לנהל" בטעות עסק זר
const resolveOwnedBusiness = async (req, res, next) => {
  try {
    // ה-JWT (src/controllers/auth.js) חותם payload עם userId בלבד - אין req.user.id
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: "משתמש אינו מזוהה" });
    }

    // orderBy הכרחי: findFirst בלי orderBy הוא בדיוק הבאג שפתחנו איתו את השיחה הזו -
    // בלי סדר מפורש, Postgres לא מבטיח איזו רשומה תוחזר אם יש כמה עסקים לאותו owner
    const business = await prisma.business.findFirst({
      where: { ownerId: userId },
      orderBy: { createdAt: "asc" },
    });

    if (!business) {
      return res.status(404).json({ error: "לא נמצא עסק בבעלותך" });
    }

    req.business = business;
    next();
  } catch (error) {
    console.error("resolveOwnedBusiness error:", error);
    res.status(500).json({ error: "שגיאת שרת באיתור העסק של המשתמש" });
  }
};

module.exports = { resolveBusinessBySlug, resolveOwnedBusiness };

const prisma = require("../config/prisma");

// מידלוור שמזהה את העסק לפי ה-slug ב-URL (למשל /business/:slug/appointments) ומוסיף אותו ל-request
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

// מידלוור שמזהה את העסק בבעלות המשתמש המחובר ומוסיף אותו ל-request
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

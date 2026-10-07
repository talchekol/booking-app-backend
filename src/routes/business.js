const express = require("express");
const router = express.Router();
const businessController = require("../controllers/business");
const { authenticateToken, requireAdmin } = require("../middleware/auth");
const {
  resolveBusinessBySlug,
  resolveOwnedBusiness,
} = require("../middleware/tenant");

// שליפת שירותים/ספרים של העסק שלי (מזוהה מהטוקן) - לשימוש פנימי בפאנל הניהול.
// מוגדר *לפני* בלוק ה-:slug למטה בכוונה: "/:slug/services" הוא תבנית שתופסת כל
// ערך (כולל "my"), אז אם זה היה נרשם אחרי, "/business/my/services" היה נתפס
// בטעות ע"י "/:slug/services" עם slug="my" (עסק לא קיים) ומחזיר 404 - זה בדיוק
// הבאג שתפסנו ותיקנו. מידלוור המנהל מוצמד כאן ישירות כי השער הגלובלי
// (authenticateToken/requireAdmin/resolveOwnedBusiness) מופעל רק החל משורה מאוחרת יותר.
router.get(
  "/my/services",
  authenticateToken,
  requireAdmin,
  resolveOwnedBusiness,
  businessController.getBusinessServices,
);
router.get(
  "/my/providers",
  authenticateToken,
  requireAdmin,
  resolveOwnedBusiness,
  businessController.getBusinessProviders,
);
router.get(
  "/my/appointments",
  authenticateToken,
  requireAdmin,
  resolveOwnedBusiness,
  businessController.getBusinessAppointmentsBySlug,
);
router.get(
  "/my/blocked-days",
  authenticateToken,
  requireAdmin,
  resolveOwnedBusiness,
  businessController.getBlockedDaysBySlug,
);
router.get(
  "/my/settings",
  authenticateToken,
  requireAdmin,
  resolveOwnedBusiness,
  businessController.getBusinessSettingsBySlug,
);
// פרופיל העסק שלי - מזוהה מהטוקן (מחליף את השימוש השגוי ב-GET /profile הציבורי/
// הלא-מאומת, שהשתמש ב-req.user?.id שאף פעם לא קיים כי ה-JWT נושא userId בלבד)
router.get(
  "/my/profile",
  authenticateToken,
  requireAdmin,
  resolveOwnedBusiness,
  businessController.getPublicProfile,
);
// שוק ההחלפות של העסק שלי - תצוגת מנהל: כל ההצעות הפעילות, בלי החרגה לפי
// המשתמש המחובר (בניגוד ל-GET /appointments/swaps/available שמיועד ללקוח
// שבודק אילו הצעות *של אחרים* הוא יכול להחליף אליהן, ולכן מחריג את עצמו)
router.get(
  "/my/swaps",
  authenticateToken,
  requireAdmin,
  resolveOwnedBusiness,
  businessController.getBusinessSwapOffers,
);
// פרסום תורים שבועי (ראשון-שבת)
router.get(
  "/my/week-status",
  authenticateToken,
  requireAdmin,
  resolveOwnedBusiness,
  businessController.getWeekPublishStatus,
);
router.post(
  "/my/publish-week",
  authenticateToken,
  requireAdmin,
  resolveOwnedBusiness,
  businessController.publishWeek,
);
router.post(
  "/my/unpublish-week",
  authenticateToken,
  requireAdmin,
  resolveOwnedBusiness,
  businessController.unpublishLastWeek,
);

// ==========================================
// 0.5 הרשמת עסקים חדשים (שלב 6) - נתיבים ליטרליים,
// חייבים להירשם לפני בלוק ה-":slug" למטה מאותה סיבה בדיוק כמו "/my/..."
// ==========================================
router.get("/check-slug", businessController.checkSlugAvailability);
router.post(
  "/register",
  authenticateToken,
  businessController.registerBusiness,
);

// ==========================================
// 0. פרוסה מינימלית אנכית - מולטי-טננט (שלב 2)
// ==========================================

// פרופיל ציבורי לפי slug - הנתיב הראשון שבודק שבידוד לפי עסק עובד קצה-לקצה
router.get(
  "/:slug/profile",
  resolveBusinessBySlug,
  businessController.getPublicProfile,
);

// שליפת שירותים/ספרים לפי slug - הנתיב הראשון שבודק שבידוד לפי עסק עובד קצה-לקצה
router.get(
  "/:slug/services",
  resolveBusinessBySlug,
  businessController.getBusinessServices,
);
router.get(
  "/:slug/providers",
  resolveBusinessBySlug,
  businessController.getBusinessProviders,
);
// ביקורות: קריאה פתוחה לכולם, כתיבה דורשת משתמש מחובר (לקוח כלשהו)
router.get(
  "/:slug/reviews",
  resolveBusinessBySlug,
  businessController.getBusinessReviews,
);
router.post(
  "/:slug/reviews",
  resolveBusinessBySlug,
  authenticateToken,
  businessController.createReview,
);
router.delete(
  "/:slug/reviews/:id",
  resolveBusinessBySlug,
  authenticateToken,
  businessController.deleteReview,
);
router.get(
  "/:slug/appointments",
  resolveBusinessBySlug,
  businessController.getBusinessAppointmentsBySlug,
);
router.get(
  "/:slug/blocked-days",
  resolveBusinessBySlug,
  businessController.getBlockedDaysBySlug,
);
router.get(
  "/:slug/settings",
  resolveBusinessBySlug,
  businessController.getBusinessSettingsBySlug,
);
router.get(
  "/:slug/broadcasts/active",
  resolveBusinessBySlug,
  businessController.getActiveBroadcastBySlug,
);

// ==========================================
// 1. נתיבים פתוחים וציבוריים (גם ללקוח וגם למנהל)
// ==========================================

// פרופיל ופרטי העסק (שם, כתובת, טלפון, סושיאל)
router.get("/profile", businessController.getBusinessProfile);

router.get("/services", businessController.getServices);
router.get("/providers", businessController.getProviders);

// בדיקת תפוסה וזמינות עבור הלקוח (ללא צורך בהרשאות מנהל)
router.get("/appointments", businessController.getBusinessAppointments);
router.get("/blocked-days", businessController.getBlockedDays);
router.get("/settings", businessController.getBusinessSettings);

// שליפת הודעות שידור פעילות (ללא צורך בהרשאות מנהל)
router.get("/broadcasts/active", businessController.getActiveBroadcast);

// ==========================================
// 2. שער אבטחה - מכאן ומטה רק מנהל מחובר!
// ==========================================
router.use(authenticateToken);
router.use(requireAdmin);
router.use(resolveOwnedBusiness);

// עדכון סטטוס תור ביומן
router.patch(
  "/appointments/:id/status",
  businessController.updateAppointmentStatus,
);

// עדכון פרופיל העסק (למנהל בלבד)
router.put("/profile", businessController.updateBusinessProfile);

// הוספת וביטול חסימות יום
router.post("/blocked-days", businessController.blockFullDay);
router.delete("/blocked-days/:id", businessController.unblockFullDay);

// יצירת תור ידני וחסימת שעות
router.post("/appointments/manual", businessController.createManualAppointment);
router.post("/appointments/block", businessController.blockTimeRange);
router.delete(
  "/appointments/block/:id",
  businessController.unblockSingleAppointment,
);

// עדכון הגדרות שעות הפעילות ומרווח התורים (למנהל בלבד)
router.put("/settings", businessController.updateBusinessSettings);

// ניהול שירותים (יצירה, עדכון, מחיקה)
router.post("/services", businessController.createService);
router.put("/services/:id", businessController.updateService);
router.delete("/services/:id", businessController.deleteService);

// ניהול צוות (הוספה ומחיקה)
router.post("/providers", businessController.createProvider);
router.delete("/providers/:id", businessController.deleteProvider);

// ניהול הודעות שידור (יצירה, מחיקה)
router.get("/broadcasts", businessController.getAllBroadcasts);
router.post("/broadcasts", businessController.createBroadcast);
router.delete("/broadcasts/:id", businessController.deleteBroadcast);

// סטטיסטיקות ודוחות
router.get("/stats", businessController.getBusinessStats);

module.exports = router;

const express = require("express");
const router = express.Router();
const businessController = require("../controllers/business");
const { authenticateToken, requireAdmin } = require("../middleware/auth");

// ==========================================
// 1. נתיבים פתוחים וציבוריים (גם ללקוח וגם למנהל)
// ==========================================
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

// עדכון סטטוס תור ביומן
router.patch(
  "/appointments/:id/status",
  businessController.updateAppointmentStatus,
);

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

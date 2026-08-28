const express = require("express");
const router = express.Router();
const businessController = require("../controllers/business");
const { authenticateToken, requireAdmin } = require("../middleware/auth");

// 1. נתיבים פתוחים (ציבוריים - גם ללקוח)
router.get("/services", businessController.getServices);
router.get("/providers", businessController.getProviders);

// 2. נתיבים מוגנים (רק למנהל מחובר)
router.use(authenticateToken);
router.use(requireAdmin);

// יומן תורים
router.get("/appointments", businessController.getBusinessAppointments);
router.patch(
  "/appointments/:id/status",
  businessController.updateAppointmentStatus,
);

// ניהול חסימות ימים ושעות
router.get("/blocked-days", businessController.getBlockedDays);
router.post("/blocked-days", businessController.blockFullDay);
router.delete("/blocked-days/:id", businessController.unblockFullDay);

router.post("/appointments/manual", businessController.createManualAppointment);
router.post("/appointments/block", businessController.blockTimeRange);
router.delete(
  "/appointments/block/:id",
  businessController.unblockSingleAppointment,
); // 👈 השורה החסרה שפותרת את ה-404

// ניהול שירותים
router.post("/services", businessController.createService);
router.put("/services/:id", businessController.updateService);
router.delete("/services/:id", businessController.deleteService);

// ניהול צוות
router.post("/providers", businessController.createProvider);
router.delete("/providers/:id", businessController.deleteProvider);

// סטטיסטיקות
router.get("/stats", businessController.getBusinessStats);

module.exports = router;

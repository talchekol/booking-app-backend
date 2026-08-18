const express = require("express");
const router = express.Router();
const appointmentController = require("../controllers/appointment");
const authenticateToken = require("../middleware/auth");

// 1. קביעת תור חדש
// POST /appointments
router.post("/", authenticateToken, appointmentController.createAppointment);

// 2. שליפת התור הקרוב של המשתמש + היסטוריית תורים
// GET /appointments/my
router.get("/my", authenticateToken, appointmentController.getMyAppointments);

// 3. ביטול תור
// DELETE /appointments/:appointmentId
router.delete(
  "/:appointmentId",
  authenticateToken,
  appointmentController.cancelAppointment,
);

//העלאה/הורדה של תור משוק ההצעות (Toggle Swap)
// POST /appointments/swap/toggle
router.post(
  "/swap/toggle",
  authenticateToken,
  appointmentController.toggleSwapOffer,
);

// 4. שליפת תורים זמינים להחלפה
// GET /appointments/swaps/available
router.get(
  "/swaps/available",
  authenticateToken,
  appointmentController.getAvailableSwaps,
);

// 5. שליחת בקשת החלפה עבור הצעה בשוק
// POST /appointments/swaps/request
router.post(
  "/swaps/request",
  authenticateToken,
  appointmentController.requestSwap,
);

// 6. שליפת בקשות ההחלפה שלי (נכנסות ויוצאות)
// GET /appointments/swaps/requests
router.get(
  "/swaps/requests",
  authenticateToken,
  appointmentController.getMySwapRequests,
);

// 7. אישור בקשת החלפה
// POST /appointments/swaps/requests/:requestId/approve
router.post(
  "/swaps/requests/:requestId/approve",
  authenticateToken,
  appointmentController.approveSwapRequest,
);

// 8. דחייה/ביטול של בקשת החלפה
// POST /appointments/swaps/requests/:requestId/reject
router.post(
  "/swaps/requests/:requestId/reject",
  authenticateToken,
  appointmentController.rejectSwapRequest,
);

module.exports = router;

const express = require("express");
const router = express.Router();
const authController = require("../controllers/auth");
const { authenticateToken } = require("../middleware/auth");

router.post("/send-sms", authController.sendSms);
router.post("/verify-sms", authController.verifySms);
router.post("/refresh", authenticateToken, authController.refreshToken);

module.exports = router;

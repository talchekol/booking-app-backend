const express = require("express");
const router = express.Router();
const authController = require("../controllers/auth");

router.post("/send-sms", authController.sendSms);
router.post("/verify-sms", authController.verifySms);

module.exports = router;

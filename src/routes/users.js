const express = require("express");
const router = express.Router();
const userController = require("../controllers/users");
const { authenticateToken, requireAdmin } = require("../middleware/auth");

// GET /api/users - רשימת כל המשתמשים, למנהלים בלבד
router.get("/", authenticateToken, requireAdmin, userController.getUsers);

// POST /api/users - יצירת משתמש ידנית, למנהלים בלבד
// (הרשמת משתמשים רגילה מתבצעת דרך /auth/send-sms + /auth/verify-sms)
router.post("/", authenticateToken, requireAdmin, userController.createUser);

// PUT /api/users/update-profile
router.put("/profile", authenticateToken, userController.updateProfile);

module.exports = router;

const express = require("express");
const router = express.Router();
const userController = require("../controllers/users");
const authenticateToken = require("../middleware/auth");

// GET /api/users
router.get("/", userController.getUsers);

// POST /api/users
router.post("/", userController.createUser);

// PUT /api/users/update-profile
router.put("/profile", authenticateToken, userController.updateProfile);

module.exports = router;

const express = require("express");
const router = express.Router();
const userRoutes = require("./users");
const authRoutes = require("./auth");

// ריכוז כל נתיבי המשתמשים תחת /users
router.use("/users", userRoutes);
router.use("/auth", authRoutes);

module.exports = router;

const express = require("express");
const router = express.Router();
const userRoutes = require("./users");
const authRoutes = require("./auth");
const appointmentRoutes = require("./appointments");
const businessRoutes = require("./business");

// ריכוז כל נתיבי המשתמשים תחת /users
router.use("/users", userRoutes);
router.use("/auth", authRoutes);
router.use("/appointments", appointmentRoutes);
router.use("/business", businessRoutes);
module.exports = router;

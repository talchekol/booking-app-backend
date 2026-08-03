const express = require("express");
const cors = require("cors");
require("dotenv").config();

const mainRoutes = require("./src/routes/mainRouters");

const app = express();
const PORT = process.env.PORT || 5000;

// Middlewares
app.use(cors());
app.use(express.json());

// נתיב בדיקה ראשי
app.get("/", (req, res) => {
  res.send("Booking App Server is Live! 🚀");
});

// חיבור כל נתיבי ה-API
app.use("/", mainRoutes);

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

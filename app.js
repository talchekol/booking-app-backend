const express = require("express");

// CORS: Cross-Origin Resource Sharing - מאפשר לשרת שלנו לקבל בקשות מכתובות אחרות (למשל מה-frontend שלנו ב-Vercel)
const cors = require("cors");

// dotenv: מאפשר לנו לטעון משתני סביבה מקובץ .env
require("dotenv").config();

if (!process.env.JWT_SECRET) {
  console.error(
    "❌ חסר משתנה סביבה JWT_SECRET. יש להגדיר אותו בקובץ .env לפני הפעלת השרת.",
  );
  process.exit(1);
}

const mainRoutes = require("./src/routes/mainRouters");

const app = express();
const PORT = process.env.PORT || 5000;

// Middlewares
// CORS: אם FRONTEND_URL מוגדר (כתובת ה-Vercel האמיתית בפרודקשן) - מגבילים
// אליו בלבד; אם לא מוגדר (פיתוח מקומי, או עדיין לפני שהפרונט פורס) - נשאר
// פתוח לגמרי, בדיוק כמו שהיה עד עכשיו, כדי לא לשבור כלום באמצע הדרך
const allowedOrigin = process.env.FRONTEND_URL;
app.use(cors(allowedOrigin ? { origin: allowedOrigin } : {}));
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

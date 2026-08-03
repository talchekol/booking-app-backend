const jwt = require("jsonwebtoken");

const authenticateToken = (req, res, next) => {
  // שליפת הטוקן מה-Header של הבקשה (Authorization: Bearer TOKEN)
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "גישה נדחתה: חסר טוקן אימות" });
  }

  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "fallback_secret_key",
    );
    req.user = decoded; // שומרים את ה-userId וה-role בתוך ה-req
    next(); // ממשיכים לפונקציה הבאה בקונטרולר
  } catch (error) {
    return res.status(403).json({ error: "טוקן לא תקין או פג תוקף" });
  }
};

module.exports = authenticateToken;

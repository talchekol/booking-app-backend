const jwt = require("jsonwebtoken");

const authenticateToken = (req, res, next) => {
  // שליפת הטוקן מה-Header של הבקשה (Authorization: Bearer TOKEN)
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "גישה נדחתה: חסר טוקן אימות" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // שומרים את ה-userId וה-role בתוך ה-req
    next(); // ממשיכים לפונקציה הבאה בקונטרולר
  } catch (error) {
    return res.status(403).json({ error: "טוקן לא תקין או פג תוקף" });
  }
};

// דורש שהמשתמש המחובר יהיה בעל תפקיד ADMIN (יש להריץ אחרי authenticateToken)
const requireAdmin = (req, res, next) => {
  if (req.user?.role !== "ADMIN") {
    return res.status(403).json({ error: "הגישה מותרת למנהלים בלבד" });
  }
  next();
};

module.exports = authenticateToken;
module.exports.authenticateToken = authenticateToken;
module.exports.requireAdmin = requireAdmin;

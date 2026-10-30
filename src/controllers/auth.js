const prisma = require("../config/prisma");
const jwt = require("jsonwebtoken");
const { sendVerificationCode, checkVerificationCode } = require("../config/sms");

// הגבלת ניסיונות אימות קוד (למניעת brute-force) - נשמר בזיכרון בלבד
// מפתח: מספר טלפון, ערך: { count, windowStart }
const verifyAttempts = new Map();
const MAX_VERIFY_ATTEMPTS = 5;
const ATTEMPTS_WINDOW_MS = 5 * 60 * 1000; // 5 דקות, תואם לתוקף הקוד

const isRateLimited = (phone) => {
  const entry = verifyAttempts.get(phone);
  if (!entry) return false;
  if (Date.now() - entry.windowStart > ATTEMPTS_WINDOW_MS) {
    verifyAttempts.delete(phone);
    return false;
  }
  return entry.count >= MAX_VERIFY_ATTEMPTS;
};

const registerFailedAttempt = (phone) => {
  const entry = verifyAttempts.get(phone);
  if (!entry || Date.now() - entry.windowStart > ATTEMPTS_WINDOW_MS) {
    verifyAttempts.set(phone, { count: 1, windowStart: Date.now() });
  } else {
    entry.count += 1;
  }
};

// הגבלת קצב על שליחת SMS עצמה (למניעת הצפת מספר טלפון בבקשות קוד) -
// נשמר בזיכרון בלבד, כמו verifyAttempts למעלה
const sendAttempts = new Map();
const MAX_SEND_ATTEMPTS = 3;
const SEND_WINDOW_MS = 10 * 60 * 1000; // 10 דקות

const isSendRateLimited = (phone) => {
  const entry = sendAttempts.get(phone);
  if (!entry) return false;
  if (Date.now() - entry.windowStart > SEND_WINDOW_MS) {
    sendAttempts.delete(phone);
    return false;
  }
  return entry.count >= MAX_SEND_ATTEMPTS;
};

const registerSendAttempt = (phone) => {
  const entry = sendAttempts.get(phone);
  if (!entry || Date.now() - entry.windowStart > SEND_WINDOW_MS) {
    sendAttempts.set(phone, { count: 1, windowStart: Date.now() });
  } else {
    entry.count += 1;
  }
};

// 1. שליחת קוד אימות ב-SMS (OTP)
const sendSms = async (req, res) => {
  try {
    const { phone } = req.body;
    console.log(`📩 POST /auth/send-sms - התקבלה בקשה עבור ${phone}`);

    if (!phone) {
      return res.status(400).json({ error: "מספר טלפון הוא שדה חובה" });
    }

    if (isSendRateLimited(phone)) {
      return res.status(429).json({
        error: "יותר מדי בקשות לקוד אימות. יש לנסות שוב בעוד כמה דקות.",
      });
    }
    registerSendAttempt(phone);

    // איפוס מונה הניסיונות השגויים בכל בקשה לקוד חדש
    verifyAttempts.delete(phone);

    // שולח SMS אמיתי דרך Twilio Verify אם מוגדר ב-.env, אחרת נופל חזרה
    // לסימולציה (קוד מודפס לטרמינל) - ראו src/config/sms.js
    await sendVerificationCode(phone);
    console.log(`✅ קוד אימות נשלח בהצלחה ל-${phone}`);

    res.status(200).json({ message: "קוד אימות נשלח בהצלחה" });
  } catch (error) {
    console.error("Error sending OTP:", error);
    res.status(500).json({ error: "שגיאה בשליחת קוד אימות" });
  }
};

// 2. אימות קוד ה-OTP והתחברות (Verify OTP)
const verifySms = async (req, res) => {
  try {
    const { phone, code } = req.body;

    if (!phone || !code) {
      return res.status(400).json({ error: "מספר טלפון וקוד הם שדות חובה" });
    }

    if (isRateLimited(phone)) {
      return res.status(429).json({
        error: "יותר מדי ניסיונות שגויים. יש לבקש קוד אימות חדש.",
      });
    }

    // בדיקת הקוד - מול Twilio Verify אם מוגדר, אחרת מול טבלת VerificationCode
    // (ראו src/config/sms.js)
    const isValid = await checkVerificationCode(phone, code);

    if (!isValid) {
      registerFailedAttempt(phone);
      return res.status(400).json({ error: "קוד אימות שגוי או פג תוקף" });
    }

    // חיפוש או יצירה של המשתמש בטבלת User
    let user = await prisma.user.findUnique({
      where: { phone },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          phone,
          isVerified: true,
        },
      });
    } else if (!user.isVerified) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { isVerified: true },
      });
    }

    // מחיקת כל קודי האימות הישנים של הטלפון הזה (לשמירה על סדר)
    await prisma.verificationCode.deleteMany({
      where: { phone },
    });

    // איפוס מונה הניסיונות השגויים לאחר אימות מוצלח
    verifyAttempts.delete(phone);

    // יצירת טוקן JWT
    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "30d" },
    );

    res.status(200).json({
      message: "התחברות בוצעה בהצלחה",
      token,
      user: {
        id: user.id,
        phone: user.phone,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        isNewUser: !user.firstName, // אם אין שם, נעביר אותו למסך השלמת פרטים בפרונט
      },
    });
  } catch (error) {
    console.error("Error verifying OTP:", error);
    res.status(500).json({ error: "שגיאה באימות הקוד" });
  }
};

// 3. חידוש טוקן (sliding session) - נקרא בשקט מהפרונט בכל פעם שהאפליקציה
// נפתחת/חוזרת לפוקוס, כדי שמשתמש פעיל לעולם לא יראה מסך login מחדש, בעוד
// שמכשיר שאבד/ננטש ולא נעשה בו שימוש עדיין "ננעל" אחרי 30 יום כרגיל.
// שולפים את ה-role מה-DB מחדש (לא רק מעתיקים מהטוקן הישן) כדי ששינוי הרשאה
// (לדוגמה מנהל שהפסיק להיות ADMIN) ייכנס לתוקף כבר בחידוש הקרוב, לא רק
// כשהטוקן הישן יפוג
const refreshToken = async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ error: "משתמש לא נמצא" });
    }

    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "30d" },
    );

    res.status(200).json({
      token,
      user: {
        id: user.id,
        phone: user.phone,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Error refreshing token:", error);
    res.status(500).json({ error: "שגיאה בחידוש ההתחברות" });
  }
};

module.exports = {
  sendSms,
  verifySms,
  refreshToken,
};

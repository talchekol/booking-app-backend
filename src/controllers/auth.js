const prisma = require("../config/prisma");
const jwt = require("jsonwebtoken");

// 1. שליחת קוד אימות ב-SMS (OTP)
const sendSms = async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({ error: "מספר טלפון הוא שדה חובה" });
    }

    // ייצור קוד אקראי בן 4 ספרות
    const generatedCode = Math.floor(1000 + Math.random() * 9000).toString();

    // קוד תקף ל-5 דקות
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    // שמירת הקוד בטבלת VerificationCode
    await prisma.verificationCode.create({
      data: {
        phone,
        code: generatedCode,
        expiresAt,
      },
    });

    // 💡 הדפסה לטרמינל (עד שנחבר ספק SMS אמיתי)
    console.log(`📱 [SMS Simulation] Code for ${phone} is: ${generatedCode}`);

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

    // חיפוש קוד האימות האחרון שנשלח לטלפון הזה
    const verification = await prisma.verificationCode.findFirst({
      where: { phone, code },
      orderBy: { createdAt: "desc" },
    });

    if (!verification) {
      return res.status(400).json({ error: "קוד אימות שגוי" });
    }

    // בדיקה אם הקוד פג תוקף
    if (new Date() > verification.expiresAt) {
      return res.status(400).json({ error: "קוד האימות פג תוקף" });
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

    // יצירת טוקן JWT
    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET || "fallback_secret_key",
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

module.exports = {
  sendSms,
  verifySms,
};

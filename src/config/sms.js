// שכבת הפשטה לשליחת/אימות קוד OTP - עם שני מצבי פעולה:
// 1. "אמיתי" (production) - כש-TWILIO_* מוגדרים ב-.env, שולח SMS אמיתי דרך
//    Twilio Verify (שגם מייצר, שומר ומגביל ניסיונות בצד שלהם - לא צריך לנהל
//    קוד/ניסיונות בעצמנו בכלל במצב הזה).
// 2. "סימולציה" (dev) - כשאין מפתחות Twilio מוגדרים, חוזרים בדיוק להתנהגות
//    הישנה: קוד אקראי נשמר בטבלת VerificationCode ומודפס לטרמינל - כדי
//    שאפשר להמשיך לפתח ולבדוק מקומית בלי לשלם/לחכות ל-SMS אמיתי.

const prisma = require("./prisma");

const hasTwilioConfig = Boolean(
  process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_VERIFY_SERVICE_SID,
);

let twilioClient = null;
if (hasTwilioConfig) {
  const twilio = require("twilio");
  twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN,
  );
  console.log("📨 SMS: מצב אמיתי (Twilio Verify) פעיל");
} else {
  console.log("📨 SMS: מצב סימולציה (אין מפתחות Twilio ב-.env) - קוד יודפס לטרמינל");
}

// עוטף הבטחה (promise) בטיימאאוט - כדי שקריאה תקועה ל-Twilio (רשת תקולה,
// תקלה זמנית אצלם וכו') תיכשל אחרי X שניות עם שגיאה ברורה, במקום להישאר
// תלויה לנצח ולהשאיר גם את הלקוח וגם אותנו בלי שום אינדיקציה למה שקרה
const withTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`Timeout: ${label} לא הגיב תוך ${ms / 1000} שניות`)),
        ms,
      ),
    ),
  ]);

const TWILIO_TIMEOUT_MS = 15000;

// ממיר מספר טלפון ישראלי מקומי (0501234567) לפורמט E.164 שטוויליו דורש (+972501234567)
const toE164 = (localPhone) => {
  const digits = localPhone.replace(/\D/g, "");
  const withoutLeadingZero = digits.startsWith("0") ? digits.slice(1) : digits;
  return `+972${withoutLeadingZero}`;
};

// שליחת קוד אימות - מחזיר { simulated: boolean }. במצב סימולציה גם יוצר
// ושומר את הקוד בטבלת VerificationCode (בדיוק כמו קודם); במצב אמיתי טוויליו
// מנהל את הכול בעצמם, אין צורך לשמור שום דבר אצלנו.
const sendVerificationCode = async (phone) => {
  if (hasTwilioConfig) {
    await withTimeout(
      twilioClient.verify.v2
        .services(process.env.TWILIO_VERIFY_SERVICE_SID)
        .verifications.create({ to: toE164(phone), channel: "sms" }),
      TWILIO_TIMEOUT_MS,
      "Twilio verifications.create",
    );
    return { simulated: false };
  }

  await prisma.verificationCode.deleteMany({ where: { phone } });
  const generatedCode = Math.floor(1000 + Math.random() * 9000).toString();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
  await prisma.verificationCode.create({
    data: { phone, code: generatedCode, expiresAt },
  });
  console.log(`📱 [SMS Simulation] Code for ${phone} is: ${generatedCode}`);
  return { simulated: true };
};

// בדיקת קוד אימות - מחזיר boolean (האם הקוד נכון ותקף)
const checkVerificationCode = async (phone, code) => {
  if (hasTwilioConfig) {
    const result = await withTimeout(
      twilioClient.verify.v2
        .services(process.env.TWILIO_VERIFY_SERVICE_SID)
        .verificationChecks.create({ to: toE164(phone), code }),
      TWILIO_TIMEOUT_MS,
      "Twilio verificationChecks.create",
    );
    return result.status === "approved";
  }

  const verification = await prisma.verificationCode.findFirst({
    where: { phone, code },
    orderBy: { createdAt: "desc" },
  });
  if (!verification) return false;
  if (new Date() > verification.expiresAt) return false;
  await prisma.verificationCode.deleteMany({ where: { phone } });
  return true;
};

module.exports = { hasTwilioConfig, sendVerificationCode, checkVerificationCode };

-- לפני יצירת האילוץ: אם קיימים תורים כפולים לאותו ספר/מועד (למשל משריד של באג
-- race condition ישן - שתי בקשות בו-זמניות שעברו את בדיקת ההתנגשות לפני שאחת
-- מהן הספיקה להיכתב), מבטלים את כל הכפילויות חוץ מהמוקדמת ביותר, כדי שהאילוץ
-- למטה יוכל להיווצר בלי להתנגש בנתונים קיימים.
WITH duplicates AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY "providerId", "dateTime" ORDER BY "createdAt" ASC) AS rn
  FROM "Appointment"
  WHERE status != 'CANCELLED'
)
UPDATE "Appointment"
SET status = 'CANCELLED'
WHERE id IN (SELECT id FROM duplicates WHERE rn > 1);

-- אילוץ ייחודיות חלקי (Postgres partial unique index): לא ניתן שיהיו שני
-- תורים לא-מבוטלים לאותו ספר באותו מועד בדיוק. זה קו ההגנה האמיתי מול race
-- condition בקביעת תורים - בדיקת findFirst באפליקציה לבדה אינה אטומית ולא
-- מספיקה כשמגיעות שתי בקשות במקביל ממש. חלקי (WHERE status != 'CANCELLED')
-- כדי שמשבצת שהתפנתה ע"י ביטול תישאר פנויה לקביעה מחדש.
CREATE UNIQUE INDEX "Appointment_providerId_dateTime_active_key"
ON "Appointment" ("providerId", "dateTime")
WHERE status != 'CANCELLED';

// כל החישובים כאן עובדים על "תאריך בלבד" (מחרוזת YYYY-MM-DD, בלי שעה) וממירים
// אותה תמיד ל-UTC כדי למנוע הזזת יום לפי אזור הזמן של השרת - "היום ה-15" חייב
// להישאר "ה-15" גם אם השרת רץ ב-UTC וגם אם הוא רץ ב-Asia/Jerusalem.

const parseDateOnly = (str) => new Date(`${str}T00:00:00.000Z`);

const formatDateOnly = (d) => d.toISOString().slice(0, 10);

const addDaysUTC = (d, days) => {
  const copy = new Date(d);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
};

// יום ראשון הקרוב - אם היום עצמו כבר ראשון, מחזיר את היום; אחרת הראשון הבא
// (לא "ראשון של השבוע הנוכחי", שיכול להיות כבר בעבר אם היום למשל שלישי)
const getNextSundayUTC = (d) => {
  const daysUntilSunday = (7 - d.getUTCDay()) % 7;
  return addDaysUTC(d, daysUntilSunday);
};

// מחשב את טווח השבוע (ראשון-שבת) הקרוב שעדיין לא פורסם, לפי bookingOpenUntil
// הנוכחי (תמיד אמור להיות יום שבת של הפרסום האחרון, או null אם מעולם לא פורסם).
// הפרסום תמיד מכוון קדימה - ליום ראשון הקרוב הבא, אף פעם לא לשבוע שכבר התחיל.
// todayStr אופציונלי (YYYY-MM-DD, מחושב בצד הלקוח) - נופל חזרה לתאריך השרת אם חסר.
const getNextUnpublishedWeek = (bookingOpenUntil, todayStr) => {
  const today = parseDateOnly(todayStr || formatDateOnly(new Date()));
  const nextSunday = getNextSundayUTC(today);

  let weekStart = nextSunday;
  if (bookingOpenUntil) {
    const lastPublishedSaturday = parseDateOnly(bookingOpenUntil);
    const candidate = addDaysUTC(lastPublishedSaturday, 1);
    // רק אם השבוע שאחרי הפרסום האחרון עדיין עתידי - אחרת (בעל העסק נעדר כמה
    // שבועות) חוזרים לראשון הקרוב הבא במקום להציע לפרסם שבוע שכבר עבר
    if (candidate > nextSunday) {
      weekStart = candidate;
    }
  }

  const weekEnd = addDaysUTC(weekStart, 6);
  return { weekStart: formatDateOnly(weekStart), weekEnd: formatDateOnly(weekEnd) };
};

module.exports = {
  parseDateOnly,
  formatDateOnly,
  addDaysUTC,
  getNextSundayUTC,
  getNextUnpublishedWeek,
};

const prisma = require("../config/prisma");

// שליפת כל המשתמשים מ-Neon
const getUsers = async (req, res) => {
  try {
    const users = await prisma.user.findMany();
    res.status(200).json(users);
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ error: "שגיאה בשרת בעת שליפת המשתמשים" });
  }
};

// יצירת משתמש חדש
const createUser = async (req, res) => {
  try {
    const { phone, firstName, lastName, role } = req.body;

    // 1. בדיקת חובה: מספר טלפון הוא שדה חובה
    if (!phone) {
      return res.status(400).json({ error: "מספר טלפון הוא שדה חובה" });
    }

    // 2. בדיקה אם המשתמש כבר קיים במערכת לפי הטלפון
    const existingUser = await prisma.user.findUnique({
      where: { phone },
    });

    if (existingUser) {
      return res.status(400).json({ error: "משתמש עם מספר טלפון זה כבר קיים" });
    }

    // 3. יצירת המשתמש ב-PostgreSQL דרך Prisma
    const newUser = await prisma.user.create({
      data: {
        phone,
        firstName,
        lastName,
        role: role || "CLIENT", // ברירת מחדל היא לקוח
      },
    });

    // 4. החזרת המשתמש החדש שנוצר בסטטוס 201 (Created)
    res.status(201).json(newUser);
  } catch (error) {
    console.error("Error creating user:", error);
    res.status(500).json({ error: "שגיאה ביצירת המשתמש" });
  }
};

// עדכון פרופיל משתמש (שם פרטי ושם משפחה)
const updateProfile = async (req, res) => {
  try {
    const userId = req.user.userId; // מגיע מה-Middleware של ה-JWT
    const { firstName, lastName } = req.body;

    if (!firstName || !lastName) {
      return res.status(400).json({ error: "שם פרטי ושם משפחה הם שדות חובה" });
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        firstName,
        lastName,
      },
    });

    res.status(200).json({
      message: "הפרופיל עודכן בהצלחה",
      user: updatedUser,
    });
  } catch (error) {
    console.error("Error updating profile:", error);
    res.status(500).json({ error: "שגיאה בעדכון הפרטים" });
  }
};

module.exports = {
  getUsers,
  createUser,
  updateProfile,
};

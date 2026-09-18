const prisma = require("../config/prisma");
const jwt = require("jsonwebtoken");
const { RESERVED_SLUGS, isValidSlugFormat } = require("../utils/reservedSlugs");

// פונקציית עזר לשליפת businessId
// הדירוג לפי createdAt מבטיח שאם קיימות כמה רשומות עסק לאותו בעלים (למשל בגלל seed כפול),
// כל הקריאות בשרת (קריאה ועדכון כאחד) יצביעו תמיד על אותה רשומה בדיוק
const getTargetBusinessId = async (userId) => {
  if (userId) {
    const userBusiness = await prisma.business.findFirst({
      where: { ownerId: userId },
      orderBy: { createdAt: "asc" },
    });
    if (userBusiness) return userBusiness.id;
  }

  const defaultBusiness = await prisma.business.findFirst({
    orderBy: { createdAt: "asc" },
  });
  return defaultBusiness ? defaultBusiness.id : null;
};

// ==========================================
// 1. יומן תורים (Calendar & Operations)
// ==========================================

// שליפת יומן התורים לפי תאריך / ספר (פתוח ללקוח ולמנהל)
exports.getBusinessAppointments = async (req, res) => {
  try {
    const { date, providerId, businessId } = req.query;
    const targetBusinessId =
      businessId || (await getTargetBusinessId(req.user?.id));

    const whereClause = {};
    if (targetBusinessId) {
      whereClause.businessId = targetBusinessId;
    }

    if (date) {
      const startOfDay = new Date(`${date}T00:00:00.000Z`);
      const endOfDay = new Date(`${date}T23:59:59.999Z`);
      whereClause.dateTime = {
        gte: startOfDay,
        lte: endOfDay,
      };
    }

    if (providerId) {
      whereClause.providerId = providerId;
    }

    const appointments = await prisma.appointment.findMany({
      where: whereClause,
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, phone: true },
        },
        provider: { select: { id: true, name: true, imageUrl: true } },
        service: {
          select: { id: true, name: true, price: true, durationMin: true },
        },
      },
      orderBy: { dateTime: "asc" },
    });

    res.json(appointments);
  } catch (error) {
    console.error("Error fetching business appointments:", error);
    res.status(500).json({ error: "שגיאה בשליפת יומן התורים" });
  }
};

// עדכון סטטוס תור
exports.updateAppointmentStatus = async (req, res) => {
  try {
    const { id } = req.params;
    let { status } = req.body;

    if (typeof status === "string") {
      status = status.toUpperCase();
    }

    if (status === "NO_SHOW") status = "CANCELLED";

    const validStatuses = ["PENDING", "CONFIRMED", "CANCELLED", "COMPLETED"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: "סטטוס תור לא חוקי" });
    }

    const existing = await prisma.appointment.findFirst({
      where: { id, businessId: req.business.id },
    });
    if (!existing) {
      return res.status(404).json({ error: "התור לא נמצא" });
    }

    const updated = await prisma.appointment.update({
      where: { id },
      data: { status },
      include: {
        user: { select: { firstName: true, phone: true } },
        provider: true,
        service: true,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error("Error updating appointment status:", error);
    res.status(500).json({ error: "שגיאה בעדכון סטטוס התור" });
  }
};

// קביעת תור ידני ע"י בעל העסק
exports.createManualAppointment = async (req, res) => {
  try {
    const { clientName, clientPhone, providerId, serviceId, dateTime } =
      req.body;

    if (!providerId || !serviceId || !dateTime) {
      return res.status(400).json({ error: "חסרים פרטי חובה לקביעת התור" });
    }

    const provider = await prisma.provider.findFirst({
      where: { id: providerId, businessId: req.business.id },
    });

    if (!provider) {
      return res.status(404).json({ error: "ספר לא נמצא" });
    }

    const phoneToUse = clientPhone || `walkin-${Date.now()}`;
    const clientUser = await prisma.user.upsert({
      where: { phone: phoneToUse },
      update: { firstName: clientName || undefined },
      create: {
        phone: phoneToUse,
        firstName: clientName || "לקוח מזדמן",
        isVerified: true,
        role: "CLIENT",
      },
    });

    const targetDate = new Date(dateTime);
    const existing = await prisma.appointment.findFirst({
      where: {
        providerId,
        dateTime: targetDate,
        status: { in: ["CONFIRMED", "PENDING"] },
      },
    });

    if (existing) {
      return res
        .status(400)
        .json({ error: "משבצת הזמן הזו כבר תפוסה אצל הספר" });
    }

    const appointment = await prisma.appointment.create({
      data: {
        businessId: provider.businessId,
        providerId,
        serviceId,
        userId: clientUser.id,
        dateTime: targetDate,
        status: "CONFIRMED",
      },
      include: {
        user: true,
        provider: true,
        service: true,
      },
    });

    res.status(201).json(appointment);
  } catch (error) {
    console.error("Error creating manual appointment:", error);
    res.status(500).json({ error: "שגיאה ביצירת תור ידני" });
  }
};

// שליפת הגדרות העסק (שעות פתיחה, משך משבצת, וכו')
exports.getBusinessSettings = async (req, res) => {
  try {
    const { businessId } = req.query;
    const targetBusinessId =
      businessId || (await getTargetBusinessId(req.user?.id));

    const business = targetBusinessId
      ? await prisma.business.findUnique({
          where: { id: targetBusinessId },
          select: {
            openTime: true,
            closeTime: true,
            slotInterval: true,
            bookingOpenUntil: true,
          },
        })
      : null;

    res.json({
      openTime: business?.openTime || "09:00",
      closeTime: business?.closeTime || "19:30",
      slotInterval: Number(business?.slotInterval) || 30,
      bookingOpenUntil: business?.bookingOpenUntil || null,
    });
  } catch (error) {
    console.error("Error fetching business settings:", error);
    res.status(500).json({ error: "שגיאה בשליפת הגדרות העסק" });
  }
};

// עדכון שעות פתיחה, סגירה ומרווח תורים
exports.updateBusinessSettings = async (req, res) => {
  try {
    const { openTime, closeTime, slotInterval } = req.body;

    const dataToUpdate = {};
    if (openTime) dataToUpdate.openTime = openTime;
    if (closeTime) dataToUpdate.closeTime = closeTime;
    if (slotInterval !== undefined && slotInterval !== null) {
      dataToUpdate.slotInterval = parseInt(slotInterval, 10);
    }

    // עדכון ודאי וישיר לפי ID - req.business הוצמד ע"י resolveOwnedBusiness
    const updated = await prisma.business.update({
      where: { id: req.business.id },
      data: dataToUpdate,
    });

    res.json({
      success: true,
      message: "הגדרות עודכנו בהצלחה",
      settings: updated,
    });
  } catch (error) {
    console.error("Error updating business settings:", error);
    res.status(500).json({ error: "שגיאה בעדכון הגדרות העסק" });
  }
};
// חסימת טווח שעות כרשומה אחת בודדת ומהירה
// חסימת טווח שעות מוגנת ויציבה (בשאילתה אחת מהירה)
exports.blockTimeRange = async (req, res) => {
  try {
    const { date, startTime, endTime, reason, providerId } = req.body;

    if (!date || !startTime || !endTime) {
      return res
        .status(400)
        .json({ error: "חובה לציין תאריך, שעת התחלה ושעת סיום" });
    }

    // req.business הוצמד ע"י resolveOwnedBusiness - אין עוד fallback לעסק גלובלי כלשהו
    const businessId = req.business.id;

    // חישוב משך החסימה הכולל בדקות
    const [startH, startM] = startTime.split(":").map(Number);
    const [endH, endM] = endTime.split(":").map(Number);
    const durationMin = endH * 60 + endM - (startH * 60 + startM);

    if (durationMin <= 0) {
      return res
        .status(400)
        .json({ error: "שעת הסיום חייבת להיות אחרי שעת ההתחלה" });
    }

    // מציאת או יצירת שירות חסימה ייעודי עם המשך הנבחר
    const serviceName = reason ? `חסום: ${reason}` : "חסום";
    let blockService = await prisma.service.findFirst({
      where: { businessId, name: serviceName, durationMin },
    });

    if (!blockService) {
      blockService = await prisma.service.create({
        data: {
          name: serviceName,
          price: 0,
          durationMin,
          businessId,
        },
      });
    }

    // רשימת הספרים שעבורם חוסמים
    let targetProviders = [];
    if (providerId) {
      targetProviders = await prisma.provider.findMany({
        where: { id: providerId, businessId },
        select: { id: true },
      });
    } else {
      targetProviders = await prisma.provider.findMany({
        where: { businessId },
        select: { id: true },
      });
    }

    // אם עדיין אין ספרים מוגדרים במסד הנתונים
    if (targetProviders.length === 0) {
      return res
        .status(400)
        .json({ error: "לא נמצאו נותני שירות (ספרים) במערכת" });
    }

    const blockStartDateTime = new Date(`${date}T${startTime}:00.000Z`);
    const providerIds = targetProviders.map((p) => p.id);

    // מחיקת חסימות קודמות באותה משבצת בדיוק
    await prisma.appointment.deleteMany({
      where: {
        providerId: { in: providerIds },
        dateTime: blockStartDateTime,
      },
    });

    // יצירת רשומות החסימה במכה אחת
    const records = providerIds.map((pId) => ({
      dateTime: blockStartDateTime,
      status: "CONFIRMED",
      businessId,
      providerId: pId,
      serviceId: blockService.id,
      userId: currentUserId || null,
    }));

    await prisma.appointment.createMany({
      data: records,
    });

    res.status(201).json({ message: "טווח השעות נחסם בהצלחה" });
  } catch (error) {
    console.error("Error blocking time range:", error);
    res
      .status(500)
      .json({ error: error.message || "שגיאה בביצוע חסימת השעות" });
  }
};

// יצירת חסימת יום
exports.blockFullDay = async (req, res) => {
  try {
    const { date, providerId, reason } = req.body;

    if (!date) {
      return res.status(400).json({ error: "חובה לציין תאריך" });
    }

    const businessId = req.business.id;

    const targetProviderId =
      providerId && providerId.trim() !== "" ? providerId : null;

    if (targetProviderId) {
      const provider = await prisma.provider.findFirst({
        where: { id: targetProviderId, businessId },
      });
      if (!provider) {
        return res.status(404).json({ error: "ספר לא נמצא" });
      }
    }

    const whereDelete = { date, businessId };
    if (targetProviderId) {
      whereDelete.providerId = targetProviderId;
    } else {
      whereDelete.providerId = null;
    }

    await prisma.blockedDay.deleteMany({ where: whereDelete });

    const blocked = await prisma.blockedDay.create({
      data: {
        date,
        reason: reason || "יום חופש",
        businessId,
        ...(targetProviderId && { providerId: targetProviderId }),
      },
      include: {
        provider: { select: { id: true, name: true } },
      },
    });

    res.status(201).json(blocked);
  } catch (error) {
    console.error("Error creating blocked day:", error);

    res.status(500).json({ error: "שגיאה ביצירת חסימת יום: " + error.message });
  }
};

// ביטול חסימת יום
exports.unblockFullDay = async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.blockedDay.findFirst({
      where: { id, businessId: req.business.id },
    });
    if (!existing) {
      return res.status(404).json({ error: "חסימת היום לא נמצאה" });
    }
    await prisma.blockedDay.delete({ where: { id } });
    res.json({ message: "חסימת היום בוטלה בהצלחה" });
  } catch (error) {
    console.error("Error unblocking day:", error);
    res.status(500).json({ error: "שגיאה בביטול חסימת היום" });
  }
};

// ביטול חסימת שעה בודדת
exports.unblockSingleAppointment = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: "מזהה חסימה חסר" });
    }

    const existing = await prisma.appointment.findFirst({
      where: { id, businessId: req.business.id },
    });
    if (!existing) {
      return res.status(404).json({ error: "החסימה לא נמצאה" });
    }

    await prisma.appointment.delete({ where: { id } });
    res.json({ message: "החסימה בוטלה בהצלחה" });
  } catch (error) {
    console.error("Error deleting blocked slot:", error);
    res.status(500).json({ error: "שגיאה בביטול החסימה" });
  }
};

// שליפת ימים חסומים
exports.getBlockedDays = async (req, res) => {
  try {
    const { date, businessId } = req.query;
    const targetBusinessId =
      businessId || (await getTargetBusinessId(req.user?.id));

    const whereClause = {};
    if (targetBusinessId) whereClause.businessId = targetBusinessId;
    if (date) whereClause.date = date;

    const blockedDays = await prisma.blockedDay.findMany({
      where: whereClause,
      include: {
        provider: { select: { id: true, name: true } },
      },
    });

    res.json(blockedDays);
  } catch (error) {
    console.error("Error fetching blocked days:", error);
    res.status(500).json({ error: "שגיאה בשליפת ימים חסומים" });
  }
};

// ==========================================
// 2. ניהול שירותים (Services)
// ==========================================

exports.getServices = async (req, res) => {
  try {
    const services = await prisma.service.findMany({
      orderBy: { price: "asc" },
    });
    res.json(services);
  } catch (error) {
    console.error("Error fetching services:", error);
    res.status(500).json({ error: "שגיאה בשליפת שירותים" });
  }
};

exports.createService = async (req, res) => {
  try {
    const { name, price, durationMin } = req.body;

    if (!name || price === undefined || !durationMin) {
      return res
        .status(400)
        .json({ error: "חסרים פרטים: שם, מחיר ומשך זמן בדקות" });
    }

    const service = await prisma.service.create({
      data: {
        name,
        price: parseFloat(price),
        durationMin: parseInt(durationMin, 10),
        businessId: req.business.id,
      },
    });

    res.status(201).json(service);
  } catch (error) {
    console.error("Error creating service:", error);
    res.status(500).json({ error: "שגיאה בהוספת שירות" });
  }
};

exports.updateService = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, price, durationMin } = req.body;

    const existing = await prisma.service.findFirst({
      where: { id, businessId: req.business.id },
    });
    if (!existing) {
      return res.status(404).json({ error: "השירות לא נמצא" });
    }

    const updated = await prisma.service.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(price !== undefined && { price: parseFloat(price) }),
        ...(durationMin !== undefined && {
          durationMin: parseInt(durationMin, 10),
        }),
      },
    });

    res.json(updated);
  } catch (error) {
    console.error("Error updating service:", error);
    res.status(500).json({ error: "שגיאה בעדכון שירות" });
  }
};

exports.deleteService = async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.service.findFirst({
      where: { id, businessId: req.business.id },
    });
    if (!existing) {
      return res.status(404).json({ error: "השירות לא נמצא" });
    }
    await prisma.service.delete({ where: { id } });
    res.json({ message: "השירות נמחק בהצלחה" });
  } catch (error) {
    console.error("Error deleting service:", error);
    res
      .status(500)
      .json({ error: "לא ניתן למחוק שירות שקשורים אליו תורים קיימים" });
  }
};

// ==========================================
// 3. ניהול ספרים וצוות (Providers)
// ==========================================

exports.getProviders = async (req, res) => {
  try {
    const providers = await prisma.provider.findMany();
    res.json(providers);
  } catch (error) {
    console.error("Error fetching providers:", error);
    res.status(500).json({ error: "שגיאה בשליפת ספרים" });
  }
};

exports.createProvider = async (req, res) => {
  try {
    const { name, imageUrl } = req.body;

    if (!name) {
      return res.status(400).json({ error: "שם הספר הוא שדה חובה" });
    }

    const provider = await prisma.provider.create({
      data: {
        name,
        imageUrl: imageUrl || null,
        businessId: req.business.id,
      },
    });

    res.status(201).json(provider);
  } catch (error) {
    console.error("Error creating provider:", error);
    res.status(500).json({ error: "שגיאה בהוספת ספר" });
  }
};

exports.deleteProvider = async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.provider.findFirst({
      where: { id, businessId: req.business.id },
    });
    if (!existing) {
      return res.status(404).json({ error: "הספר לא נמצא" });
    }
    await prisma.provider.delete({ where: { id } });
    res.json({ message: "הספר הוסר בהצלחה" });
  } catch (error) {
    console.error("Error deleting provider:", error);
    res
      .status(500)
      .json({ error: "לא ניתן למחוק ספר שקשורים אליו תורים קיימים" });
  }
};

// ==========================================
// 5. הודעות מערכת ועדכונים (Broadcasts)
// ==========================================

// שליפת ההודעה הפעילה האחרונה (פתוח ללקוחות)
exports.getActiveBroadcast = async (req, res) => {
  try {
    const businessId = await getTargetBusinessId(req.user?.id);
    const broadcast = await prisma.broadcast.findFirst({
      where: {
        ...(businessId && { businessId }),
        isActive: true,
      },
      orderBy: { createdAt: "desc" },
    });
    res.json(broadcast || null);
  } catch (error) {
    console.error("Error fetching active broadcast:", error);
    res.status(500).json({ error: "שגיאה בשליפת הודעת מערכת" });
  }
};

// שליפת כל ההודעות (למנהל)
exports.getAllBroadcasts = async (req, res) => {
  try {
    const broadcasts = await prisma.broadcast.findMany({
      where: { businessId: req.business.id },
      orderBy: { createdAt: "desc" },
    });
    res.json(broadcasts);
  } catch (error) {
    console.error("Error fetching broadcasts:", error);
    res.status(500).json({ error: "שגיאה בשליפת היסטוריית הודעות" });
  }
};

// יצירת הודעת מערכת חדשה
exports.createBroadcast = async (req, res) => {
  try {
    const { message } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: "תוכן ההודעה אינו יכול להיות ריק" });
    }

    const broadcast = await prisma.broadcast.create({
      data: {
        message: message.trim(),
        businessId: req.business.id,
        isActive: true,
      },
    });

    res.status(201).json(broadcast);
  } catch (error) {
    console.error("Error creating broadcast:", error);
    res.status(500).json({ error: "שגיאה בפרסום הודעת מערכת" });
  }
};

// מחיקת הודעת מערכת
exports.deleteBroadcast = async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.broadcast.findFirst({
      where: { id, businessId: req.business.id },
    });
    if (!existing) {
      return res.status(404).json({ error: "ההודעה לא נמצאה" });
    }
    await prisma.broadcast.delete({ where: { id } });
    res.json({ message: "ההודעה נמחקה בהצלחה" });
  } catch (error) {
    console.error("Error deleting broadcast:", error);
    res.status(500).json({ error: "שגיאה במחיקת הודעה" });
  }
};

// ==========================================
// 4. סטטיסטיקה ודוחות (KPIs)
// ==========================================

exports.getBusinessStats = async (req, res) => {
  try {
    const today = new Date();
    const startOfToday = new Date(today.setHours(0, 0, 0, 0));
    const endOfToday = new Date(today.setHours(23, 59, 59, 999));

    const todayAppointments = await prisma.appointment.findMany({
      where: {
        businessId: req.business.id,
        dateTime: { gte: startOfToday, lte: endOfToday },
      },
      include: { service: true },
    });

    const totalToday = todayAppointments.length;
    const completedToday = todayAppointments.filter(
      (a) => a.status === "COMPLETED",
    ).length;
    const cancelledToday = todayAppointments.filter(
      (a) => a.status === "CANCELLED",
    ).length;

    const expectedRevenueToday = todayAppointments
      .filter((a) => a.status !== "CANCELLED")
      .reduce((sum, a) => sum + (a.service?.price || 0), 0);

    // אין businessId על User, אז סופרים לקוחות ייחודיים מתוך התורים של העסק הזה בלבד
    const distinctClients = await prisma.appointment.groupBy({
      by: ["userId"],
      where: { businessId: req.business.id },
    });
    const totalClients = distinctClients.length;

    res.json({
      totalToday,
      completedToday,
      cancelledToday,
      expectedRevenueToday,
      totalClients,
    });
  } catch (error) {
    console.error("Error calculating stats:", error);
    res.status(500).json({ error: "שגיאה בשליפת סטטיסטיקות" });
  }
};

// שליפת יומן תורים/זמינות לעסק שאותר לפי slug (שלב 5 - השחלת slug לפרונט)
exports.getBusinessAppointmentsBySlug = async (req, res) => {
  try {
    const { date, providerId } = req.query;
    const whereClause = { businessId: req.business.id };

    if (date) {
      const startOfDay = new Date(`${date}T00:00:00.000Z`);
      const endOfDay = new Date(`${date}T23:59:59.999Z`);
      whereClause.dateTime = { gte: startOfDay, lte: endOfDay };
    }

    if (providerId) {
      whereClause.providerId = providerId;
    }

    const appointments = await prisma.appointment.findMany({
      where: whereClause,
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, phone: true },
        },
        provider: { select: { id: true, name: true, imageUrl: true } },
        service: {
          select: { id: true, name: true, price: true, durationMin: true },
        },
      },
      orderBy: { dateTime: "asc" },
    });

    res.json(appointments);
  } catch (error) {
    console.error("Error fetching business appointments by slug:", error);
    res.status(500).json({ error: "שגיאה בשליפת יומן התורים" });
  }
};

// שליפת הגדרות שעות פעילות לעסק שאותר לפי slug
exports.getBusinessSettingsBySlug = async (req, res) => {
  try {
    const business = await prisma.business.findUnique({
      where: { id: req.business.id },
      select: {
        openTime: true,
        closeTime: true,
        slotInterval: true,
        bookingOpenUntil: true,
      },
    });

    res.json({
      openTime: business?.openTime || "09:00",
      closeTime: business?.closeTime || "19:30",
      slotInterval: Number(business?.slotInterval) || 30,
      bookingOpenUntil: business?.bookingOpenUntil || null,
    });
  } catch (error) {
    console.error("Error fetching business settings by slug:", error);
    res.status(500).json({ error: "שגיאה בשליפת הגדרות העסק" });
  }
};

// שליפת ימים חסומים לעסק שאותר לפי slug
exports.getBlockedDaysBySlug = async (req, res) => {
  try {
    const { date } = req.query;
    const whereClause = { businessId: req.business.id };
    if (date) whereClause.date = date;

    const blockedDays = await prisma.blockedDay.findMany({
      where: whereClause,
      include: {
        provider: { select: { id: true, name: true } },
      },
    });

    res.json(blockedDays);
  } catch (error) {
    console.error("Error fetching blocked days by slug:", error);
    res.status(500).json({ error: "שגיאה בשליפת ימים חסומים" });
  }
};

// שליפת הודעת שידור פעילה לעסק שאותר לפי slug
exports.getActiveBroadcastBySlug = async (req, res) => {
  try {
    const broadcast = await prisma.broadcast.findFirst({
      where: { businessId: req.business.id, isActive: true },
      orderBy: { createdAt: "desc" },
    });
    res.json(broadcast || null);
  } catch (error) {
    console.error("Error fetching active broadcast by slug:", error);
    res.status(500).json({ error: "שגיאה בשליפת הודעת מערכת" });
  }
};

// ==========================================
// 6. ניהול פרופיל העסק (Business Profile)
// ==========================================

// שליפת שירותים השייכים אך ורק לעסק שאותר לפי slug
exports.getBusinessServices = async (req, res) => {
  try {
    const services = await prisma.service.findMany({
      where: { businessId: req.business.id },
      orderBy: { price: "asc" },
    });
    res.json(services);
  } catch (error) {
    console.error("Error fetching business services:", error);
    res.status(500).json({ error: "שגיאה בשליפת שירותים" });
  }
};

// שליפת ספרים/אנשי צוות השייכים אך ורק לעסק שאותר לפי slug
exports.getBusinessProviders = async (req, res) => {
  try {
    const providers = await prisma.provider.findMany({
      where: { businessId: req.business.id },
      orderBy: { name: "asc" },
    });
    res.json(providers);
  } catch (error) {
    console.error("Error fetching business providers:", error);
    res.status(500).json({ error: "שגיאה בשליפת ספרים" });
  }
};

exports.getPublicProfile = (req, res) => {
  const b = req.business;
  res.json({
    id: b.id,
    slug: b.slug,
    name: b.name,
    address: b.address,
    description: b.description,
    logoUrl: b.logoUrl,
    phone: b.phone,
    whatsapp: b.whatsapp,
    instagram: b.instagram,
    tiktok: b.tiktok,
    openTime: b.openTime,
    closeTime: b.closeTime,
    slotInterval: b.slotInterval,
    bookingOpenUntil: b.bookingOpenUntil,
  });
};

// שליפת נתוני העסק כמו שהם ב-DB
exports.getBusinessProfile = async (req, res) => {
  try {
    const targetBusinessId = await getTargetBusinessId(req.user?.id);
    const business = targetBusinessId
      ? await prisma.business.findUnique({ where: { id: targetBusinessId } })
      : null;
    res.status(200).json(business || null);
  } catch (error) {
    console.error("Error fetching business profile:", error);
    res.status(500).json({ error: "שגיאה בשליפת נתוני העסק" });
  }
};

// ==========================================
// 7. הרשמת עסקים חדשים (Onboarding - שלב 6)
// ==========================================

// בדיקת זמינות slug בלייב (לטופס ההרשמה בפרונט)
exports.checkSlugAvailability = async (req, res) => {
  try {
    const { slug } = req.query;

    if (!slug || !isValidSlugFormat(slug)) {
      return res.json({ available: false, reason: "invalid" });
    }
    if (RESERVED_SLUGS.includes(slug)) {
      return res.json({ available: false, reason: "reserved" });
    }

    const existing = await prisma.business.findUnique({ where: { slug } });
    res.json({ available: !existing, reason: existing ? "taken" : undefined });
  } catch (error) {
    console.error("Error checking slug availability:", error);
    res.status(500).json({ error: "שגיאה בבדיקת זמינות הכתובת" });
  }
};

// יצירת עסק חדש למשתמש מחובר (הופך אותו ל-ADMIN) ומנפיק טוקן חדש
exports.registerBusiness = async (req, res) => {
  try {
    const userId = req.user?.userId;
    const { slug, name, address } = req.body;

    if (!slug || !name || !name.trim()) {
      return res.status(400).json({ error: "חסרים שם עסק וכתובת URL" });
    }
    if (!isValidSlugFormat(slug)) {
      return res.status(400).json({ error: "כתובת ה-URL אינה תקינה" });
    }
    if (RESERVED_SLUGS.includes(slug)) {
      return res.status(400).json({ error: "כתובת ה-URL הזו שמורה ואינה זמינה" });
    }

    // v1: כל owner מנהל עסק יחיד בלבד
    const existingBusiness = await prisma.business.findFirst({
      where: { ownerId: userId },
    });
    if (existingBusiness) {
      return res.status(400).json({ error: "כבר קיים עסק רשום תחת המשתמש שלך" });
    }

    let business;
    try {
      business = await prisma.business.create({
        data: { slug, name: name.trim(), address: address || null, ownerId: userId },
      });
    } catch (err) {
      // race condition: שני משתמשים תפסו את אותו slug בו-זמנית - ה-DB הוא קו ההגנה האמיתי
      if (err.code === "P2002") {
        return res.status(400).json({ error: "כתובת ה-URL הזו כבר תפוסה, נסה אחרת" });
      }
      throw err;
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { role: "ADMIN" },
    });

    // הטוקן הישן נושא role: "CLIENT" - חייבים להנפיק טוקן חדש כדי ש-requireAdmin יעבוד מעכשיו
    const token = jwt.sign(
      { userId: updatedUser.id, role: updatedUser.role },
      process.env.JWT_SECRET,
      { expiresIn: "30d" },
    );

    res.status(201).json({
      token,
      user: {
        id: updatedUser.id,
        phone: updatedUser.phone,
        firstName: updatedUser.firstName,
        lastName: updatedUser.lastName,
        role: updatedUser.role,
        isNewUser: false,
      },
      business,
    });
  } catch (error) {
    console.error("Error registering business:", error);
    res.status(500).json({ error: "שגיאה ברישום העסק" });
  }
};

// עדכון נתוני העסק ישירות ממה שהוזן בטופס
exports.updateBusinessProfile = async (req, res) => {
  try {
    const { name, address, phone, whatsapp, instagram, tiktok } = req.body;

    // req.business הוצמד ע"י resolveOwnedBusiness - קיומו כבר מובטח (אחרת 404 קרה קודם).
    // יצירת עסק ראשון למנהל חדש עברה לתהליך הרשמה ייעודי (שלב 6 בתוכנית), לא כאן יותר.
    const business = await prisma.business.update({
      where: { id: req.business.id },
      data: { name, address, phone, whatsapp, instagram, tiktok },
    });

    res.status(200).json({ message: "הפרופיל עודכן בהצלחה", business });
  } catch (error) {
    console.error("Error updating business profile:", error);
    res.status(500).json({ error: "שגיאה בעדכון הפרופיל" });
  }
};

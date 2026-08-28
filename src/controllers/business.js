const prisma = require("../config/prisma"); // ודא שזה הנתיב לקובץ ה-Prisma Client שלך

// פונקציית עזר למציאת ה-businessId הראשון/של המשתמש
const getTargetBusinessId = async (userId) => {
  const userBusiness = await prisma.business.findFirst({
    where: { ownerId: userId },
  });
  if (userBusiness) return userBusiness.id;

  const defaultBusiness = await prisma.business.findFirst();
  return defaultBusiness ? defaultBusiness.id : null;
};

// ==========================================
// 1. יומן תורים (Calendar & Operations)
// ==========================================

// שליפת יומן התורים לפי תאריך / ספר
exports.getBusinessAppointments = async (req, res) => {
  try {
    const { date, providerId } = req.query;
    const whereClause = {};

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

// עדכון סטטוס תור (PENDING, CONFIRMED, CANCELLED, COMPLETED)
exports.updateAppointmentStatus = async (req, res) => {
  try {
    const { id } = req.params;
    let { status } = req.body;

    if (typeof status === "string") {
      status = status.toUpperCase();
    }

    // התאמה למקרה שהפרונט שולח NO_SHOW (בסכמה קיים CANCELLED)
    if (status === "NO_SHOW") status = "CANCELLED";

    const validStatuses = ["PENDING", "CONFIRMED", "CANCELLED", "COMPLETED"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: "סטטוס תור לא חוקי" });
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

// קביעת תור ידני ע"י בעל העסק (Walk-in / טלפוני)
exports.createManualAppointment = async (req, res) => {
  try {
    const { clientName, clientPhone, providerId, serviceId, dateTime } =
      req.body;

    if (!providerId || !serviceId || !dateTime) {
      return res.status(400).json({ error: "חסרים פרטי חובה לקביעת התור" });
    }

    const provider = await prisma.provider.findUnique({
      where: { id: providerId },
    });

    if (!provider) {
      return res.status(404).json({ error: "ספר לא נמצא" });
    }

    // חיבור או יצירת משתמש זמני עבור התור הידני
    let userId = req.user?.id;
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
    userId = clientUser.id;

    // בדיקת תפיסות משבצת זמן
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
        userId,
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

/// חסימת טווח שעות בלבד)
exports.blockTimeRange = async (req, res) => {
  try {
    const { date, startTime, endTime, reason, providerId } = req.body;

    const currentUserId = req.user?.id || req.user?.userId;

    if (!date || !startTime || !endTime) {
      return res
        .status(400)
        .json({ error: "חובה לציין תאריך, שעת התחלה ושעת סיום" });
    }

    const businessId = await getTargetBusinessId(req.user?.id);
    if (!businessId) {
      return res.status(400).json({ error: "לא נמצא עסק מקושר" });
    }

    // מציאת או יצירת שירות מערכת פנימי עבור חסימות
    let blockService = await prisma.service.findFirst({
      where: { businessId, name: "חסום" },
    });

    if (!blockService) {
      blockService = await prisma.service.create({
        data: {
          name: reason ? `חסום: ${reason}` : "חסום",
          price: 0,
          durationMin: 30,
          businessId,
        },
      });
    }

    // בחירת הספר הספציפי או כל הצוות
    let targetProviders = [];
    if (providerId) {
      const p = await prisma.provider.findUnique({ where: { id: providerId } });
      if (p) targetProviders.push(p);
    } else {
      targetProviders = await prisma.provider.findMany({
        where: { businessId },
      });
    }

    const createdBlocks = [];
    const startHour = parseInt(startTime.split(":")[0], 10);
    const endHour = parseInt(endTime.split(":")[0], 10);

    for (let hour = startHour; hour < endHour; hour++) {
      for (const minute of [0, 30]) {
        const timeStr = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
        const blockDateTime = new Date(`${date}T${timeStr}.000Z`);

        for (const prov of targetProviders) {
          // מחיקת תור/חסימה קיימת במשבצת כדי למנוע כפילויות
          await prisma.appointment.deleteMany({
            where: {
              providerId: prov.id,
              dateTime: blockDateTime,
            },
          });

          // יצירת חסימה חדשה
          const blockApt = await prisma.appointment.create({
            data: {
              dateTime: blockDateTime,
              status: "CANCELLED",
              businessId,
              providerId: prov.id,
              serviceId: blockService.id,
              userId: currentUserId,
            },
          });
          createdBlocks.push(blockApt);
        }
      }
    }

    res
      .status(201)
      .json({ message: "טווח השעות נחסם בהצלחה", count: createdBlocks.length });
  } catch (error) {
    console.error("Error blocking time:", error);
    res.status(500).json({ error: "שגיאה בביצוע חסימת השעות" });
  }
};
// 1. שליפת חסימות יום (מוחזר יחד עם התורים או כשאילתה נפרדת)
exports.getBlockedDays = async (req, res) => {
  try {
    const { date } = req.query;
    const currentUserId = req.user?.id || req.user?.userId;
    const businessId = await getTargetBusinessId(currentUserId);

    if (!businessId) {
      return res.json([]);
    }

    const whereClause = { businessId };
    if (date) whereClause.date = date;

    const blockedDays = await prisma.blockedDay.findMany({
      where: whereClause,
      include: {
        provider: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json(blockedDays);
  } catch (error) {
    console.error("Error fetching blocked days:", error);
    res.status(500).json({ error: "שגיאה בשליפת ימי חופש" });
  }
};

/// יצירת חסימת יום (מטפל נכון גם בספר ספציפי וגם בכל העסק)
exports.blockFullDay = async (req, res) => {
  try {
    const { date, providerId, reason } = req.body;

    if (!date) {
      return res.status(400).json({ error: "חובה לציין תאריך" });
    }

    const currentUserId = req.user?.id || req.user?.userId;
    const businessId = await getTargetBusinessId(currentUserId);

    if (!businessId) {
      return res.status(400).json({ error: "לא נמצא עסק מקושר למשתמש" });
    }

    // נירמול providerId - אם ריק או לא הועבר, שומרים כ-null
    const targetProviderId =
      providerId && providerId.trim() !== "" ? providerId : null;

    // מחיקת חסימה קודמת קיימת לאותו תאריך וספר
    const whereDelete = {
      date,
      businessId,
    };
    if (targetProviderId) {
      whereDelete.providerId = targetProviderId;
    } else {
      whereDelete.providerId = null;
    }

    await prisma.blockedDay.deleteMany({
      where: whereDelete,
    });

    // יצירת רשומת חסימת היום
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

// 3. ביטול חסימת יום שלם
exports.unblockFullDay = async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.blockedDay.delete({
      where: { id },
    });

    res.json({ message: "חסימת היום בוטלה בהצלחה" });
  } catch (error) {
    console.error("Error unblocking day:", error);
    res.status(500).json({ error: "שגיאה בביטול חסימת היום" });
  }
};

// ביטול חסימת שעה בודדת (מחיקת רשומת התור החסום)
exports.unblockSingleAppointment = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: "מזהה חסימה חסר" });
    }

    await prisma.appointment.delete({
      where: { id },
    });

    res.json({ message: "החסימה בוטלה בהצלחה" });
  } catch (error) {
    console.error("Error deleting blocked slot:", error);
    res.status(500).json({ error: "שגיאה בביטול החסימה" });
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

    const businessId = await getTargetBusinessId(req.user?.id);
    if (!businessId) {
      return res.status(400).json({ error: "לא נמצא עסק מקושר" });
    }

    const service = await prisma.service.create({
      data: {
        name,
        price: parseFloat(price),
        durationMin: parseInt(durationMin, 10),
        businessId,
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

    const businessId = await getTargetBusinessId(req.user?.id);
    if (!businessId) {
      return res.status(400).json({ error: "לא נמצא עסק מקושר" });
    }

    const provider = await prisma.provider.create({
      data: {
        name,
        imageUrl: imageUrl || null,
        businessId,
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
// 4. סטטיסטיקה ודוחות (KPIs)
// ==========================================

exports.getBusinessStats = async (req, res) => {
  try {
    const today = new Date();
    const startOfToday = new Date(today.setHours(0, 0, 0, 0));
    const endOfToday = new Date(today.setHours(23, 59, 59, 999));

    // תורים של היום
    const todayAppointments = await prisma.appointment.findMany({
      where: {
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

    const totalClients = await prisma.user.count({
      where: { role: "CLIENT" },
    });

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

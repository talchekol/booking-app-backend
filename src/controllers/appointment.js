const prisma = require("../config/prisma");

// 1. קביעת תור חדש
const createAppointment = async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { dateTime, businessId, providerId, serviceId } = req.body;

    if (!dateTime || !businessId || !providerId || !serviceId) {
      return res.status(400).json({ error: "כל הפרטים הם חובה לקביעת תור" });
    }

    const parsedDateTime = new Date(dateTime);

    // בדיקה שלמשתמש אין כבר תור עתידי פעיל
    const existingUpcoming = await prisma.appointment.findFirst({
      where: {
        userId,
        status: "CONFIRMED",
        dateTime: { gte: new Date() },
      },
    });

    if (existingUpcoming) {
      return res.status(400).json({
        error: "כבר יש לך תור עתידי קבוע. יש לבטל אותו לפני קביעת תור חדש",
      });
    }

    // בדיקה שלספק הנבחר אין כבר תור קבוע באותו מועד בדיוק
    const conflictingAppointment = await prisma.appointment.findFirst({
      where: {
        providerId,
        status: "CONFIRMED",
        dateTime: parsedDateTime,
      },
    });

    if (conflictingAppointment) {
      return res
        .status(409)
        .json({
          error: "המועד הזה כבר תפוס אצל הספק הנבחר, יש לבחור מועד אחר",
        });
    }

    const appointment = await prisma.appointment.create({
      data: {
        dateTime: parsedDateTime,
        userId,
        businessId,
        providerId,
        serviceId,
        status: "CONFIRMED",
      },
      include: {
        provider: true,
        service: true,
        business: true,
      },
    });

    res.status(201).json(appointment);
  } catch (error) {
    console.error("Error creating appointment:", error);
    res.status(500).json({ error: "שגיאה ביצירת התור" });
  }
};

// 2. שליפת התור הקרוב של המשתמש + היסטוריית תורים
const getMyAppointments = async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;

    const appointments = await prisma.appointment.findMany({
      where: { userId },
      include: {
        provider: true,
        service: true,
        business: true,
      },
      orderBy: { dateTime: "asc" },
    });

    const now = new Date();
    const upcoming = appointments.find(
      (app) => new Date(app.dateTime) >= now && app.status !== "CANCELLED",
    );
    const history = appointments.filter(
      (app) => new Date(app.dateTime) < now || app.status === "CANCELLED",
    );

    res.status(200).json({
      upcoming: upcoming || null,
      history,
    });
  } catch (error) {
    console.error("Error fetching my appointments:", error);
    res.status(500).json({ error: "שגיאה בשליפת התורים" });
  }
};

// 3. ביטול תור
const cancelAppointment = async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { appointmentId } = req.params;

    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
    });

    if (!appointment || appointment.userId !== userId) {
      return res
        .status(404)
        .json({ error: "התור לא נמצא או שאינך מורשה לבטלו" });
    }

    const updated = await prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        status: "CANCELLED",
        isUpForSwap: false,
      },
    });

    // הסרת הצעות פתוחות משוק ההחלפות במידה והיו
    await prisma.swapOffer.deleteMany({
      where: { appointmentId },
    });

    res.status(200).json({ message: "התור בוטל בהצלחה", appointment: updated });
  } catch (error) {
    console.error("Error cancelling appointment:", error);
    res.status(500).json({ error: "שגיאה בביטול התור" });
  }
};

// 4. העלאת / הורדת תור משוק ההחלפות
const toggleSwapOffer = async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { appointmentId } = req.body;

    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
    });

    if (!appointment || appointment.userId !== userId) {
      return res.status(404).json({ error: "התור לא נמצא" });
    }

    if (appointment.status !== "CONFIRMED") {
      return res
        .status(400)
        .json({ error: "ניתן להציע להחלפה רק תור מאושר ופעיל" });
    }

    const newSwapState = !appointment.isUpForSwap;

    await prisma.$transaction(async (tx) => {
      await tx.appointment.update({
        where: { id: appointmentId },
        data: { isUpForSwap: newSwapState },
      });

      if (newSwapState) {
        await tx.swapOffer.create({
          data: { appointmentId },
        });
      } else {
        await tx.swapOffer.deleteMany({
          where: { appointmentId },
        });
      }
    });

    res.status(200).json({ isUpForSwap: newSwapState });
  } catch (error) {
    console.error("Error toggling swap offer:", error);
    res.status(500).json({ error: "שגיאה בעדכון הצעת ההחלפה" });
  }
};

// 5. שליפת כל התורים המוצעים להחלפה (שוק ההחלפות)
const getAvailableSwaps = async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;

    const offers = await prisma.swapOffer.findMany({
      where: {
        appointment: {
          userId: { not: userId },
          dateTime: { gte: new Date() },
          status: "CONFIRMED",
        },
      },
      include: {
        appointment: {
          include: {
            user: { select: { id: true, firstName: true, phone: true } },
            provider: { select: { id: true, name: true, imageUrl: true } },
            service: {
              select: { id: true, name: true, price: true, durationMin: true },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json(offers);
  } catch (error) {
    console.error("Error fetching available swaps:", error);
    res.status(500).json({ error: "שגיאה בשליפת שוק ההחלפות" });
  }
};

// 6. שליחת בקשת החלפה עבור הצעה בשוק
const requestSwap = async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { swapOfferId, offeredAppointmentId } = req.body;

    if (!swapOfferId || !offeredAppointmentId) {
      return res.status(400).json({ error: "יש לבחור הצעה ותור להחלפה" });
    }

    const swapOffer = await prisma.swapOffer.findUnique({
      where: { id: swapOfferId },
      include: { appointment: true },
    });

    if (!swapOffer) {
      return res.status(404).json({ error: "ההצעה לא נמצאה או שהוסרה" });
    }

    if (swapOffer.appointment.userId === userId) {
      return res.status(400).json({ error: "לא ניתן לבקש החלפה עם התור שלך" });
    }

    const offeredAppointment = await prisma.appointment.findUnique({
      where: { id: offeredAppointmentId },
    });

    if (!offeredAppointment || offeredAppointment.userId !== userId) {
      return res.status(404).json({ error: "התור שברצונך להציע לא נמצא" });
    }

    if (!offeredAppointment.isUpForSwap) {
      return res
        .status(400)
        .json({ error: "עליך להציע את התור שלך להחלפה תחילה" });
    }

    const existing = await prisma.swapRequest.findFirst({
      where: { swapOfferId, requesterId: userId, status: "PENDING" },
    });

    if (existing) {
      return res.status(400).json({ error: "כבר שלחת בקשת החלפה עבור תור זה" });
    }

    const swapRequest = await prisma.swapRequest.create({
      data: {
        swapOfferId,
        requesterId: userId,
        ownerId: swapOffer.appointment.userId,
        offeredAppointmentId,
        ownerAppointmentId: swapOffer.appointmentId,
      },
    });

    res.status(201).json(swapRequest);
  } catch (error) {
    console.error("Error creating swap request:", error);
    res.status(500).json({ error: "שגיאה בשליחת בקשת ההחלפה" });
  }
};

// 7. שליפת בקשות ההחלפה שלי (כולל מאושרות אחרונות)
const getMySwapRequests = async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;

    const [incoming, outgoing] = await Promise.all([
      prisma.swapRequest.findMany({
        where: { ownerId: userId },
        include: {
          requester: { select: { id: true, firstName: true, phone: true } },
          offeredAppointment: {
            include: { service: true, provider: true },
          },
          ownerAppointment: {
            include: { service: true, provider: true },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      prisma.swapRequest.findMany({
        where: { requesterId: userId },
        include: {
          owner: { select: { id: true, firstName: true, phone: true } },
          offeredAppointment: {
            include: { service: true, provider: true },
          },
          ownerAppointment: {
            include: { service: true, provider: true },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
    ]);

    res.status(200).json({ incoming, outgoing });
  } catch (error) {
    console.error("Error fetching swap requests:", error);
    res.status(500).json({ error: "שגיאה בשליפת בקשות ההחלפה" });
  }
};

// 8. אישור בקשת החלפה - החלפת בעלים אטומית ומדויקת
const approveSwapRequest = async (req, res) => {
  try {
    const currentUserId = req.user.userId || req.user.id;
    const { requestId } = req.params;

    const swapRequest = await prisma.swapRequest.findUnique({
      where: { id: requestId },
      include: {
        ownerAppointment: true,
        offeredAppointment: true,
      },
    });

    if (!swapRequest || swapRequest.status !== "PENDING") {
      return res
        .status(404)
        .json({ error: "בקשת ההחלפה לא נמצאה או שכבר טופלה" });
    }

    const apptA = swapRequest.ownerAppointment; // התור של המאשר
    const apptB = swapRequest.offeredAppointment; // התור של המבקש

    if (!apptA || !apptB) {
      return res.status(400).json({ error: "אחד התורים לא נמצא במערכת" });
    }

    if (swapRequest.ownerId !== currentUserId) {
      return res.status(403).json({ error: "אינך מורשה לאשר בקשה זו" });
    }

    const userA_Id = apptA.userId;
    const userB_Id = apptB.userId;

    await prisma.$transaction([
      // 1. עדכון סטטוס הבקשה למאושרת
      prisma.swapRequest.update({
        where: { id: swapRequest.id },
        data: { status: "APPROVED" },
      }),

      // 2. תור A עובר ישירות למשתמש B
      prisma.appointment.update({
        where: { id: apptA.id },
        data: {
          userId: userB_Id,
          isUpForSwap: false,
        },
      }),

      // 3. תור B עובר ישירות למשתמש A
      prisma.appointment.update({
        where: { id: apptB.id },
        data: {
          userId: userA_Id,
          isUpForSwap: false,
        },
      }),

      // 4. מחיקת ההצעות משוק ההחלפות
      prisma.swapOffer.deleteMany({
        where: {
          appointmentId: { in: [apptA.id, apptB.id] },
        },
      }),

      // 5. מחיקת שאר הבקשות הממתינות המקבילות
      prisma.swapRequest.deleteMany({
        where: {
          id: { not: swapRequest.id },
          status: "PENDING",
          OR: [
            { offeredAppointmentId: { in: [apptA.id, apptB.id] } },
            { ownerAppointmentId: { in: [apptA.id, apptB.id] } },
          ],
        },
      }),
    ]);

    res.status(200).json({ message: "ההחלפה בוצעה בהצלחה!" });
  } catch (error) {
    console.error("Error approving swap request:", error);
    res.status(500).json({ error: "שגיאה בביצוע ההחלפה" });
  }
};

// 9. דחיית / ביטול בקשת החלפה
const rejectSwapRequest = async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { requestId } = req.params;

    const swapRequest = await prisma.swapRequest.findUnique({
      where: { id: requestId },
    });

    if (!swapRequest || swapRequest.status !== "PENDING") {
      return res
        .status(404)
        .json({ error: "בקשת ההחלפה לא נמצאה או שכבר טופלה" });
    }

    const isOwner = swapRequest.ownerId === userId;
    const isRequester = swapRequest.requesterId === userId;

    if (!isOwner && !isRequester) {
      return res.status(403).json({ error: "אינך מורשה לבטל בקשה זו" });
    }

    await prisma.swapRequest.update({
      where: { id: requestId },
      data: { status: isRequester ? "CANCELLED" : "REJECTED" },
    });

    res.status(200).json({ message: "הבקשה עודכנה" });
  } catch (error) {
    console.error("Error rejecting swap request:", error);
    res.status(500).json({ error: "שגיאה בעדכון בקשת ההחלפה" });
  }
};

module.exports = {
  createAppointment,
  getMyAppointments,
  cancelAppointment,
  toggleSwapOffer,
  getAvailableSwaps,
  requestSwap,
  getMySwapRequests,
  approveSwapRequest,
  rejectSwapRequest,
};

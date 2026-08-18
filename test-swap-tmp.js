const { chromium } = require("playwright");
const BACKEND_DIR = "c:/Users/טל צ'קול/Desktop/Booking App/booking-app-backend";
require("dotenv").config({ path: BACKEND_DIR + "/.env" });
const prisma = require(BACKEND_DIR + "/src/config/prisma");

const API = "http://localhost:5000";
const APP = "http://localhost:5173";

const PHONE_A = "0507954707"; // existing real user (טל) - already has an appt offered for swap
const PHONE_B = "0509990001"; // throwaway test user created for this test

async function loginViaApi(phone) {
  await fetch(`${API}/auth/send-sms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone }),
  });
  const verification = await prisma.verificationCode.findFirst({
    where: { phone },
    orderBy: { createdAt: "desc" },
  });
  if (!verification) throw new Error("No verification code found for " + phone);

  const res = await fetch(`${API}/auth/verify-sms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, code: verification.code }),
  });
  const data = await res.json();
  if (!data.token) throw new Error("Login failed for " + phone + ": " + JSON.stringify(data));
  return data; // { token, user }
}

async function bootstrapSession(context, loginData) {
  const page = await context.newPage();
  await page.goto(APP);
  await page.evaluate((d) => {
    localStorage.setItem("token", d.token);
    localStorage.setItem("user", JSON.stringify(d.user));
  }, loginData);
  await page.reload();
  await page.waitForSelector("text=שלום", { timeout: 15000 });
  return page;
}

(async () => {
  let createdUserBId = null;
  let originalApptA = null;
  let createdApptBId = null;

  try {
    console.log("== Step 1: capture original state of user A's appointment ==");
    originalApptA = await prisma.appointment.findFirst({
      where: { isUpForSwap: true },
      include: { user: true },
    });
    console.log("User A's swap-offered appointment:", originalApptA?.id, "owner:", originalApptA?.user?.phone);

    console.log("== Step 2: log in both users via real SMS-code API flow ==");
    const loginA = await loginViaApi(PHONE_A);
    const loginB = await loginViaApi(PHONE_B);
    createdUserBId = loginB.user.id;
    console.log("User A:", loginA.user.firstName, loginA.user.id);
    console.log("User B (test):", loginB.user.id, loginB.user.isNewUser);

    const browser = await chromium.launch({ headless: true });
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();

    const pageA = await bootstrapSession(ctxA, loginA);
    console.log("User A session bootstrapped, home loaded.");

    // If user B is new, complete registration via API directly (skip UI step 3)
    if (loginB.user.isNewUser) {
      const updRes = await fetch(`${API}/users/profile`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${loginB.token}`,
        },
        body: JSON.stringify({ firstName: "בדיקה", lastName: "אוטומטית" }),
      });
      const updData = await updRes.json();
      loginB.user = { ...loginB.user, firstName: "בדיקה", lastName: "אוטומטית", isNewUser: false };
      console.log("Completed registration for test user B:", updData?.firstName || updData);
    }

    const pageB = await bootstrapSession(ctxB, loginB);
    console.log("User B session bootstrapped, home loaded.");

    console.log("== Step 3: user B books a new appointment via the real UI flow ==");
    await pageB.click("text=קבע תור חדש");
    await pageB.waitForSelector("text=בחר שירות");
    await pageB.click(".service-card >> nth=0");

    await pageB.waitForSelector("text=בחר ספר");
    await pageB.click(".barber-card >> nth=1"); // pick a named barber, not "any"

    await pageB.waitForSelector("text=בחר תאריך ושעה");
    await pageB.click(".date-card >> nth=2"); // a few days out to avoid clashing with existing appts
    await pageB.click(".time-slot-btn >> nth=3");
    await pageB.click("text=המשך לאישור פרטים");

    await pageB.waitForSelector("text=אישור פרטי תור");
    await pageB.click("text=אשר קביעת תור");

    await pageB.waitForSelector("text=התור נקבע בהצלחה", { timeout: 15000 });
    console.log("User B: appointment booked successfully.");
    await pageB.click("text=חזור לדף הבית");

    console.log("== Step 4: user B offers the new appointment for swap ==");
    await pageB.waitForSelector("text=הצע להחלפה");
    await pageB.click("text=הצע להחלפה");
    await pageB.waitForSelector("text=ביטול החלפה", { timeout: 10000 });
    console.log("User B: appointment is now up for swap.");
    await pageB.screenshot({ path: __dirname + "/shot-1-userB-offer.png" });

    // find B's new appointment id for cleanup later
    const apptB = await prisma.appointment.findFirst({
      where: { userId: createdUserBId, isUpForSwap: true },
      orderBy: { createdAt: "desc" },
    });
    createdApptBId = apptB?.id;
    console.log("User B's offered appointment id:", createdApptBId);

    console.log("== Step 5: user A browses the market and requests a swap with user B ==");
    await pageA.click("text=החלפות");
    await pageA.waitForSelector("text=שוק החלפות תורים");
    await pageA.waitForSelector("text=תספורת גברים", { timeout: 10000 }); // wait for market list to load
    await pageA.screenshot({ path: __dirname + "/shot-2-userA-market.png" });

    const requestBtn = pageA.locator(".request-swap-btn:not(.pending)").first();
    await requestBtn.waitFor({ state: "visible", timeout: 10000 });
    await requestBtn.click();

    await pageA.waitForSelector("text=אישור בקשת החלפה");
    await pageA.screenshot({ path: __dirname + "/shot-3-userA-confirm-swap.png" });
    await pageA.click("text=אשר וחכה לאישור");

    await pageA.waitForSelector("text=מחכה לאישור", { timeout: 10000 });
    console.log("User A: swap request sent, showing pending state.");

    console.log("== Step 6: user B sees the incoming request and approves it ==");
    await pageB.click("text=החלפות");
    await pageB.waitForSelector("text=בקשות החלפה שקיבלת", { timeout: 15000 });
    await pageB.screenshot({ path: __dirname + "/shot-4-userB-incoming.png" });

    await pageB.click(".approve-request-btn >> nth=0");
    await pageB.waitForTimeout(2000); // let the approve call + refresh settle
    await pageB.screenshot({ path: __dirname + "/shot-5-userB-after-approve.png" });

    console.log("== Step 7: verify in the DB that ownership actually swapped ==");
    const targetAppt = await prisma.appointment.findUnique({ where: { id: originalApptA.id } });
    const offeredAppt = await prisma.appointment.findUnique({ where: { id: createdApptBId } });

    console.log("Original A-appt (", originalApptA.id, ") now belongs to userId:", targetAppt.userId, "expected:", createdUserBId, "MATCH:", targetAppt.userId === createdUserBId);
    console.log("B's new appt (", createdApptBId, ") now belongs to userId:", offeredAppt.userId, "expected:", originalApptA.userId, "MATCH:", offeredAppt.userId === originalApptA.userId);
    console.log("Both isUpForSwap now false:", targetAppt.isUpForSwap === false && offeredAppt.isUpForSwap === false);

    const leftoverOffers = await prisma.swapOffer.count({ where: { appointmentId: { in: [originalApptA.id, createdApptBId] } } });
    console.log("Leftover SwapOffers for these two appts (should be 0):", leftoverOffers);

    await browser.close();

    console.log("\n=== TEST RESULT ===");
    if (targetAppt.userId === createdUserBId && offeredAppt.userId === originalApptA.userId && leftoverOffers === 0) {
      console.log("SUCCESS: swap flow works end-to-end.");
    } else {
      console.log("FAILURE: ownership did not swap as expected.");
    }
  } catch (err) {
    console.error("TEST ERROR:", err);
  } finally {
    console.log("\n== Cleanup: restoring DB to pre-test state ==");
    try {
      if (originalApptA) {
        await prisma.appointment.update({
          where: { id: originalApptA.id },
          data: { userId: originalApptA.userId, isUpForSwap: true, status: originalApptA.status },
        });
        console.log("Restored original appointment", originalApptA.id, "back to user A with isUpForSwap=true.");
      }
      if (createdApptBId) {
        await prisma.swapRequest.deleteMany({ where: { OR: [{ offeredAppointmentId: createdApptBId }, { swapOffer: { appointmentId: createdApptBId } }] } });
        await prisma.swapOffer.deleteMany({ where: { appointmentId: createdApptBId } });
        await prisma.appointment.delete({ where: { id: createdApptBId } }).catch(() => {});
        console.log("Deleted test appointment", createdApptBId);
      }
      if (createdUserBId) {
        await prisma.swapRequest.deleteMany({ where: { requesterId: createdUserBId } });
        await prisma.appointment.deleteMany({ where: { userId: createdUserBId } });
        await prisma.user.delete({ where: { id: createdUserBId } }).catch(() => {});
        console.log("Deleted test user B:", createdUserBId);
      }
      await prisma.verificationCode.deleteMany({ where: { phone: { in: [PHONE_A, PHONE_B] } } });
    } catch (cleanupErr) {
      console.error("CLEANUP ERROR (manual check may be needed):", cleanupErr);
    } finally {
      await prisma.$disconnect();
    }
  }
})();

require("dotenv").config();
const prisma = require("./src/config/prisma");

async function main() {
  // 1. יצירת משתמש בעל עסק לדוגמה
  const owner = await prisma.user.upsert({
    where: { phone: "0500000000" },
    update: {},
    create: {
      phone: "0500000000",
      firstName: "ישראל",
      lastName: "הספר",
      role: "ADMIN",
      isVerified: true,
    },
  });

  // 2. יצירת עסק
  const business = await prisma.business.create({
    data: {
      name: "מספרת בוטיק",
      address: "הרצל 45, תל אביב",
      ownerId: owner.id,
    },
  });

  // 3. יצירת מעניק שירות (ספר)
  const provider = await prisma.provider.create({
    data: {
      name: "אורן לוי",
      businessId: business.id,
      imageUrl:
        "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150",
    },
  });

  // 4. יצירת שירות
  const service = await prisma.service.create({
    data: {
      name: "תספורת גברים",
      price: 80,
      durationMin: 30,
      businessId: business.id,
    },
  });

  console.log("✨ Seed completed successfully!");
  console.log({
    businessId: business.id,
    providerId: provider.id,
    serviceId: service.id,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

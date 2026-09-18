require("dotenv").config();
const prisma = require("./src/config/prisma");

// יוצר (או מוודא קיום) עסק מלא: owner + business (לפי slug ייחודי) + provider + service.
// אידמפוטנטי: אפשר להריץ שוב ושוב בלי ליצור כפילויות.
async function ensureBusiness({
  ownerPhone,
  ownerFirstName,
  ownerLastName,
  businessName,
  slug,
  address,
  providerName,
  providerImageUrl,
  serviceName,
  servicePrice,
  serviceDurationMin,
}) {
  const owner = await prisma.user.upsert({
    where: { phone: ownerPhone },
    update: {},
    create: {
      phone: ownerPhone,
      firstName: ownerFirstName,
      lastName: ownerLastName,
      role: "ADMIN",
      isVerified: true,
    },
  });

  const business = await prisma.business.upsert({
    where: { slug },
    update: {},
    create: {
      name: businessName,
      slug,
      address,
      ownerId: owner.id,
    },
  });

  const existingProvider = await prisma.provider.findFirst({
    where: { businessId: business.id },
  });
  const provider =
    existingProvider ||
    (await prisma.provider.create({
      data: {
        name: providerName,
        businessId: business.id,
        imageUrl: providerImageUrl,
      },
    }));

  const existingService = await prisma.service.findFirst({
    where: { businessId: business.id },
  });
  const service =
    existingService ||
    (await prisma.service.create({
      data: {
        name: serviceName,
        price: servicePrice,
        durationMin: serviceDurationMin,
        businessId: business.id,
      },
    }));

  return { owner, business, provider, service };
}

async function main() {
  const tal = await ensureBusiness({
    ownerPhone: "0500000000",
    ownerFirstName: "ישראל",
    ownerLastName: "הספר",
    businessName: "מספרת טל",
    slug: "tal-barber",
    address: "הרצל 45, תל אביב",
    providerName: "אורן לוי",
    providerImageUrl:
      "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150",
    serviceName: "תספורת גברים",
    servicePrice: 80,
    serviceDurationMin: 30,
  });

  const second = await ensureBusiness({
    ownerPhone: "0500000002",
    ownerFirstName: "דנה",
    ownerLastName: "כהן",
    businessName: "מספרת דנה",
    slug: "second-barber",
    address: "ביאליק 10, רמת גן",
    providerName: "דנה כהן",
    providerImageUrl:
      "https://images.unsplash.com/photo-1580618672591-eb180b1a973f?w=150",
    serviceName: "תספורת נשים",
    servicePrice: 120,
    serviceDurationMin: 45,
  });

  console.log("✨ Seed completed successfully!");
  console.log({
    talBarber: {
      businessId: tal.business.id,
      slug: tal.business.slug,
      providerId: tal.provider.id,
      serviceId: tal.service.id,
    },
    secondBarber: {
      businessId: second.business.id,
      slug: second.business.slug,
      providerId: second.provider.id,
      serviceId: second.service.id,
    },
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

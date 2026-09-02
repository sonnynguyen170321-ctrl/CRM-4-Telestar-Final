import { prisma } from "./lib/server/prisma";

async function main() {
  try {
    const a = await prisma.v2ClientAccount.findFirst({
      where: { id: "cmqi9qifz0003ggeqg6ya18at", organizationId: "org_123", status: "ACTIVE" },
    });
    console.log("Account:", a);
  } catch (e) {
    console.error("Error:", (e as Error).message);
  }
}

main();

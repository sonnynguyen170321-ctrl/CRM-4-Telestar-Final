export const runtime = "nodejs";

const serviceName = "telestar-company-filter";

export async function GET() {
  const timestamp = new Date().toISOString();

  try {
    const { prisma } = await import("@/lib/server/prisma");

    await prisma.$queryRaw`SELECT 1`;

    return Response.json({
      status: "ok",
      service: serviceName,
      timestamp,
      database: "ok",
    });
  } catch (error) {
    console.error(error);

    return Response.json(
      {
        status: "error",
        service: serviceName,
        timestamp,
        database: "error",
      },
      { status: 503 }
    );
  }
}

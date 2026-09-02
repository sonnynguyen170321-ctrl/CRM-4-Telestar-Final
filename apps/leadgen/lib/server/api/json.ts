import type { Prisma } from "@/app/generated/prisma/client";

export function toPrismaJsonObject(
  value: Record<string, unknown> | undefined
): Prisma.InputJsonObject | undefined {
  return value === undefined ? undefined : (value as Prisma.InputJsonObject);
}

export function toRequiredPrismaJsonObject(
  value: Record<string, unknown> | undefined
): Prisma.InputJsonObject {
  return (value ?? {}) as Prisma.InputJsonObject;
}

export function toPrismaJsonValue(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

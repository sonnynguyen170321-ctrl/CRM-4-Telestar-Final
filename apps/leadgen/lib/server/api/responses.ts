import { NextResponse } from "next/server";
import { ZodError } from "zod";

export type Pagination = {
  page: number;
  pageSize: number;
  total: number;
};

export function ok<T>(data: T) {
  return NextResponse.json({ data });
}

export function listOk<T>(data: T[], pagination: Pagination) {
  return NextResponse.json({ data, pagination });
}

export function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export function validationError(error: ZodError) {
  const firstIssue = error.issues[0];
  return errorResponse(firstIssue?.message ?? "Invalid request body.", 400);
}

export function serverError(error: unknown) {
  console.error(error);
  return errorResponse("Unexpected server error.", 500);
}

export function parsePagination(searchParams: URLSearchParams) {
  const page = parseBoundedInt(searchParams.get("page"), 1, 1, 100000);
  const pageSize = parseBoundedInt(searchParams.get("pageSize"), 50, 1, 100);

  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
  };
}

function parseBoundedInt(
  value: string | null,
  fallback: number,
  min: number,
  max: number
) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, min), max);
}

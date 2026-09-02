import { NextResponse } from "next/server";

import { revokeCurrentAuthSession } from "@/lib/v2/auth";

export async function GET(request: Request) {
  await revokeCurrentAuthSession();
  return NextResponse.redirect(new URL("/v2/login", request.url));
}
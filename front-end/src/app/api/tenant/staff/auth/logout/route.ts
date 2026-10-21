import { NextResponse } from "next/server";
import {
  getTenantStaffCookieName,
  tenantStaffCookieOptions,
} from "@/lib/server/session";
import { isSameOrigin } from "@/lib/server/http";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }
  const response = new NextResponse(null, {
    status: 303,
    headers: { Location: "/en/tenant/staff/login" },
  });
  response.cookies.set(getTenantStaffCookieName(), "", {
    ...tenantStaffCookieOptions(),
    maxAge: 0,
  });
  return response;
}

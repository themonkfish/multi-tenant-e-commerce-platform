import { NextResponse } from "next/server";
import {
  customerCookieOptions,
  getCustomerCookieName,
} from "@/lib/server/session";
import { isSameOrigin } from "@/lib/server/http";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }
  const response = new NextResponse(null, {
    status: 303,
    headers: { Location: "/en/account" },
  });
  response.cookies.set(getCustomerCookieName(), "", {
    ...customerCookieOptions(),
    maxAge: 0,
  });
  return response;
}

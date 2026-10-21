import { NextResponse } from "next/server";
import { canAccessPermission } from "@/core/tenancy/scope";
import { getPlatformStore } from "@/lib/server/platform";
import { getCustomerSession } from "@/lib/server/session";

export async function GET() {
  const session = await getCustomerSession();
  if (!session || session.scope.kind !== "tenant") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canAccessPermission(session, "customer:orders:read")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const orders = await getPlatformStore().listCustomerOrders(
    session.scope.id,
    session.userId,
  );
  return NextResponse.json({ data: orders });
}

import "server-only";
import { headers } from "next/headers";
import { resolveRequestScope } from "@/core/tenancy/request-scope";
import { getPlatformStore } from "./platform";

export async function getRequestDomainScope() {
  const requestHeaders = await headers();
  return resolveRequestScope(requestHeaders.get("host"), getPlatformStore());
}

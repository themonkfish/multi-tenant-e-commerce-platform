import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { canAccessPermission } from "@/core/tenancy/scope";
import { createRateLimitKey, isSameOrigin } from "@/lib/server/http";
import { getPlatformStore } from "@/lib/server/platform";
import { getTenantOwnerSession } from "@/lib/server/session";

export async function POST(request: Request) {
  const session = await getTenantOwnerSession();
  if (!session || session.scope.kind !== "tenant") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canAccessPermission(session, "settings:read")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }
  const tenantScope = session.scope;
  if (tenantScope.kind !== "tenant") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const store = getPlatformStore();
  const allowed = await store.consumeRateLimit({
    key: createRateLimitKey(request, "tenant-data-export", session.userId),
    limit: 3,
    windowMs: 60 * 60 * 1000,
    now: Date.now(),
  });
  if (!allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const tenants = await store.listTenantsForHost(tenantScope.hostId);
  const tenant = tenants.find(
    (candidate) =>
      candidate.id === tenantScope.id &&
      candidate.hostId === tenantScope.hostId,
  );
  if (!tenant) {
    return NextResponse.json({ error: "tenant_not_found" }, { status: 404 });
  }

  const [settings, staff, owner, rest, database, storage, orders, auditEvents] =
    await Promise.all([
      store.getTenantStoreSettings(tenant.id, tenant.hostId, tenant.name),
      store.listTenantStaff(tenant.id),
      store.getTenantOwnerByTenant(tenant.id),
      store.getTenantRestConnection(tenant.id, tenant.hostId),
      store.getTenantDatabaseProvider(tenant.id, tenant.hostId),
      store.getTenantStorageProvider(tenant.id, tenant.hostId),
      store.listTenantOrders(tenant.id),
      store.listAuditEvents({ scope: tenantScope, limit: 1000 }),
    ]);

  const now = new Date().toISOString();
  await store.appendAuditEvent({
    id: randomUUID(),
    actorId: session.userId,
    scope: tenantScope,
    action: "tenant.data.exported",
    resourceType: "tenant_export",
    resourceId: tenant.id,
    createdAt: now,
  });

  const restConnection = rest
    ? {
        type: "rest",
        baseUrl: rest.baseUrl,
        apiVersion: rest.apiVersion,
      }
    : null;
  const databaseConnection = database
    ? database.type === "supabase"
      ? {
          type: "supabase",
          projectUrl: database.projectUrl,
          schema: database.schema,
          tenancyMode: database.tenancyMode,
        }
      : {
          type: "mongodb",
          dbName: database.dbName,
          tenancyMode: database.tenancyMode,
        }
    : null;
  const storageConnection = storage
    ? {
        type: storage.type,
        ...(storage.type === "s3"
          ? {
              endpoint: storage.endpoint,
              region: storage.region,
              bucket: storage.bucket,
              publicBaseUrl: storage.publicBaseUrl,
              pathStyle: storage.pathStyle,
            }
          : {}),
      }
    : null;

  const body = JSON.stringify(
    {
      exportedAt: now,
      tenant,
      owner: owner
        ? {
            id: owner.id,
            email: owner.email,
            createdAt: owner.createdAt,
          }
        : null,
      settings,
      staff,
      connections: {
        rest: restConnection,
        database: databaseConnection,
        storage: storageConnection,
      },
      orders,
      auditEvents,
    },
    null,
    2,
  );
  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="tenant-${tenant.slug}-export.json"`,
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
    },
  });
}

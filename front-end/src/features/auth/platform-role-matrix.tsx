import {
  PermissionSchema,
  PrincipalRoleSchema,
  ROLE_PERMISSIONS,
  type Permission,
  type PrincipalRole,
} from "@/core/tenancy/scope";

const ROLE_LABELS: Record<PrincipalRole, string> = {
  super_admin: "Super Admin",
  host_owner: "Host Owner",
  tenant_owner: "Tenant Owner",
  tenant_staff: "Tenant Staff",
  customer: "Customer",
};

export function PlatformRoleMatrix() {
  const roles = PrincipalRoleSchema.options;
  const permissions = PermissionSchema.options;

  return (
    <section aria-labelledby="platform-roles-heading" className="space-y-4">
      <div>
        <h2 id="platform-roles-heading" className="text-xl font-semibold">
          Staff and role permissions
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Effective role-to-permission matrix enforced by server scope checks.
          Tenant Staff accounts are managed inside each tenant portal.
        </p>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-3 font-medium" scope="col">
                Permission
              </th>
              {roles.map((role) => (
                <th className="px-4 py-3 font-medium" key={role} scope="col">
                  {ROLE_LABELS[role]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {permissions.map((permission) => (
              <tr key={permission}>
                <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">
                  {permission}
                </td>
                {roles.map((role) => (
                  <td className="px-4 py-3 text-center" key={role}>
                    {(ROLE_PERMISSIONS[role] as readonly Permission[]).includes(
                      permission,
                    ) ? (
                      <span
                        aria-label={`${ROLE_LABELS[role]} can ${permission}`}
                        className="text-emerald-700"
                      >
                        Allowed
                      </span>
                    ) : (
                      <span
                        aria-label={`${ROLE_LABELS[role]} cannot ${permission}`}
                        className="text-slate-400"
                      >
                        -
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

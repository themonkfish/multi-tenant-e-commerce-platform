import {
  PermissionSchema,
  PrincipalRoleSchema,
  ROLE_PERMISSIONS,
  type Permission,
} from "@/core/tenancy/scope";
import { useTranslations } from "next-intl";

export function PlatformRoleMatrix() {
  const t = useTranslations("SuperAdminOperations");
  const roles = PrincipalRoleSchema.options;
  const permissions = PermissionSchema.options;

  return (
    <section aria-labelledby="platform-roles-heading" className="space-y-4">
      <div>
        <h2 id="platform-roles-heading" className="text-xl font-semibold">
          {t("roleMatrixTitle")}
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          {t("roleMatrixDescription")}
        </p>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-3 font-medium" scope="col">
                {t("permission")}
              </th>
              {roles.map((role) => (
                <th className="px-4 py-3 font-medium" key={role} scope="col">
                  {t(`role_${role}`)}
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
                        aria-label={t("roleCanPermission", {
                          role: t(`role_${role}`),
                          permission,
                        })}
                        className="text-emerald-700"
                      >
                        {t("allowed")}
                      </span>
                    ) : (
                      <span
                        aria-label={t("roleCannotPermission", {
                          role: t(`role_${role}`),
                          permission,
                        })}
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

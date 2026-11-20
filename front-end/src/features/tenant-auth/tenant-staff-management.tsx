"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { TenantStaffPermissionSchema } from "@/core/domain/tenant-identities";
import { z } from "zod";

const StaffViewSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  permissions: z.array(TenantStaffPermissionSchema),
  active: z.boolean(),
  createdAt: z.iso.datetime(),
});
type StaffView = z.infer<typeof StaffViewSchema>;

export function TenantStaffManagement({
  initialStaff,
}: {
  initialStaff: StaffView[];
}) {
  const t = useTranslations("TenantStaff");
  const [staff, setStaff] = useState(initialStaff);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function updateStaff(
    staffId: string,
    update:
      { active: boolean } | { password: string } | { permissions: string[] },
  ) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/tenant/staff/${staffId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const code =
          typeof body === "object" && body !== null && "error" in body
            ? body.error
            : undefined;
        setError(
          code === "rate_limited"
            ? t("tooManyChanges")
            : code === "staff_not_found"
              ? t("staffNotFound")
              : t("staffUpdateFailed"),
        );
        return false;
      }
      if (
        typeof body !== "object" ||
        body === null ||
        !("staff" in body) ||
        typeof body.staff !== "object" ||
        body.staff === null
      ) {
        setError(t("invalidStaffResponse"));
        return false;
      }
      const parsedStaff = StaffViewSchema.safeParse(body.staff);
      if (!parsedStaff.success) {
        setError(t("invalidStaffResponse"));
        return false;
      }
      const updated = parsedStaff.data;
      setStaff((current) =>
        current.map((member) => (member.id === staffId ? updated : member)),
      );
      setNotice(
        "password" in update
          ? t("passwordReset")
          : "permissions" in update
            ? t("permissionsUpdated")
            : updated.active
              ? t("accountReactivated")
              : t("accountDisabled"),
      );
      return true;
    } catch {
      setError(t("requestUnavailable"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function updateStaffPermissions(
    staffId: string,
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const permissions = form.getAll("permissions").map(String);
    if (permissions.length === 0) {
      setError(t("permissionRequired"));
      setNotice("");
      return;
    }
    await updateStaff(staffId, { permissions });
  }

  async function deleteStaff(staffId: string) {
    if (!window.confirm(t("deleteConfirm"))) {
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/tenant/staff/${staffId}`, {
        method: "DELETE",
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const code =
          typeof body === "object" && body !== null && "error" in body
            ? body.error
            : undefined;
        setError(
          code === "rate_limited"
            ? t("tooManyChanges")
            : code === "staff_not_found"
              ? t("staffNotFound")
              : t("staffDeleteFailed"),
        );
        return;
      }
      setStaff((current) => current.filter((member) => member.id !== staffId));
      setNotice(t("accountDeleted"));
    } catch {
      setError(t("requestUnavailable"));
    } finally {
      setBusy(false);
    }
  }

  async function resetStaffPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const success = await updateStaff(String(formData.get("staffId")), {
      password: String(formData.get("password")),
    });
    if (success) form.reset();
  }

  async function createStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const permissions = form.getAll("permissions").map(String);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/tenant/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          password: form.get("password"),
          permissions,
        }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const code =
          typeof body === "object" && body !== null && "error" in body
            ? body.error
            : undefined;
        setError(
          code === "account_exists"
            ? t("accountExists")
            : code === "rate_limited"
              ? t("tooManyChanges")
              : t("staffCreateFailed"),
        );
        return;
      }
      if (
        typeof body !== "object" ||
        body === null ||
        !("staff" in body) ||
        typeof body.staff !== "object" ||
        body.staff === null
      ) {
        setError(t("invalidStaffResponse"));
        return;
      }
      const parsedStaff = StaffViewSchema.safeParse(body.staff);
      if (!parsedStaff.success) {
        setError(t("invalidStaffResponse"));
        return;
      }
      const created = parsedStaff.data;
      setStaff((current) =>
        [...current, created].sort((a, b) => a.email.localeCompare(b.email)),
      );
      event.currentTarget.reset();
      setNotice(t("accountCreated"));
    } catch {
      setError(t("requestUnavailable"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-5 rounded-lg border border-slate-200 bg-white p-5">
      <div>
        <h3 className="font-semibold">{t("staffTitle")}</h3>
        <p className="mt-1 text-sm text-slate-600">{t("staffDescription")}</p>
      </div>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={createStaff}>
        <label className="space-y-1 text-sm font-medium">
          {t("staffEmail")}
          <input
            className="w-full rounded-md border px-3 py-2"
            name="email"
            type="email"
            required
          />
        </label>
        <label className="space-y-1 text-sm font-medium">
          {t("initialPassword")}
          <input
            className="w-full rounded-md border px-3 py-2"
            name="password"
            type="password"
            minLength={14}
            maxLength={128}
            required
          />
        </label>
        <fieldset className="flex flex-wrap gap-4 text-sm sm:col-span-2">
          <legend className="mb-2 font-medium">{t("permissions")}</legend>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="permissions"
              value="catalog:read"
              defaultChecked
            />
            {t("readCatalog")}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="permissions"
              value="catalog:write"
              defaultChecked
            />
            {t("manageCatalog")}
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="permissions" value="orders:read" />
            {t("readOrders")}
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="permissions" value="orders:write" />
            {t("updateOrderStatus")}
          </label>
        </fieldset>
        {error && (
          <p className="text-sm text-red-700 sm:col-span-2" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="text-sm text-green-700 sm:col-span-2" role="status">
            {notice}
          </p>
        )}
        <button
          className="rounded-md bg-indigo-700 px-4 py-2 font-medium text-white disabled:opacity-60 sm:col-span-2 sm:justify-self-start"
          disabled={busy}
          type="submit"
        >
          {busy ? t("creating") : t("createAccount")}
        </button>
      </form>
      {staff.length > 0 ? (
        <ul className="divide-y divide-slate-200">
          {staff.map((member) => (
            <li className="py-3 text-sm" key={member.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{member.email}</p>
                  <p className="mt-1 text-slate-600">
                    {member.active ? t("active") : t("disabled")} ·{" "}
                    {member.permissions.join(", ")}
                  </p>
                </div>
                <button
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium disabled:opacity-60"
                  disabled={busy}
                  onClick={() =>
                    void updateStaff(member.id, { active: !member.active })
                  }
                  type="button"
                >
                  {member.active ? t("disable") : t("reactivate")}
                </button>
              </div>
              <form
                className="mt-3 flex flex-wrap items-center gap-4"
                key={`${member.id}-${member.permissions.join(":")}`}
                onSubmit={(event) =>
                  void updateStaffPermissions(member.id, event)
                }
              >
                <fieldset className="flex flex-wrap gap-4">
                  <legend className="sr-only">
                    {t("permissionsFor", { email: member.email })}
                  </legend>
                  {(
                    [
                      ["catalog:read", t("readCatalog")],
                      ["catalog:write", t("manageCatalog")],
                      ["orders:read", t("readOrders")],
                      ["orders:write", t("updateOrderStatus")],
                    ] as const
                  ).map(([permission, label]) => (
                    <label className="flex items-center gap-2" key={permission}>
                      <input
                        type="checkbox"
                        name="permissions"
                        value={permission}
                        defaultChecked={member.permissions.includes(permission)}
                      />
                      {label}
                    </label>
                  ))}
                </fieldset>
                <button
                  className="rounded-md border border-indigo-300 px-3 py-1.5 text-sm font-medium text-indigo-800 disabled:opacity-60"
                  disabled={busy}
                  type="submit"
                >
                  {t("savePermissions")}
                </button>
                <button
                  className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 disabled:opacity-60"
                  disabled={busy}
                  onClick={() => void deleteStaff(member.id)}
                  type="button"
                >
                  {t("deleteAccount")}
                </button>
              </form>
              <form
                className="mt-3 flex flex-wrap items-end gap-2"
                onSubmit={resetStaffPassword}
              >
                <input name="staffId" type="hidden" value={member.id} />
                <label className="space-y-1 text-xs font-medium">
                  {t("resetPasswordLabel")}
                  <input
                    className="block w-full rounded-md border px-3 py-2 text-sm"
                    name="password"
                    type="password"
                    minLength={14}
                    maxLength={128}
                    required
                  />
                </label>
                <button
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium disabled:opacity-60"
                  disabled={busy}
                  type="submit"
                >
                  {t("resetPassword")}
                </button>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-500">{t("noAccounts")}</p>
      )}
    </section>
  );
}

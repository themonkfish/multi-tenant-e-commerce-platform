"use client";

import { useState, type FormEvent } from "react";
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
  const [staff, setStaff] = useState(initialStaff);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function updateStaff(
    staffId: string,
    update: { active: boolean } | { password: string },
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
            ? "Too many staff changes. Try again later."
            : code === "staff_not_found"
              ? "That staff account could not be found for this store."
              : "The staff account could not be updated.",
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
        setError("The server returned invalid staff account data.");
        return false;
      }
      const parsedStaff = StaffViewSchema.safeParse(body.staff);
      if (!parsedStaff.success) {
        setError("The server returned invalid staff account data.");
        return false;
      }
      const updated = parsedStaff.data;
      setStaff((current) =>
        current.map((member) => (member.id === staffId ? updated : member)),
      );
      setNotice(
        "password" in update
          ? "Staff password reset. Share the new password securely."
          : updated.active
            ? "Staff account reactivated."
            : "Staff account disabled.",
      );
      return true;
    } catch {
      setError("The request could not reach the server. Please try again.");
      return false;
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
            ? "That email already has an account for this store."
            : code === "rate_limited"
              ? "Too many staff changes. Try again later."
              : "The staff account could not be created.",
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
        setError("The server returned invalid staff account data.");
        return;
      }
      const parsedStaff = StaffViewSchema.safeParse(body.staff);
      if (!parsedStaff.success) {
        setError("The server returned invalid staff account data.");
        return;
      }
      const created = parsedStaff.data;
      setStaff((current) =>
        [...current, created].sort((a, b) => a.email.localeCompare(b.email)),
      );
      event.currentTarget.reset();
      setNotice("Staff account created. Share its initial password securely.");
    } catch {
      setError("The request could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-5 rounded-lg border border-slate-200 bg-white p-5">
      <div>
        <h3 className="font-semibold">Staff accounts</h3>
        <p className="mt-1 text-sm text-slate-600">
          Staff can only access the catalog permissions assigned here. They
          cannot change store settings, API connections, or user accounts.
        </p>
      </div>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={createStaff}>
        <label className="space-y-1 text-sm font-medium">
          Staff email
          <input
            className="w-full rounded-md border px-3 py-2"
            name="email"
            type="email"
            required
          />
        </label>
        <label className="space-y-1 text-sm font-medium">
          Initial password (14+ characters)
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
          <legend className="mb-2 font-medium">Permissions</legend>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="permissions"
              value="catalog:read"
              defaultChecked
            />
            Read catalog
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="permissions"
              value="catalog:write"
              defaultChecked
            />
            Manage catalog
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="permissions" value="orders:read" />
            Read orders
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="permissions" value="orders:write" />
            Update order status
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
          {busy ? "Creating…" : "Create staff account"}
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
                    {member.active ? "Active" : "Disabled"} ·{" "}
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
                  {member.active ? "Disable" : "Reactivate"}
                </button>
              </div>
              <form
                className="mt-3 flex flex-wrap items-end gap-2"
                onSubmit={resetStaffPassword}
              >
                <input name="staffId" type="hidden" value={member.id} />
                <label className="space-y-1 text-xs font-medium">
                  Reset password (14+ characters)
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
                  Reset password
                </button>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-500">No staff accounts yet.</p>
      )}
    </section>
  );
}

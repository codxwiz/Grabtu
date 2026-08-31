import { useEffect, useState, type FormEvent } from "react";
import type { StaffMember } from "./types";

type StaffPayload = { name: string; phone: string; role: string };

const ROLE_GUIDE = [
  { role: "OWNER", access: "All restaurant settings, billing, staff and master controls." },
  { role: "MANAGER", access: "KDS, menu, tables, payments and restaurant brand settings." },
  { role: "SUPERVISOR", access: "KDS, menu and table operations, with payment visibility." },
  { role: "KITCHEN", access: "Kitchen display and ticket preparation flow only." },
] as const;

export function StaffPage({
  staff,
  onAdd,
  onToggle,
}: {
  staff: StaffMember[];
  onAdd: (data: StaffPayload) => Promise<boolean>;
  onToggle: (member: StaffMember) => Promise<boolean>;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  useEffect(() => {
    if (!error) return;
    const timeout = window.setTimeout(() => setError(""), 2000);
    return () => window.clearTimeout(timeout);
  }, [error]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy("add");
    const ok = await onAdd({
      name: String(data.get("name")).trim(),
      phone: String(data.get("phone")).trim(),
      role: String(data.get("role")),
    });
    setBusy("");
    if (ok) form.reset();
  }

  return (
    <div className="ops-layout page-staff">
      <section className="staff-list">
        <div className="limit-grid staff-role-grid">
          {ROLE_GUIDE.map(item => (
            <div key={item.role}>
              <span>{item.role}</span>
              <small>{item.access}</small>
            </div>
          ))}
        </div>

        {staff.length === 0 && <div className="empty-state"><b>No staff accounts yet</b><p>Add a manager, supervisor, or kitchen user to get started.</p></div>}
        {staff.map(member => (
          <article key={member.id}>
            <div className="avatar">{member.name[0]}</div>
            <div>
              <h2>{member.name}</h2>
              <p>{member.phone || "No phone linked yet"}</p>
              <span>{member.role.toLowerCase()}</span>
            </div>
            {member.role !== "OWNER" && (
              <button type="button" className="secondary-action" disabled={busy === member.id} onClick={() => { setBusy(member.id); void onToggle(member).finally(() => setBusy("")); }}>
                {busy === member.id ? "Saving…" : member.isActive ? "Disable" : "Enable"}
              </button>
            )}
          </article>
        ))}
      </section>

      <form className="item-form" onSubmit={submit}>
        <h2>Add staff member</h2>
        <p className="form-help">Each staff member signs in with their phone number through Firebase OTP.</p>
        <label>
          Name
          <input name="name" minLength={2} maxLength={80} autoComplete="name" required />
        </label>
        <label>
          Phone number
          <input name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="+919876543210" pattern="\+?[0-9]{10,15}" required />
        </label>
        <label>
          Role
          <select name="role" defaultValue="KITCHEN">
            <option value="MANAGER">Manager</option>
            <option value="SUPERVISOR">Supervisor</option>
            <option value="KITCHEN">Kitchen</option>
          </select>
        </label>
        {error && <div className="error" role="alert">{error}</div>}
        <button disabled={busy === "add"}>{busy === "add" ? "Adding…" : "Add staff member"}</button>
      </form>
    </div>
  );
}

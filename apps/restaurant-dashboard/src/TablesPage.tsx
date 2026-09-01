import { useEffect, useRef, useState, type FormEvent } from "react";
import type { DiningTable } from "./types";

type TableDetails = { label: string; code: string };
type QrDetails = { url: string; svg: string; pngDataUrl: string };

type TablesPageProps = {
  tables: DiningTable[];
  canManage: boolean;
  onAdd: (data: TableDetails & { isActive: boolean }) => Promise<boolean>;
  onEdit: (table: DiningTable, data: TableDetails) => Promise<boolean>;
  onToggle: (table: DiningTable) => Promise<boolean>;
  onDelete: (table: DiningTable) => Promise<boolean>;
  onQr: (table: DiningTable) => Promise<QrDetails>;
};

export function TablesPage({ tables, canManage, onAdd, onEdit, onToggle, onDelete, onQr }: TablesPageProps) {
  const [qr, setQr] = useState<{ table: DiningTable } & QrDetails | null>(null);
  const [editing, setEditing] = useState<DiningTable | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!editing && !qr) return;
    const close = () => { setEditing(null); setQr(null); setError(""); };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    document.addEventListener("keydown", onKeyDown);
    window.setTimeout(() => closeButtonRef.current?.focus(), 0);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [editing, qr]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy("add");
    const ok = await onAdd({
      label: String(data.get("label")).trim(),
      code: String(data.get("code")).trim().toUpperCase(),
      isActive: true,
    });
    setBusy("");
    if (ok) form.reset();
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const data = new FormData(event.currentTarget);
    setBusy(`edit-${editing.id}`);
    const ok = await onEdit(editing, {
      label: String(data.get("label")).trim(),
      code: String(data.get("code")).trim().toUpperCase(),
    });
    setBusy("");
    if (ok) setEditing(null);
  }

  async function showQr(table: DiningTable) {
    setError("");
    setBusy(`qr-${table.id}`);
    try {
      setQr({ table, ...(await onQr(table)) });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not generate this QR code");
    } finally {
      setBusy("");
    }
  }

  async function toggle(table: DiningTable) {
    setBusy(`toggle-${table.id}`);
    await onToggle(table);
    setBusy("");
  }

  async function remove(table: DiningTable) {
    if (!window.confirm(`Delete ${table.label}? Its order history will be preserved.`)) return;
    setBusy(`delete-${table.id}`);
    await onDelete(table);
    setBusy("");
  }

  function download() {
    if (!qr) return;
    const link = document.createElement("a");
    link.href = qr.pngDataUrl;
    link.download = `table-menu-${qr.table.code}.png`;
    link.click();
  }

  return <>
    {!canManage && <div className="notice read-only-notice" role="note"><b>Read-only tables</b><p>Your role can view QR destinations but cannot change table setup.</p></div>}
    {canManage && <form className="inline-form table-add" onSubmit={submit} aria-busy={busy === "add"}>
      <label className="sr-only" htmlFor="table-label">Table label</label>
      <input id="table-label" name="label" placeholder="Table 02" minLength={2} maxLength={60} required />
      <label className="sr-only" htmlFor="table-code">Table code</label>
      <input id="table-code" name="code" placeholder="T2" pattern="[A-Za-z0-9_-]+" maxLength={20} autoCapitalize="characters" required />
      <button disabled={busy === "add"}>{busy === "add" ? "Adding…" : "Add table"}</button>
    </form>}

    {error && <div className="error" role="alert">{error}</div>}
    {tables.length === 0 ? <div className="empty-state"><b>No tables yet</b><p>{canManage ? "Add the first table to generate its guest QR code." : "No table setup is available."}</p></div> : <div className="table-grid">
      {tables.map(table => <article key={table.id}>
        <div className="table-icon" aria-hidden="true">{table.code}</div>
        <h2>{table.label}</h2>
        <p>{table._count.orders} lifetime orders</p>
        <span className={table.isActive ? "status active-status" : "status"}>{table.isActive ? "Active" : "Disabled"}</span>
        <div className="table-actions">
          <button type="button" disabled={busy === `qr-${table.id}`} onClick={() => void showQr(table)}>{busy === `qr-${table.id}` ? "Generating…" : "View QR"}</button>
          {canManage && <><button type="button" className="secondary-action" onClick={() => { setError(""); setEditing(table); }}>Edit</button>
          <button type="button" className="secondary-action" disabled={busy === `toggle-${table.id}`} onClick={() => void toggle(table)}>{busy === `toggle-${table.id}` ? "Saving…" : table.isActive ? "Disable" : "Enable"}</button>
          {!table.isActive && <button type="button" className="danger-action" disabled={busy === `delete-${table.id}`} onClick={() => void remove(table)}>{busy === `delete-${table.id}` ? "Deleting…" : "Delete"}</button>}</>}
        </div>
      </article>)}
    </div>}

    {editing && <div className="modal" role="dialog" aria-modal="true" aria-labelledby="edit-table-title" onMouseDown={event => { if (event.target === event.currentTarget) setEditing(null); }}>
      <div className="modal-card">
        <button ref={closeButtonRef} type="button" className="modal-close" aria-label="Close edit table" onClick={() => setEditing(null)}>×</button>
        <h2 id="edit-table-title">Edit table</h2>
        <p className="table-edit-help">Changing these details will not invalidate the table’s existing QR code.</p>
        <form className="table-edit-form" onSubmit={saveEdit}>
          <label htmlFor="edit-table-label">Table label</label>
          <input id="edit-table-label" name="label" defaultValue={editing.label} minLength={2} maxLength={60} required />
          <label htmlFor="edit-table-code">Table code</label>
          <input id="edit-table-code" name="code" defaultValue={editing.code} pattern="[A-Za-z0-9_-]+" maxLength={20} required />
          <div className="table-edit-actions">
            <button type="button" className="secondary-action" onClick={() => setEditing(null)} disabled={Boolean(busy)}>Cancel</button>
            <button type="submit" disabled={Boolean(busy)}>{busy.startsWith("edit-") ? "Saving…" : "Save changes"}</button>
          </div>
        </form>
      </div>
    </div>}

    {qr && <div className="modal qr-modal" role="dialog" aria-modal="true" aria-labelledby="qr-title" onMouseDown={event => { if (event.target === event.currentTarget) setQr(null); }}>
      <div className="modal-card qr-modal-card">
        <button ref={closeButtonRef} type="button" className="modal-close" aria-label="Close QR code" onClick={() => setQr(null)}>×</button>
        <h2 id="qr-title">{qr.table.label}</h2>
        <img className="qr qr-image" src={qr.pngDataUrl} alt={`QR code for ${qr.table.label}`} />
        <a className="qr-destination" href={qr.url} target="_blank" rel="noreferrer">Open guest menu <span aria-hidden="true">↗</span></a>
        <button type="button" onClick={download}>Download PNG</button>
      </div>
    </div>}
  </>;
}

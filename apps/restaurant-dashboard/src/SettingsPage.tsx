import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { api, TOKEN_KEY } from "./api";
import type { Entitlements, RestaurantSettings, SupportTicket } from "./types";
import { SupportTicketsCard } from "./SupportTicketsCard";

type Props = { settings: RestaurantSettings; entitlements: Entitlements; supportTickets: SupportTicket[]; canOpenBilling: boolean; onCreateSupportTicket: (data: { subject: string; category: string; priority: string; message: string }) => Promise<boolean>; onSave: (data: Partial<RestaurantSettings>) => Promise<boolean>; onUpload?: (kind: "logo" | "cover", file: File) => Promise<string | null>; onOpenBilling: () => void };
function readFile(file: File) { return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("Could not read image")); reader.readAsDataURL(file); }); }
const planName = (value: string) => value.toLowerCase() === "business" || value.toLowerCase() === "pro" ? "BUSINESS" : value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();

export function SettingsPage({ settings, entitlements, supportTickets, canOpenBilling, onCreateSupportTicket, onSave, onUpload, onOpenBilling }: Props) {
  const [logoUrl, setLogoUrl] = useState(settings.logoUrl || "");
  const [coverImageUrl, setCoverImageUrl] = useState(settings.coverImageUrl || "");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<"logo" | "cover" | "">("");
  const [message, setMessage] = useState("");
  const [localError, setLocalError] = useState("");
  useEffect(() => {
    setLogoUrl(settings.logoUrl || "");
    setCoverImageUrl(settings.coverImageUrl || "");
  }, [settings.coverImageUrl, settings.logoUrl]);
  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(() => setMessage(""), 2000);
    return () => window.clearTimeout(timeout);
  }, [message]);

  async function upload(kind: "logo" | "cover", event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = "";
    setLocalError("");
    setMessage("");
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { setLocalError("Choose a PNG, JPG, or WebP image."); return; }
    if (file.size > 3_000_000) { setLocalError("Choose an image smaller than 3 MB."); return; }
    setUploading(kind);
    try {
      const result = onUpload ? await onUpload(kind, file) : (await api<{ url: string }>("/api/admin/assets", localStorage.getItem(TOKEN_KEY) || "", { method: "POST", body: JSON.stringify({ kind, data: await readFile(file) }) })).url;
      if (!result) return;
      const ok = await onSave(kind === "logo" ? { logoUrl: result } : { coverImageUrl: result });
      if (!ok) return;
      kind === "logo" ? setLogoUrl(result) : setCoverImageUrl(result);
      setMessage(`${kind === "logo" ? "Logo" : "Cover image"} uploaded and published.`);
    } catch (reason) {
      setLocalError(reason instanceof Error ? reason.message : "Could not upload this image");
    } finally {
      setUploading("");
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setMessage("");
    const data = new FormData(event.currentTarget);
    try {
      const ok = await onSave({ orderingEnabled: data.get("orderingEnabled") === "on", orderPauseMessage: String(data.get("orderPauseMessage") || ""), taxPercent: Math.round(Number(data.get("taxPercent"))), serviceChargePercent: Math.round(Number(data.get("serviceChargePercent"))), logoUrl, coverImageUrl, brandColor: String(data.get("brandColor") || "#17372b") });
      if (ok) setMessage("Restaurant settings saved successfully.");
    } finally { setSaving(false); }
  }

  return <div className="settings-layout">
    <form className="settings-form" onSubmit={submit}>
      <div className="settings-panel-heading"><div><p className="eyebrow">RESTAURANT PROFILE</p><h2>Brand and ordering</h2><p>Customize the experience guests see when they scan a table QR.</p></div><span className="settings-status"><i /> Live</span></div>

      <section className="settings-section"><div className="settings-section-title"><span className="settings-section-icon">✦</span><div><h3>Guest-facing brand</h3><p>Use your own identity across the customer menu.</p></div></div>
        <div className="asset-grid">
          <div className="asset-upload-card"><div className={`asset-preview logo-preview ${logoUrl ? "has-image" : ""}`}>{logoUrl ? <img src={logoUrl} alt="Restaurant logo preview" /> : <span>LOGO</span>}</div><div className="asset-copy"><b>Restaurant logo</b><small>Square PNG, JPG, or WebP · max 3 MB</small><label className={`upload-button ${uploading === "logo" ? "disabled" : ""}`}>{uploading === "logo" ? "Uploading…" : logoUrl ? "Replace logo" : "Upload logo"}<input type="file" disabled={Boolean(uploading)} accept="image/png,image/jpeg,image/webp" onChange={event => void upload("logo", event)} /></label></div></div>
          <div className="asset-upload-card cover-asset"><div className={`asset-preview cover-preview ${coverImageUrl ? "has-image" : ""}`} style={coverImageUrl ? { backgroundImage: `url(${coverImageUrl})` } : undefined}>{!coverImageUrl && <span>COVER</span>}</div><div className="asset-copy"><b>Menu cover image</b><small>Wide PNG, JPG, or WebP · max 3 MB</small><label className={`upload-button ${uploading === "cover" ? "disabled" : ""}`}>{uploading === "cover" ? "Uploading…" : coverImageUrl ? "Replace cover" : "Upload cover"}<input type="file" disabled={Boolean(uploading)} accept="image/png,image/jpeg,image/webp" onChange={event => void upload("cover", event)} /></label></div></div>
        </div>
        {localError && <div className="error" role="alert">{localError}</div>}
        <label className="color-field"><span><b>Brand accent color</b><small>Used for highlights and customer actions.</small></span><input name="brandColor" type="color" defaultValue={settings.brandColor || "#17372b"} /></label>
      </section>

      <section className="settings-section"><div className="settings-section-title"><span className="settings-section-icon">⌁</span><div><h3>Ordering availability</h3><p>Control when guests can place orders from the table.</p></div></div>
        <label className="setting-toggle"><span><b>Accept online orders</b><small>Guests can browse and send orders to your team.</small></span><input name="orderingEnabled" type="checkbox" defaultChecked={settings.orderingEnabled} /><i aria-hidden="true" /></label>
        <label className="field-label">Pause message<textarea name="orderPauseMessage" defaultValue={settings.orderPauseMessage} rows={2} placeholder="Online ordering is paused for a moment. Please ask our team for help." /><small>This message is shown to guests while ordering is paused.</small></label>
      </section>

      <section className="settings-section"><div className="settings-section-title"><span className="settings-section-icon">%</span><div><h3>Charges and totals</h3><p>Make your guest-facing charge breakdown transparent.</p></div></div><div className="charge-fields"><label className="field-label">Tax <span className="input-suffix">%</span><input name="taxPercent" type="number" min="0" max="100" step="1" inputMode="numeric" defaultValue={settings.taxPercent} /></label><label className="field-label">Service charge <span className="input-suffix">%</span><input name="serviceChargePercent" type="number" min="0" max="100" step="1" inputMode="numeric" defaultValue={settings.serviceChargePercent} /></label></div></section>

      <div className="settings-save-bar"><div>{message && <span className="settings-message" role="status"><i>✓</i>{message}</span>}</div><button className="settings-save" disabled={saving}>{saving ? "Saving changes…" : "Save settings"}<span>→</span></button></div>
    </form>

    <aside className="settings-aside"><section className={`entitlement-card ${entitlements.featuresLocked ? "locked" : ""}`}><div className="entitlement-heading"><div><p className="eyebrow">CURRENT SUBSCRIPTION</p><h2>{planName(entitlements.plan)} plan</h2></div><span className="plan-status-pill">{entitlements.featuresLocked ? "Locked" : entitlements.planStatus}</span></div>{entitlements.featuresLocked && <div className="feature-lock-banner"><b>Features locked</b><small>{entitlements.featureLockReason || "Continue your plan to restore access."}</small></div>}<div className="entitlement-divider" /><p className="entitlement-caption">Your plan includes these operating limits.</p><div className="limit-grid premium-limits"><div><span>Tables</span><b>{entitlements.limits.tables}</b><small>active tables</small></div><div><span>Staff</span><b>{entitlements.limits.staff}</b><small>team members</small></div><div><span>Menu items</span><b>{entitlements.limits.menuItems}</b><small>published items</small></div></div><div className="entitlement-foot"><span>{canOpenBilling ? "Need more capacity?" : "The owner manages subscription changes."}</span>{canOpenBilling && <button type="button" onClick={onOpenBilling}>Open billing <span aria-hidden="true">→</span></button>}</div></section></aside>
    <div className="settings-support-column"><SupportTicketsCard tickets={supportTickets} onCreate={onCreateSupportTicket} /></div>
  </div>;
}

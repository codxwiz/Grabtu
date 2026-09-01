import type { ServiceRequest } from "./types";
import { AlertSoundPicker, type AlertSoundId } from "./AlertSounds";

function BellIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z" /><path d="M10 21h4" /></svg>;
}

function statusLabel(status: string) {
  return status.trim().toUpperCase() === "ACKNOWLEDGED" ? "Acknowledged" : "Waiting";
}

export function ServiceRequestsPage({ requests, busyId, serviceSound, serviceSoundBlocked, onServiceSoundChange, onTestServiceSound, onAcknowledge, onResolve }: {
  requests: ServiceRequest[];
  busyId: string | null;
  serviceSound: AlertSoundId;
  serviceSoundBlocked: boolean;
  onServiceSoundChange: (sound: AlertSoundId) => void;
  onTestServiceSound: () => void;
  onAcknowledge: (request: ServiceRequest) => void;
  onResolve: (request: ServiceRequest) => void;
}) {
  const sorted = [...requests].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const openCount = sorted.filter(request => request.status.trim().toUpperCase() === "OPEN").length;
  const acknowledgedCount = sorted.filter(request => request.status.trim().toUpperCase() === "ACKNOWLEDGED").length;

  return <div className="service-requests-page">
    <section className="service-requests-hero" aria-labelledby="service-requests-title">
      <div><p className="eyebrow">GUEST SERVICE</p><h2 id="service-requests-title">Call waiter queue</h2><p>Every active guest call is collected here while live alerts continue across the dashboard.</p></div>
      <div className="service-request-hero-controls"><AlertSoundPicker label="Service request alert" value={serviceSound} blocked={serviceSoundBlocked} onChange={onServiceSoundChange} onTest={onTestServiceSound}/><div className="service-request-metrics" aria-label="Service request summary"><span><b>{openCount}</b>Waiting</span><span><b>{acknowledgedCount}</b>Acknowledged</span></div></div>
    </section>

    <section className="service-request-queue" aria-label="Call waiter requests">
      <header><div><p className="eyebrow">LIVE REQUESTS</p><h2>Tables waiting for service</h2></div><span className="service-request-live"><i /> Live sync</span></header>
      {sorted.length === 0 ? <div className="service-request-empty"><BellIcon /><b>No active waiter calls</b><p>New Call Waiter requests will appear here automatically.</p></div> : <div className="service-request-list">
        {sorted.map(request => {
          const acknowledged = request.status.trim().toUpperCase() === "ACKNOWLEDGED";
          const waiting = busyId === request.id;
          return <article className={`service-request-row ${acknowledged ? "acknowledged" : "open"}`} key={request.id}>
            <div className="service-request-icon"><BellIcon /></div>
            <div className="service-request-copy"><div><h3>{request.tableLabel || request.tableCode || "Guest table"}</h3><span className={`service-request-status ${acknowledged ? "acknowledged" : "open"}`}>{statusLabel(request.status)}</span></div><p>{request.note || "Guest requested a waiter."}</p><time dateTime={request.createdAt}>{new Date(request.createdAt).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</time></div>
            <button type="button" disabled={waiting} onClick={() => acknowledged ? onResolve(request) : onAcknowledge(request)}>{waiting ? "Updating…" : acknowledged ? "Mark resolved" : "Acknowledge"}</button>
          </article>;
        })}
      </div>}
    </section>
  </div>;
}

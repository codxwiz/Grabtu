import type { ServiceRequest } from "./types";
import { useAlertSound } from "./AlertSounds";

export function isWaiterCall(request: ServiceRequest) {
  const type = request.type.trim().toUpperCase();
  return type === "WAITER" || type === "CALL_WAITER";
}

export function isOpenWaiterCall(request: ServiceRequest) {
  return request.status.trim().toUpperCase() === "OPEN" && isWaiterCall(request);
}

export function useWaiterAlertSound() {
  return useAlertSound("service", "bell");
}

function BellIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z" /><path d="M10 21h4" /></svg>;
}

export function WaiterAlertControls({ enabled, blocked, onToggle, onTest }: {
  enabled: boolean;
  blocked: boolean;
  onToggle: () => void;
  onTest: () => void;
}) {
  const label = blocked ? "Activate waiter alert sound" : enabled ? "Mute waiter alert sound" : "Enable waiter alert sound";
  return <div className="restaurant-alerts-actions">
    <button type="button" className={`restaurant-alerts-control ${enabled ? "enabled" : ""} ${blocked ? "blocked" : ""}`} aria-label={label} aria-pressed={enabled} title={label} onClick={onToggle}><BellIcon /><i aria-hidden="true" /></button>
    <button type="button" className="restaurant-alerts-test" onClick={onTest}>Test sound</button>
  </div>;
}

export function WaiterAlertStack({ requests, busyId, onAcknowledge, onDismiss }: {
  requests: ServiceRequest[];
  busyId: string | null;
  onAcknowledge: (request: ServiceRequest) => void;
  onDismiss: (request: ServiceRequest) => void;
}) {
  if (!requests.length) return null;
  return <section className="waiter-alert-stack" aria-label="Waiter calls" aria-live="assertive">
    {requests.slice(0, 3).map(request => <article className="waiter-alert-card" key={request.id} role="alert">
      <div className="waiter-alert-bell"><BellIcon /></div>
      <div className="waiter-alert-copy"><span>Waiter requested</span><strong>{request.tableLabel || request.tableCode || "Guest table"}</strong>{request.note && <p>{request.note}</p>}<time>{new Date(request.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></div>
      <div className="waiter-alert-actions"><button type="button" onClick={() => onAcknowledge(request)} disabled={busyId === request.id}>{busyId === request.id ? "Acknowledging…" : "Acknowledge"}</button><button type="button" className="waiter-alert-dismiss" aria-label={`Dismiss waiter alert for ${request.tableLabel || request.tableCode || "guest table"}`} onClick={() => onDismiss(request)}>Dismiss</button></div>
    </article>)}
  </section>;
}

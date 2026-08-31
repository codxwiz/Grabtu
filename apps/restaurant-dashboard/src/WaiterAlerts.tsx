import { useCallback, useEffect, useRef, useState } from "react";
import type { ServiceRequest } from "./types";

const SOUND_KEY = "grabtu_waiter_alert_sound";
const SOUND_URL = "/alerts/waiter-bell.mp3";

export function isOpenWaiterCall(request: ServiceRequest) {
  const type = request.type.trim().toUpperCase();
  return request.status.trim().toUpperCase() === "OPEN" && (type === "WAITER" || type === "CALL_WAITER");
}

export function useWaiterAlertSound() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [enabled, setEnabled] = useState(() => localStorage.getItem(SOUND_KEY) !== "off");
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    const audio = new Audio(SOUND_URL);
    audio.preload = "auto";
    audio.volume = 0.9;
    audioRef.current = audio;
    return () => {
      audio.pause();
      audioRef.current = null;
    };
  }, []);

  const play = useCallback(async () => {
    if (!enabled || !audioRef.current) return false;
    try {
      audioRef.current.muted = false;
      audioRef.current.currentTime = 0;
      await audioRef.current.play();
      setBlocked(false);
      return true;
    } catch {
      setBlocked(true);
      return false;
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const removePrimeListeners = () => {
      window.removeEventListener("pointerdown", prime, true);
      window.removeEventListener("keydown", prime, true);
    };
    const prime = () => {
      const audio = audioRef.current;
      if (!audio) return;
      audio.muted = true;
      void audio.play().then(() => {
        audio.pause();
        audio.currentTime = 0;
        audio.muted = false;
        setBlocked(false);
        removePrimeListeners();
      }).catch(() => setBlocked(true));
    };
    window.addEventListener("pointerdown", prime, true);
    window.addEventListener("keydown", prime, true);
    return removePrimeListeners;
  }, [enabled]);

  const toggle = useCallback(async () => {
    if (enabled && blocked) {
      await play();
      return;
    }
    const next = !enabled;
    setEnabled(next);
    setBlocked(false);
    localStorage.setItem(SOUND_KEY, next ? "on" : "off");
    if (next) {
      const audio = audioRef.current;
      if (audio) {
        audio.currentTime = 0;
        try {
          await audio.play();
          setBlocked(false);
        } catch {
          setBlocked(true);
        }
      }
    }
  }, [blocked, enabled, play]);

  const test = useCallback(async () => {
    if (!enabled) {
      setEnabled(true);
      localStorage.setItem(SOUND_KEY, "on");
      const audio = audioRef.current;
      if (audio) {
        audio.currentTime = 0;
        try {
          await audio.play();
          setBlocked(false);
        } catch {
          setBlocked(true);
        }
      }
      return;
    }
    await play();
  }, [enabled, play]);

  return { enabled, blocked, play, test, toggle };
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

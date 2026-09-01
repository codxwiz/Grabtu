import { useCallback, useEffect, useRef, useState } from "react";

export type AlertSoundId = "clean-futuristic" | "gentle-brightmp3" | "high-quality-cash" | "realistic-vibe" | "short-clean" | "smartphone-vibe" | "bell" | "bright-chime" | "double-chime" | "soft-ping" | "off";
export type AlertSoundChannel = "service" | "order";

export const ALERT_SOUND_OPTIONS: readonly { value: AlertSoundId; label: string }[] = [
  { value: "clean-futuristic", label: "Clean Futuristic" },
  { value: "gentle-brightmp3", label: "Gentle brightmp3" },
  { value: "high-quality-cash", label: "High Quality Cash" },
  { value: "realistic-vibe", label: "Realistic Vibe" },
  { value: "short-clean", label: "Short Clean" },
  { value: "smartphone-vibe", label: "Smartphone Vibe" },
  { value: "bell", label: "Classic bell" },
  { value: "bright-chime", label: "Bright chime" },
  { value: "double-chime", label: "Double chime" },
  { value: "soft-ping", label: "Soft ping" },
  { value: "off", label: "No sound" },
];

const soundFiles: Partial<Record<AlertSoundId, string>> = {
  "clean-futuristic": "/alerts/clean-futuristic.mp3",
  "gentle-brightmp3": "/alerts/gentle-brightmp3.mp3",
  "high-quality-cash": "/alerts/high-quality-cash.mp3",
  "realistic-vibe": "/alerts/realistic-vibe.mp3",
  "short-clean": "/alerts/short-clean.mp3",
  "smartphone-vibe": "/alerts/smartphone-vibe.mp3",
  bell: "/alerts/waiter-bell.mp3",
};
const SOUND_KEYS: Record<AlertSoundChannel, string> = {
  service: "grabtu_service_alert_sound",
  order: "grabtu_order_alert_sound",
};
const LEGACY_SERVICE_KEY = "grabtu_waiter_alert_sound";
type SynthSoundId = "bright-chime" | "double-chime" | "soft-ping";
const tonePatterns: Record<SynthSoundId, readonly { frequency: number; delay: number; duration: number; volume: number }[]> = {
  "bright-chime": [
    { frequency: 880, delay: 0, duration: 0.16, volume: 0.22 },
    { frequency: 1174.66, delay: 0.12, duration: 0.24, volume: 0.2 },
  ],
  "double-chime": [
    { frequency: 659.25, delay: 0, duration: 0.2, volume: 0.24 },
    { frequency: 880, delay: 0.28, duration: 0.24, volume: 0.22 },
  ],
  "soft-ping": [{ frequency: 523.25, delay: 0, duration: 0.34, volume: 0.16 }],
};

function isSoundId(value: string | null): value is AlertSoundId {
  return ALERT_SOUND_OPTIONS.some(option => option.value === value);
}

function initialSound(channel: AlertSoundChannel, fallback: AlertSoundId) {
  const saved = localStorage.getItem(SOUND_KEYS[channel]);
  if (isSoundId(saved)) return saved;
  if (channel === "service" && localStorage.getItem(LEGACY_SERVICE_KEY) === "off") return "off";
  return fallback;
}

function audioContextConstructor() {
  return window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

export function useAlertSound(channel: AlertSoundChannel, fallback: AlertSoundId) {
  const audioRefs = useRef<Partial<Record<AlertSoundId, HTMLAudioElement>>>({});
  const contextRef = useRef<AudioContext | null>(null);
  const [sound, setSoundState] = useState<AlertSoundId>(() => initialSound(channel, fallback));
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    for (const [id, url] of Object.entries(soundFiles) as [AlertSoundId, string][]) {
      const audio = new Audio(url);
      audio.preload = "auto";
      audio.volume = 0.9;
      audioRefs.current[id] = audio;
    }
    return () => {
      for (const audio of Object.values(audioRefs.current)) audio?.pause();
      audioRefs.current = {};
      if (contextRef.current) void contextRef.current.close();
      contextRef.current = null;
    };
  }, []);

  const playSound = useCallback(async (selected: AlertSoundId) => {
    if (selected === "off") return false;
    try {
      if (soundFiles[selected]) {
        const audio = audioRefs.current[selected];
        if (!audio) return false;
        audio.muted = false;
        audio.currentTime = 0;
        await audio.play();
      } else {
        const Context = audioContextConstructor();
        if (!Context) return false;
        const context = contextRef.current || new Context();
        contextRef.current = context;
        if (context.state === "suspended") await context.resume();
        const start = context.currentTime + 0.015;
        for (const tone of tonePatterns[selected as SynthSoundId]) {
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          oscillator.type = "sine";
          oscillator.frequency.setValueAtTime(tone.frequency, start + tone.delay);
          gain.gain.setValueAtTime(0.0001, start + tone.delay);
          gain.gain.exponentialRampToValueAtTime(tone.volume, start + tone.delay + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + tone.delay + tone.duration);
          oscillator.connect(gain);
          gain.connect(context.destination);
          oscillator.start(start + tone.delay);
          oscillator.stop(start + tone.delay + tone.duration + 0.02);
        }
      }
      setBlocked(false);
      return true;
    } catch {
      setBlocked(true);
      return false;
    }
  }, []);

  const play = useCallback(() => playSound(sound), [playSound, sound]);

  useEffect(() => {
    if (sound === "off") return;
    const removePrimeListeners = () => {
      window.removeEventListener("pointerdown", prime, true);
      window.removeEventListener("keydown", prime, true);
    };
    const prime = () => {
      if (soundFiles[sound]) {
        const audio = audioRefs.current[sound];
        if (!audio) return;
        audio.muted = true;
        void audio.play().then(() => {
          audio.pause();
          audio.currentTime = 0;
          audio.muted = false;
          setBlocked(false);
          removePrimeListeners();
        }).catch(() => setBlocked(true));
        return;
      }
      const Context = audioContextConstructor();
      if (!Context) return;
      const context = contextRef.current || new Context();
      contextRef.current = context;
      void context.resume().then(() => {
        setBlocked(false);
        removePrimeListeners();
      }).catch(() => setBlocked(true));
    };
    window.addEventListener("pointerdown", prime, true);
    window.addEventListener("keydown", prime, true);
    return removePrimeListeners;
  }, [sound]);

  const setSound = useCallback((next: AlertSoundId) => {
    setSoundState(next);
    setBlocked(false);
    localStorage.setItem(SOUND_KEYS[channel], next);
    if (channel === "service") localStorage.setItem(LEGACY_SERVICE_KEY, next === "off" ? "off" : "on");
  }, [channel]);

  const test = useCallback(() => playSound(sound), [playSound, sound]);
  const toggle = useCallback(async () => {
    if (sound === "off") {
      setSound(fallback);
      await playSound(fallback);
    } else {
      setSound("off");
    }
  }, [fallback, playSound, setSound, sound]);

  return { sound, enabled: sound !== "off", blocked, play, test, toggle, setSound };
}

export function AlertSoundPicker({ label, value, blocked, onChange, onTest }: {
  label: string;
  value: AlertSoundId;
  blocked: boolean;
  onChange: (value: AlertSoundId) => void;
  onTest: () => void;
}) {
  return <div className="alert-sound-picker">
    <label><span>{label}</span><select value={value} onChange={event => onChange(event.target.value as AlertSoundId)}>{ALERT_SOUND_OPTIONS.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
    <button type="button" disabled={value === "off"} onClick={onTest}>Test</button>
    {blocked && <small role="status">Select Test once to allow browser audio.</small>}
  </div>;
}

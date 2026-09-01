import assert from "node:assert/strict";
import test from "node:test";
import { ALERT_SOUND_OPTIONS } from "./AlertSounds";

test("lists the supplied alert sounds first for both alert pickers", () => {
  assert.deepEqual(
    ALERT_SOUND_OPTIONS.slice(0, 6).map(option => option.label),
    [
      "Clean Futuristic",
      "Gentle brightmp3",
      "High Quality Cash",
      "Realistic Vibe",
      "Short Clean",
      "Smartphone Vibe",
    ],
  );
});

import type { LatentBusinessProfile } from "./profile.js";
import { SeededRandom } from "./rng.js";

function normalize(values: readonly number[]): readonly number[] {
  const average =
    values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.map((value) => value / average);
}

function gaussianMonth(month: number, center: number, width: number): number {
  const distance = Math.min(
    Math.abs(month - center),
    12 - Math.abs(month - center),
  );
  return Math.exp(-(distance ** 2) / (2 * width ** 2));
}

export interface GeneratedSeasonality {
  readonly monthly: readonly number[];
  readonly weekday: readonly number[];
}

export function generateSeasonality(
  profile: LatentBusinessProfile,
  rng: SeededRandom,
): GeneratedSeasonality {
  const strength = profile.seasonalityStrength;
  const phase = rng.uniform(0, Math.PI * 2);
  const base = Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const smooth =
      Math.sin((month / 12) * Math.PI * 2 + phase) * strength * 0.45;
    const jitter = rng.normal(0, strength * 0.08);
    let shaped = 1 + smooth + jitter;

    if (profile.seasonalityProfile === "q4_heavy") {
      shaped +=
        gaussianMonth(month, 11.4, rng.uniform(1.1, 1.8)) * strength;
    } else if (profile.seasonalityProfile === "holiday_heavy") {
      shaped +=
        gaussianMonth(month, 12, rng.uniform(0.65, 1.2)) * strength * 1.25;
    } else if (profile.seasonalityProfile === "summer_heavy") {
      shaped +=
        gaussianMonth(month, 7.1, rng.uniform(1.1, 1.8)) * strength;
    } else if (profile.seasonalityProfile === "event_driven") {
      const eventMonth = rng.integer(1, 12);
      shaped +=
        gaussianMonth(month, eventMonth, rng.uniform(0.45, 0.9)) *
        strength *
        1.4;
    } else if (profile.seasonalityProfile === "strong") {
      shaped +=
        gaussianMonth(month, rng.uniform(1, 12), rng.uniform(1.2, 2.4)) *
        strength *
        0.55;
    }

    // February softness is probabilistic, not universal.
    if (month === 2 && rng.bool(0.35)) {
      shaped -= strength * rng.uniform(0.08, 0.28);
    }

    return Math.max(0.2, shaped);
  });

  const weekdayAmplitude =
    profile.seasonalityProfile === "low"
      ? rng.uniform(0.01, 0.05)
      : rng.uniform(0.03, 0.12);
  const weekendDirection = rng.bool(0.68) ? 1 : -1;
  const weekday = Array.from({ length: 7 }, (_, index) => {
    const isWeekend = index === 5 || index === 6;
    const effect = isWeekend
      ? weekendDirection * weekdayAmplitude
      : -weekendDirection * weekdayAmplitude * (2 / 5);
    return Math.max(0.65, 1 + effect + rng.normal(0, 0.012));
  });

  return {
    monthly: normalize(base),
    weekday: normalize(weekday),
  };
}

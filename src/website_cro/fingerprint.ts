import {
  WEBSITE_MODEL_VERSION,
  WEBSITE_SCHEMA_VERSION,
  type WebsiteScenario,
} from "./types.js";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

/**
 * Stable machine-readable representation of Step 12 website truth.
 * Object-key ordering cannot change the serialized value; semantically
 * meaningful array ordering (state deployment order, interventions) is kept.
 */
export function serializeWebsiteScenario(
  scenario: WebsiteScenario,
): string {
  return JSON.stringify(
    canonicalize({
      modelVersion: WEBSITE_MODEL_VERSION,
      schemaVersion: WEBSITE_SCHEMA_VERSION,
      scenario,
    }),
  );
}

function fnv1a32(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Deterministic fingerprint used in God-mode truth and simulation provenance
 * so website-model/configuration changes are externally detectable.
 */
export function websiteScenarioFingerprint(
  scenario: WebsiteScenario,
): string {
  return `${WEBSITE_MODEL_VERSION}:${fnv1a32(
    serializeWebsiteScenario(scenario),
  )}`;
}

import {
  resolveWebsiteState,
  websitePageExperience as legacyWebsitePageExperience,
} from "./runtime-v1.js";
import { pdpImageryConfidenceFactor } from "./runtime-revision.js";

// Keep the pre-correction implementation byte-for-byte for differential tests.
// All APIs except PDP page response delegate to that implementation unchanged.
export * from "./runtime-v1.js";
export { WEBSITE_RUNTIME_REVISION } from "./runtime-revision.js";

/**
 * Correct the documented weak-imagery bottleneck without changing the frozen
 * input schema, unrelated components, or the no-website simulation path.
 * Scenario fingerprints include the runtime revision; old and corrected
 * website-enabled outputs must not be presented as the same execution model.
 */
export function websitePageExperience(
  input: Parameters<typeof legacyWebsitePageExperience>[0],
): ReturnType<typeof legacyWebsitePageExperience> {
  const page = legacyWebsitePageExperience(input);
  if (page === undefined || input.scenario === undefined || input.component !== "pdp") return page;
  // The legacy diagnostic already resolved product overrides and interventions.
  // Healthy PDPs incur no additional state resolution or arithmetic changes.
  if (!page.frictions.includes("weak_imagery")) return page;
  const state = resolveWebsiteState(input.scenario, input.timestampMs, input.device, input.productId, input.categoryId);
  const presentation = input.productId === undefined ? undefined
    : state.productPresentation?.find(product => product.productId === input.productId);
  const category = state.categorySensitivity?.find(row => row.categoryId === input.categoryId);
  const imagery = presentation?.imageryQuality ?? state.pdp.imageryQuality;
  const factor = pdpImageryConfidenceFactor(imagery, category?.imageryImportance ?? 0.72);
  if (factor === 1) return page;
  return {
    ...page,
    continuationMultiplier: Math.max(0.04, page.continuationMultiplier * factor),
    transitionMultiplier: Math.max(0.08, page.transitionMultiplier * factor),
  };
}

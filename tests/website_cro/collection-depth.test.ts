import { describe, expect, it } from "vitest";
import {
  healthyWebsiteState,
} from "../../src/website_cro/adversarial.js";
import {
  websiteProductDiscoveryMultiplier,
} from "../../src/website_cro/runtime.js";
import type {
  WebsiteScenario,
} from "../../src/website_cro/types.js";

const START = "2026-01-01T00:00:00.000Z";

function collectionScenario(
  loadMoreUsability: number,
): WebsiteScenario {
  const base = healthyWebsiteState(
    START,
    `collection-depth-${loadMoreUsability}`,
    [
      {
        productId: "buried-product",
        collectionVisibility: 0.05,
      },
      {
        productId: "front-product",
        collectionVisibility: 0.95,
      },
    ],
  );
  return {
    scenarioId:
      `collection-depth-${loadMoreUsability}`,
    states: [
      {
        ...base,
        collection: {
          ...base.collection,
          rankingQuality: 0.1,
          loadMoreUsability,
        },
      },
    ],
  };
}

function discovery(
  scenario: WebsiteScenario,
  productId: string,
): number {
  return websiteProductDiscoveryMultiplier({
    scenario,
    timestampMs: Date.parse(START),
    device: "mobile",
    surface: "collection",
    productId,
    latentPreference: 0.8,
  });
}

describe("Step 12 collection depth mechanics", () => {
  it("makes poor pagination/load-more reach disproportionately suppress buried products", () => {
    const healthy = collectionScenario(0.95);
    const poor = collectionScenario(0.12);

    const healthyBuried = discovery(
      healthy,
      "buried-product",
    );
    const poorBuried = discovery(
      poor,
      "buried-product",
    );
    const healthyFront = discovery(
      healthy,
      "front-product",
    );
    const poorFront = discovery(
      poor,
      "front-product",
    );

    expect(poorBuried).toBeLessThan(
      healthyBuried,
    );
    expect(poorFront).toBeLessThanOrEqual(
      healthyFront,
    );
    expect(
      poorBuried / healthyBuried,
    ).toBeLessThan(
      poorFront / healthyFront,
    );
  });
});

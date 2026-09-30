import {
  evidenceRefSchema,
  type BusinessStateEvidenceProvider,
  type EvidenceRef,
  type EvidenceRequest,
} from "./schema.js";
import { InMemoryEvidenceProvider } from "./collector.js";

interface KivviqRevenueFact {
  readonly metricId: string;
  readonly definition: string;
  readonly salesChannel: string;
  readonly period: {
    readonly from: string;
    readonly to: string;
  };
  readonly source: string;
  readonly sourceUpdatedAt: string;
  readonly freshness: string;
  readonly currency: string;
  readonly value: number;
  readonly field: string;
}

export interface KivviqShopifyCommercePack {
  readonly generatedAt: string;
  readonly shopify: {
    readonly currency: string;
    readonly sourceUpdatedAt: string;
    readonly orders: number;
    readonly breakdown: {
      readonly grossSales: number;
      readonly discounts: number;
      readonly netSales: number;
    };
    readonly revenueFacts: readonly KivviqRevenueFact[];
    readonly servedRange: {
      readonly from: string;
      readonly to: string;
    };
    readonly truncated: boolean;
  };
  readonly availability: {
    readonly shopify: boolean;
  };
}

export interface KivviqCommerceShadowBinding {
  readonly merchantId: string;
  readonly currency: string;
  readonly asOf: string;
  /** Inclusive dates exactly as returned by the Kivviq Shopify evidence pack. */
  readonly servedFrom: string;
  readonly servedTo: string;
  /** Half-open canonical Business State interval. */
  readonly periodStart: string;
  readonly periodEnd: string;
}

function assertFiniteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(label + " must be a finite non-negative number");
  }
}

function ageSeconds(observedAt: string, asOf: string): number {
  const observed = Date.parse(observedAt);
  const cutoff = Date.parse(asOf);
  if (!Number.isFinite(observed) || !Number.isFinite(cutoff)) {
    throw new RangeError("Kivviq evidence timestamps must be valid ISO timestamps");
  }
  if (observed > cutoff) {
    throw new RangeError("Kivviq evidence cannot be observed after shadow asOf");
  }
  return Math.max(0, (cutoff - observed) / 1_000);
}

function exactNetSalesFact(
  pack: KivviqShopifyCommercePack,
  binding: KivviqCommerceShadowBinding,
): KivviqRevenueFact {
  const matches = pack.shopify.revenueFacts.filter(
    (fact) =>
      fact.metricId === "shopify_section_net_sales" &&
      fact.salesChannel === "all_channels" &&
      fact.period.from === binding.servedFrom &&
      fact.period.to === binding.servedTo &&
      fact.source === "Shopify Admin API" &&
      fact.currency === binding.currency &&
      fact.freshness === "fresh",
  );

  if (matches.length !== 1) {
    throw new RangeError(
      "Shadow mode requires exactly one fresh all-channel Shopify net-sales fact for the exact served period",
    );
  }
  return matches[0]!;
}

export function kivviqShopifyCommerceEvidence(
  pack: KivviqShopifyCommercePack,
  binding: KivviqCommerceShadowBinding,
): readonly EvidenceRef[] {
  if (!pack.availability.shopify) {
    throw new RangeError("Shopify is unavailable in the Kivviq evidence pack");
  }
  if (pack.shopify.truncated) {
    throw new RangeError("Truncated Shopify evidence cannot establish canonical store state");
  }
  if (
    pack.shopify.servedRange.from !== binding.servedFrom ||
    pack.shopify.servedRange.to !== binding.servedTo
  ) {
    throw new RangeError(
      "Kivviq served range does not exactly match the requested shadow range",
    );
  }
  if (pack.shopify.currency !== binding.currency) {
    throw new RangeError("Kivviq Shopify currency does not match Business State currency");
  }

  const net = exactNetSalesFact(pack, binding);
  assertFiniteNonNegative(net.value, "Shopify net sales");
  assertFiniteNonNegative(pack.shopify.orders, "Shopify orders");
  if (!Number.isInteger(pack.shopify.orders)) {
    throw new RangeError("Shopify orders must be an integer");
  }
  assertFiniteNonNegative(pack.shopify.breakdown.grossSales, "Shopify gross sales");
  assertFiniteNonNegative(pack.shopify.breakdown.discounts, "Shopify discounts");
  assertFiniteNonNegative(pack.shopify.breakdown.netSales, "Shopify breakdown net sales");

  if (Math.abs(pack.shopify.breakdown.netSales - net.value) > 0.01) {
    throw new RangeError(
      "Shopify net-sales fact and commerce breakdown do not reconcile",
    );
  }

  const discountRate =
    pack.shopify.breakdown.grossSales === 0
      ? 0
      : pack.shopify.breakdown.discounts /
        pack.shopify.breakdown.grossSales;
  if (discountRate < 0 || discountRate > 1) {
    throw new RangeError("Derived Shopify discount rate is outside [0, 1]");
  }

  const observedAt = net.sourceUpdatedAt;
  const freshnessSeconds = ageSeconds(observedAt, binding.asOf);
  const common = {
    merchantId: binding.merchantId,
    periodKind: "CURRENT" as const,
    periodStart: binding.periodStart,
    periodEnd: binding.periodEnd,
    observedAt,
    coverage: 1,
    freshnessSeconds,
  };

  return [
    evidenceRefSchema.parse({
      ...common,
      evidenceId:
        "kivviq:shopify:net-sales:" +
        binding.servedFrom +
        ":" +
        binding.servedTo,
      metricId: "revenue_net",
      source: "SHOPIFY",
      value: net.value,
      currency: binding.currency,
      provenance:
        "Kivviq Shopify Admin API; shopify_section_net_sales; all_channels; exact served range",
    }),
    evidenceRefSchema.parse({
      ...common,
      evidenceId:
        "kivviq:shopify:orders:" +
        binding.servedFrom +
        ":" +
        binding.servedTo,
      metricId: "orders",
      source: "SHOPIFY",
      value: pack.shopify.orders,
      sampleSize: pack.shopify.orders,
      provenance:
        "Kivviq Shopify Admin API; eligible all-channel order count; exact served range",
    }),
    evidenceRefSchema.parse({
      ...common,
      evidenceId:
        "kivviq:shopify:discount-rate:" +
        binding.servedFrom +
        ":" +
        binding.servedTo,
      metricId: "discount_rate",
      source: "SHOPIFY",
      value: discountRate,
      provenance:
        "Derived only from same-pack Shopify discounts / gross sales; exact served range",
    }),
  ];
}

export function createKivviqShopifyCommerceProvider(
  pack: KivviqShopifyCommercePack,
  binding: KivviqCommerceShadowBinding,
): BusinessStateEvidenceProvider {
  const provider = new InMemoryEvidenceProvider(
    kivviqShopifyCommerceEvidence(pack, binding),
  );
  return {
    getEvidence(request: EvidenceRequest) {
      return provider.getEvidence(request);
    },
  };
}

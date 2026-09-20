import {
  COMPLEXITY_LEVELS,
  MERCHANT_ARCHETYPES,
  MERCHANT_SCALES,
  type MerchantGenerationConfig,
} from "./config.js";
import { generateMerchantWorldRecord } from "./generator.js";

class RunningStats {
  private count = 0;
  private meanValue = 0;
  private m2 = 0;
  private minValue = Number.POSITIVE_INFINITY;
  private maxValue = Number.NEGATIVE_INFINITY;

  public push(value: number): void {
    this.count += 1;
    const delta = value - this.meanValue;
    this.meanValue += delta / this.count;
    const delta2 = value - this.meanValue;
    this.m2 += delta * delta2;
    this.minValue = Math.min(this.minValue, value);
    this.maxValue = Math.max(this.maxValue, value);
  }

  public snapshot() {
    return {
      count: this.count,
      mean: this.meanValue,
      standardDeviation:
        this.count > 1 ? Math.sqrt(this.m2 / (this.count - 1)) : 0,
      min: this.minValue,
      max: this.maxValue,
    };
  }
}

export interface DiversityBenchmarkReport {
  readonly count: number;
  readonly uniqueWorldIds: number;
  readonly uniqueExactSummarySignatures: number;
  readonly exactDuplicateRate: number;
  readonly coarseSignatureCount: number;
  readonly maxCoarseSignatureShare: number;
  readonly activeChannelCombinationCount: number;
  readonly responseCurveKinds: readonly string[];
  readonly catalogProfiles: readonly string[];
  readonly promotionProfiles: readonly string[];
  readonly seasonalityProfiles: readonly string[];
  readonly inventoryProfiles: readonly string[];
  readonly metrics: Readonly<
    Record<
      string,
      {
        readonly count: number;
        readonly mean: number;
        readonly standardDeviation: number;
        readonly min: number;
        readonly max: number;
      }
    >
  >;
  readonly archetypeCounts: Readonly<Record<string, number>>;
}

function exactSignature(
  summary: ReturnType<typeof generateMerchantWorldRecord>["summary"],
): string {
  return [
    summary.archetype,
    summary.scale,
    summary.complexity,
    summary.businessModel,
    summary.aovProfile,
    summary.expectedAovMinor,
    summary.expectedAnnualOrders,
    summary.skuCount,
    summary.grossMarginRate.toFixed(8),
    summary.repeatProbability.toFixed(8),
    summary.mobileTrafficShare.toFixed(8),
    summary.activeChannels.join(","),
    summary.paidDependence.toFixed(8),
    summary.organicDemandShare.toFixed(8),
    summary.promotionProfile,
    summary.catalogProfile,
    summary.inventoryProfile,
    summary.seasonalityProfile,
    summary.productConcentrationTop5.toFixed(8),
  ].join("|");
}

function coarseSignature(
  summary: ReturnType<typeof generateMerchantWorldRecord>["summary"],
): string {
  return [
    summary.archetype,
    summary.scale,
    summary.businessModel,
    summary.aovProfile,
    Math.round(summary.expectedAovMinor / 2_500),
    Math.round(summary.skuCount / 10),
    Math.round(summary.repeatProbability * 10),
    summary.activeChannels.length,
    summary.promotionProfile,
    summary.catalogProfile,
    summary.inventoryProfile,
    summary.seasonalityProfile,
  ].join("|");
}

export function runDiversityBenchmark(
  count = 10_000,
): DiversityBenchmarkReport {
  if (!Number.isInteger(count) || count <= 0) {
    throw new RangeError("benchmark count must be a positive integer");
  }

  const worldIds = new Set<string>();
  const exactSignatures = new Set<string>();
  const coarseSignatures = new Map<string, number>();
  const channelCombinations = new Set<string>();
  const responseCurveKinds = new Set<string>();
  const catalogProfiles = new Set<string>();
  const promotionProfiles = new Set<string>();
  const seasonalityProfiles = new Set<string>();
  const inventoryProfiles = new Set<string>();
  const archetypeCounts: Record<string, number> = {};

  const metrics = {
    annualRevenuePotentialMinor: new RunningStats(),
    expectedAovMinor: new RunningStats(),
    skuCount: new RunningStats(),
    grossMarginRate: new RunningStats(),
    repeatProbability: new RunningStats(),
    mobileTrafficShare: new RunningStats(),
    channelCount: new RunningStats(),
    paidDependence: new RunningStats(),
    organicDemandShare: new RunningStats(),
    seasonalityStrength: new RunningStats(),
    productConcentrationTop5: new RunningStats(),
    expectedDiscountRate: new RunningStats(),
  };

  for (let index = 0; index < count; index += 1) {
    const config: MerchantGenerationConfig = {
      seed: 1_000_000 + index,
      archetype:
        MERCHANT_ARCHETYPES[index % MERCHANT_ARCHETYPES.length]!,
      scale:
        MERCHANT_SCALES[
          Math.floor(index / MERCHANT_ARCHETYPES.length) %
            MERCHANT_SCALES.length
        ]!,
      complexity:
        COMPLEXITY_LEVELS[
          Math.floor(
            index /
              (MERCHANT_ARCHETYPES.length * MERCHANT_SCALES.length),
          ) % COMPLEXITY_LEVELS.length
        ]!,
    };
    const world = generateMerchantWorldRecord(config);
    const summary = world.summary;

    worldIds.add(world.manifest.worldId);
    exactSignatures.add(exactSignature(summary));
    const coarse = coarseSignature(summary);
    coarseSignatures.set(
      coarse,
      (coarseSignatures.get(coarse) ?? 0) + 1,
    );
    channelCombinations.add([...summary.activeChannels].sort().join(","));
    catalogProfiles.add(summary.catalogProfile);
    promotionProfiles.add(summary.promotionProfile);
    seasonalityProfiles.add(summary.seasonalityProfile);
    inventoryProfiles.add(summary.inventoryProfile);
    for (const curve of world.manifest.responseCurves) {
      responseCurveKinds.add(curve.kind);
    }

    archetypeCounts[summary.archetype] =
      (archetypeCounts[summary.archetype] ?? 0) + 1;

    metrics.annualRevenuePotentialMinor.push(
      summary.annualRevenuePotentialMinor,
    );
    metrics.expectedAovMinor.push(summary.expectedAovMinor);
    metrics.skuCount.push(summary.skuCount);
    metrics.grossMarginRate.push(summary.grossMarginRate);
    metrics.repeatProbability.push(summary.repeatProbability);
    metrics.mobileTrafficShare.push(summary.mobileTrafficShare);
    metrics.channelCount.push(summary.activeChannels.length);
    metrics.paidDependence.push(summary.paidDependence);
    metrics.organicDemandShare.push(summary.organicDemandShare);
    metrics.seasonalityStrength.push(summary.seasonalityStrength);
    metrics.productConcentrationTop5.push(
      summary.productConcentrationTop5,
    );
    metrics.expectedDiscountRate.push(summary.expectedDiscountRate);
  }

  const maxCoarseBucket = Math.max(...coarseSignatures.values());

  return {
    count,
    uniqueWorldIds: worldIds.size,
    uniqueExactSummarySignatures: exactSignatures.size,
    exactDuplicateRate: 1 - exactSignatures.size / count,
    coarseSignatureCount: coarseSignatures.size,
    maxCoarseSignatureShare: maxCoarseBucket / count,
    activeChannelCombinationCount: channelCombinations.size,
    responseCurveKinds: [...responseCurveKinds].sort(),
    catalogProfiles: [...catalogProfiles].sort(),
    promotionProfiles: [...promotionProfiles].sort(),
    seasonalityProfiles: [...seasonalityProfiles].sort(),
    inventoryProfiles: [...inventoryProfiles].sort(),
    metrics: Object.fromEntries(
      Object.entries(metrics).map(([key, stats]) => [
        key,
        stats.snapshot(),
      ]),
    ),
    archetypeCounts,
  };
}

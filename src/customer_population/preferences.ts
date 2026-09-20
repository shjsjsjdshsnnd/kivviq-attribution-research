import type { GroundTruthManifest } from "../ground_truth/manifest.js";
import { SeededRandom } from "../generation/rng.js";
import { clamp, sigmoid } from "./calibration.js";
import type {
  LatentFactorState,
  SparseCategoryPreference,
  SparseProductPreference,
} from "./types.js";

interface ProductEntry {
  readonly productId: string;
  readonly categoryId: string;
  readonly demand: number;
}

interface CategoryEntry {
  readonly categoryId: string;
  readonly demand: number;
  readonly products: readonly ProductEntry[];
}

export interface PreferenceCatalogIndex {
  readonly categories: readonly CategoryEntry[];
  readonly productIds: ReadonlySet<string>;
  readonly categoryIds: ReadonlySet<string>;
}

export function buildPreferenceCatalogIndex(
  manifest: GroundTruthManifest,
): PreferenceCatalogIndex {
  const byCategory = new Map<string, ProductEntry[]>();

  for (const mechanism of manifest.productDemandMechanisms) {
    const list = byCategory.get(mechanism.categoryId) ?? [];
    list.push({
      productId: mechanism.productId,
      categoryId: mechanism.categoryId,
      demand: Math.max(1e-12, Number(mechanism.baseLatentDemandUnits)),
    });
    byCategory.set(mechanism.categoryId, list);
  }

  if (byCategory.size === 0) {
    throw new RangeError(
      "latent customer generation requires at least one merchant category",
    );
  }

  const categories = [...byCategory.entries()]
    .map(([categoryId, products]) => ({
      categoryId,
      demand: products.reduce((sum, product) => sum + product.demand, 0),
      products: [...products].sort((left, right) => right.demand - left.demand),
    }))
    .sort((left, right) => right.demand - left.demand);

  return {
    categories,
    productIds: new Set(
      manifest.productDemandMechanisms.map((mechanism) => mechanism.productId),
    ),
    categoryIds: new Set(categories.map((category) => category.categoryId)),
  };
}

function weightedPickProduct(
  products: readonly ProductEntry[],
  rng: SeededRandom,
  exploration: number,
): ProductEntry {
  const alpha = clamp(1.35 - exploration * 0.8, 0.45, 1.35);
  return rng.weightedPick(
    products.map((product, index) => ({
      value: product,
      weight:
        Math.pow(product.demand, alpha) *
        Math.pow(index + 1, -0.1 * (1 - exploration)),
    })),
  );
}

export function generateSparsePreferences(
  index: PreferenceCatalogIndex,
  factors: LatentFactorState,
  rng: SeededRandom,
  maxCategoryPreferences: number,
  maxProductPreferences: number,
): {
  readonly categoryPreferences: readonly SparseCategoryPreference[];
  readonly productPreferences: readonly SparseProductPreference[];
} {
  const totalDemand = index.categories.reduce(
    (sum, category) => sum + category.demand,
    0,
  );

  const categoryCount = Math.max(
    1,
    Math.min(
      maxCategoryPreferences,
      1 +
        Math.floor(
          sigmoid(
            factors.categoryInvolvement +
              factors.explorationTendency * 0.45,
          ) *
            Math.max(1, maxCategoryPreferences - 1),
        ),
    ),
  );

  const scoredCategories = index.categories
    .map((category) => {
      const demandShare = category.demand / totalDemand;
      const score =
        Math.log(demandShare + 1e-12) * 0.55 +
        factors.categoryInvolvement * 0.4 +
        factors.explorationTendency * 0.16 +
        rng.normal(0, 0.7);
      return { category, score };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, categoryCount);

  const categoryPreferences = scoredCategories.map(({ category, score }) => ({
    categoryId: category.categoryId,
    affinity: clamp(
      sigmoid(
        score +
          factors.categoryInvolvement * 0.65 +
          rng.normal(0, 0.28),
      ),
      0,
      1,
    ),
  }));

  const selectedProducts: ProductEntry[] = [];
  const seen = new Set<string>();
  const productTarget = Math.max(
    1,
    Math.min(
      maxProductPreferences,
      1 +
        Math.floor(
          sigmoid(
            factors.categoryInvolvement +
              factors.explorationTendency * 0.65,
          ) *
            Math.max(1, maxProductPreferences - 1),
        ),
    ),
  );

  let attempts = 0;
  while (
    selectedProducts.length < productTarget &&
    attempts < productTarget * 12
  ) {
    attempts += 1;
    const category = rng.weightedPick(
      scoredCategories.map((entry) => ({
        value: entry.category,
        weight: Math.max(
          1e-9,
          entry.category.demand *
            (0.7 + sigmoid(factors.categoryInvolvement)),
        ),
      })),
    );
    const product = weightedPickProduct(
      category.products,
      rng,
      sigmoid(factors.explorationTendency),
    );
    if (seen.has(product.productId)) continue;
    seen.add(product.productId);
    selectedProducts.push(product);
  }

  const productPreferences = selectedProducts.map((product) => {
    const categoryAffinity =
      categoryPreferences.find(
        (preference) => preference.categoryId === product.categoryId,
      )?.affinity ?? 0.5;
    return {
      productId: product.productId,
      categoryId: product.categoryId,
      affinity: clamp(
        sigmoid(
          categoryAffinity * 1.6 -
            0.8 +
            factors.explorationTendency * 0.18 +
            rng.normal(0, 0.45),
        ),
        0,
        1,
      ),
    };
  });

  return {
    categoryPreferences,
    productPreferences,
  };
}

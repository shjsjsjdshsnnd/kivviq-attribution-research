import {
  estimatedRange,
  opportunityPortfolioSchema,
  type BoundedEstimate,
  type Opportunity,
  type OpportunityPortfolio,
} from "./contract.js";

function safe(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9._:-]+/g, "_").replace(/^([^A-Za-z])/, "r_$1");
  return normalized.length ? normalized : "ref";
}

function aggregateMoney(values: readonly BoundedEstimate[], label: string): BoundedEstimate {
  if (values.some((value) => value.state !== "ESTIMATED" || value.unit !== "MONEY")) {
    return {
      state: "UNKNOWN",
      unit: "MONEY",
      reason: "Portfolio " + label + " is not fully estimable",
      evidenceNeeded: ["Estimated money range for every included opportunity"],
    };
  }
  const estimated = values as Extract<BoundedEstimate, { state: "ESTIMATED" }>[];
  return estimatedRange(
    "MONEY",
    estimated.reduce((sum, value) => sum + value.low, 0),
    estimated.reduce((sum, value) => sum + value.base, 0),
    estimated.reduce((sum, value) => sum + value.high, 0),
    [...new Set(estimated.flatMap((value) => value.evidenceRefs))],
    "ACCOUNTING",
  );
}

function conflicts(opportunities: readonly Opportunity[]): string[] {
  const issues: string[] = [];
  const groups = new Map<string, string[]>();
  for (const item of opportunities) {
    if (item.mutuallyExclusiveGroup) {
      const members = groups.get(item.mutuallyExclusiveGroup) ?? [];
      members.push(item.opportunityId);
      groups.set(item.mutuallyExclusiveGroup, members);
    }
  }
  for (const [group, members] of groups) {
    if (members.length > 1) issues.push("Mutually exclusive alternatives selected in " + group + ": " + members.join(","));
  }
  const keys = new Map<string, string[]>();
  for (const item of opportunities) {
    for (const key of item.conflicts) {
      const members = keys.get(key) ?? [];
      members.push(item.opportunityId);
      keys.set(key, members);
    }
  }
  for (const [key, members] of keys) {
    if (members.length > 1) issues.push("Conflicting control selected for " + key + ": " + members.join(","));
  }
  return issues.sort();
}

function dependencies(opportunities: readonly Opportunity[]): string[] {
  const ids = new Set(opportunities.map((item) => item.opportunityId));
  return opportunities.flatMap((item) =>
    item.prioritization.dependencies
      .filter((dependency) => !ids.has(dependency))
      .map((dependency) => item.opportunityId + " requires " + dependency),
  ).sort();
}

function aggregateRisk(opportunities: readonly Opportunity[]): OpportunityPortfolio["aggregateRisk"] {
  const risk = opportunities.map((item) => item.prioritization.risk);
  if (risk.includes("HIGH")) return "HIGH";
  if (risk.includes("UNKNOWN")) return "UNKNOWN";
  if (risk.includes("MEDIUM")) return "MEDIUM";
  return "LOW";
}

export function buildOpportunityPortfolio(
  portfolioId: string,
  opportunities: readonly Opportunity[],
): OpportunityPortfolio {
  const conflictIssues = conflicts(opportunities);
  const dependencyIssues = dependencies(opportunities);
  const unknown = opportunities.some((item) => item.feasibility.status === "UNKNOWN");
  const blocked = conflictIssues.length > 0 || dependencyIssues.length > 0 || opportunities.some((item) => item.feasibility.status === "BLOCKED");
  return opportunityPortfolioSchema.parse({
    portfolioId: "portfolio_" + safe(portfolioId),
    opportunityIds: opportunities.map((item) => item.opportunityId),
    status: blocked ? "BLOCKED" : unknown ? "UNKNOWN" : "VALID",
    dependencyIssues,
    conflictIssues,
    aggregateContributionImpact: aggregateMoney(opportunities.map((item) => item.prioritization.expectedContributionImpact), "contribution impact"),
    aggregateCost: aggregateMoney(opportunities.map((item) => item.prioritization.cost), "cost"),
    aggregateRisk: aggregateRisk(opportunities),
  });
}

function combinations<T>(items: readonly T[], maxSize: number): T[][] {
  const output: T[][] = [];
  const visit = (start: number, chosen: T[]): void => {
    if (chosen.length > 0) output.push([...chosen]);
    if (chosen.length === maxSize) return;
    for (let index = start; index < items.length; index += 1) {
      chosen.push(items[index]!);
      visit(index + 1, chosen);
      chosen.pop();
    }
  };
  visit(0, []);
  return output;
}

export function generateOpportunityPortfolios(
  opportunities: readonly Opportunity[],
  options: { readonly maxSize?: number; readonly includeBlocked?: boolean } = {},
): OpportunityPortfolio[] {
  const maxSize = Math.max(1, Math.min(options.maxSize ?? 3, 6));
  const candidates = opportunities.filter((item) => item.status !== "NO_ACTION");
  const portfolios = combinations(candidates, maxSize)
    .map((items) => buildOpportunityPortfolio(items.map((item) => item.opportunityId).join("."), items))
    .filter((portfolio) => options.includeBlocked || portfolio.status !== "BLOCKED");
  const noAction = opportunities.find((item) => item.status === "NO_ACTION");
  if (noAction) portfolios.push(buildOpportunityPortfolio("no_action", [noAction]));
  return portfolios.sort((a, b) => a.portfolioId.localeCompare(b.portfolioId));
}

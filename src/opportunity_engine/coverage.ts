import { OPPORTUNITY_TEMPLATES } from "./templates.js";
import type { Opportunity, OpportunityDomain } from "./contract.js";

export const REQUIRED_OPPORTUNITY_DOMAINS: readonly OpportunityDomain[] = [
  "PAID_MEDIA",
  "PRICING",
  "PROMOTION",
  "CRO",
  "MERCHANDISING",
  "INVENTORY",
  "LIFECYCLE",
  "RETENTION",
  "SHIPPING",
  "OPERATIONAL",
  "INVESTIGATION",
];

export interface OpportunityCoverageReport {
  readonly coveredDomains: readonly OpportunityDomain[];
  readonly missingDomains: readonly OpportunityDomain[];
  readonly overConcentration: readonly string[];
}

export function validateTemplateCoverage(): OpportunityCoverageReport {
  const covered = new Set<OpportunityDomain>(OPPORTUNITY_TEMPLATES.map((template) => template.domain));
  const missing = REQUIRED_OPPORTUNITY_DOMAINS.filter((domain) => !covered.has(domain));
  return {
    coveredDomains: [...covered].sort(),
    missingDomains: missing,
    overConcentration: [],
  };
}

export function assessOpportunityCoverage(
  opportunities: readonly Opportunity[],
): OpportunityCoverageReport {
  const covered = [...new Set(opportunities.filter((item) => item.status !== "NO_ACTION").map((item) => item.domain))].sort() as OpportunityDomain[];
  const missing = REQUIRED_OPPORTUNITY_DOMAINS.filter((domain) => !covered.includes(domain));
  const counts = new Map<OpportunityDomain, number>();
  for (const item of opportunities.filter((candidate) => candidate.status !== "NO_ACTION")) {
    counts.set(item.domain, (counts.get(item.domain) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
  const overConcentration = [...counts.entries()]
    .filter(([, count]) => total >= 5 && count / total > 0.6)
    .map(([domain, count]) => domain + " supplies " + count + " of " + total + " candidates");
  return { coveredDomains: covered, missingDomains: missing, overConcentration };
}

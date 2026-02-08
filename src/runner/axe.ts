import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "playwright";
import path from "node:path";
import { writeJson } from "../utils/fs.js";
import type { Logger } from "../utils/logger.js";

export interface AxeImpactCounts {
  critical: number;
  serious: number;
  moderate: number;
  minor: number;
}

export interface AxeSummary {
  violations: number;
  countsByImpact: AxeImpactCounts;
  reportPath: string;
}

const impactLevels: Array<keyof AxeImpactCounts> = [
  "critical",
  "serious",
  "moderate",
  "minor"
];

function countByImpact(violations: Array<{ impact?: string | null }>): AxeImpactCounts {
  const counts: AxeImpactCounts = {
    critical: 0,
    serious: 0,
    moderate: 0,
    minor: 0
  };

  for (const violation of violations) {
    const impact = violation.impact ?? "";
    if (impactLevels.includes(impact as keyof AxeImpactCounts)) {
      counts[impact as keyof AxeImpactCounts] += 1;
    }
  }

  return counts;
}

export async function runAxeScan(page: Page, outDir: string, logger: Logger): Promise<AxeSummary> {
  logger.debug("Running axe-core scan");
  const builder = new AxeBuilder({ page });
  const results = await builder.analyze();
  const reportPath = path.join(outDir, "axe.json");
  await writeJson(reportPath, results);

  const countsByImpact = countByImpact(results.violations);

  return {
    violations: results.violations.length,
    countsByImpact,
    reportPath
  };
}

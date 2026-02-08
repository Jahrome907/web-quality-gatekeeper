import AxeBuilder from "@axe-core/playwright";
import type { Page } from "playwright";
import path from "node:path";
import type { Config } from "../config/schema.js";
import { writeJson } from "../utils/fs.js";
import type { Logger } from "../utils/logger.js";

const MAX_VIOLATIONS = 100;
const MAX_NODES_PER_VIOLATION = 50;
const MAX_HTML_SNIPPET_LENGTH = 500;
const MAX_FAILURE_SUMMARY_LENGTH = 1000;

export interface AxeImpactCounts {
  critical: number;
  serious: number;
  moderate: number;
  minor: number;
}

export interface AxeAffectedNode {
  target: string[];
  htmlSnippet: string;
  failureSummary: string | null;
}

export interface AxeViolationDetail {
  id: string;
  description: string;
  help: string;
  helpUrl: string;
  impact: string | null;
  wcagTags: string[];
  tags: string[];
  nodes: AxeAffectedNode[];
}

export interface AxeScanMetadata {
  totalViolations: number;
  keptViolations: number;
  droppedViolations: number;
  droppedNodes: number;
}

export interface AxeSummary {
  violations: number;
  countsByImpact: AxeImpactCounts;
  reportPath: string;
  details?: AxeViolationDetail[];
  metadata?: AxeScanMetadata;
}

interface AxeResultNodeLike {
  target?: string[];
  html?: string;
  failureSummary?: string;
}

interface AxeResultViolationLike {
  id?: string;
  description?: string;
  help?: string;
  helpUrl?: string;
  impact?: string | null;
  tags?: string[];
  nodes?: AxeResultNodeLike[];
}

interface AxeFilterConfig {
  includeRules?: string[] | undefined;
  excludeRules?: string[] | undefined;
  includeTags?: string[] | undefined;
  excludeTags?: string[] | undefined;
}

const impactLevels: Array<keyof AxeImpactCounts> = ["critical", "serious", "moderate", "minor"];

function countByImpact(violations: AxeResultViolationLike[]): AxeImpactCounts {
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

function sanitizeText(value: string | undefined, maxLength: number): string {
  if (!value) {
    return "";
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized;
}

function sanitizeNode(node: AxeResultNodeLike): AxeAffectedNode {
  const target = Array.isArray(node.target) ? node.target.slice(0, 10).map((entry) => String(entry)) : [];
  const htmlSnippet = sanitizeText(node.html, MAX_HTML_SNIPPET_LENGTH);
  const failureSummaryRaw = sanitizeText(node.failureSummary, MAX_FAILURE_SUMMARY_LENGTH);

  return {
    target,
    htmlSnippet,
    failureSummary: failureSummaryRaw.length > 0 ? failureSummaryRaw : null
  };
}

function extractWcagTags(tags: string[]): string[] {
  function wcagSortKey(tag: string): { section: number; normalized: string } {
    const match = /^wcag(\d+)/i.exec(tag);
    return {
      section: match ? Number.parseInt(match[1]!, 10) : Number.MAX_SAFE_INTEGER,
      normalized: tag.toLowerCase()
    };
  }

  return tags
    .filter((tag) => /^wcag\d+[a-z]?/i.test(tag))
    .sort((left, right) => {
      const leftKey = wcagSortKey(left);
      const rightKey = wcagSortKey(right);
      if (leftKey.section !== rightKey.section) {
        return leftKey.section - rightKey.section;
      }
      return leftKey.normalized.localeCompare(rightKey.normalized);
    });
}

function extractDetails(
  violations: AxeResultViolationLike[]
): { details: AxeViolationDetail[]; metadata: AxeScanMetadata } {
  const details: AxeViolationDetail[] = [];
  let droppedNodes = 0;

  for (const violation of violations.slice(0, MAX_VIOLATIONS)) {
    const nodes = Array.isArray(violation.nodes) ? violation.nodes : [];
    const keptNodes = nodes.slice(0, MAX_NODES_PER_VIOLATION).map((node) => sanitizeNode(node));
    droppedNodes += Math.max(0, nodes.length - keptNodes.length);

    const tags = Array.isArray(violation.tags) ? violation.tags.map((tag) => String(tag)) : [];
    const wcagTags = extractWcagTags(tags);

    details.push({
      id: violation.id ? String(violation.id) : "unknown-rule",
      description: violation.description ? String(violation.description) : "",
      help: violation.help ? String(violation.help) : "",
      helpUrl: violation.helpUrl ? String(violation.helpUrl) : "",
      impact: violation.impact ? String(violation.impact) : null,
      wcagTags,
      tags,
      nodes: keptNodes
    });
  }

  const metadata: AxeScanMetadata = {
    totalViolations: violations.length,
    keptViolations: details.length,
    droppedViolations: Math.max(0, violations.length - details.length),
    droppedNodes
  };

  return { details, metadata };
}

function applyFilterConfig(builder: AxeBuilder, filters: AxeFilterConfig | undefined): AxeBuilder {
  if (!filters) {
    return builder;
  }

  if (filters.includeRules?.length) {
    builder.withRules(filters.includeRules);
  }
  if (filters.excludeRules?.length) {
    builder.disableRules(filters.excludeRules);
  }
  if (filters.includeTags?.length) {
    builder.withTags(filters.includeTags);
  }

  return builder;
}

function applyViolationTagExclusions(
  violations: AxeResultViolationLike[],
  excludedTags: string[] | undefined
): AxeResultViolationLike[] {
  if (!excludedTags?.length) {
    return violations;
  }

  const excluded = new Set(excludedTags.map((tag) => tag.toLowerCase()));
  return violations.filter((violation) => {
    const tags = Array.isArray(violation.tags) ? violation.tags : [];
    return !tags.some((tag) => excluded.has(String(tag).toLowerCase()));
  });
}

function createAxeBuilder(page: Page): AxeBuilder {
  const options = { page };

  try {
    const builderConstructor = AxeBuilder as unknown as new (value: { page: Page }) => AxeBuilder;
    return new builderConstructor(options);
  } catch {
    const builderFactory = AxeBuilder as unknown as (value: { page: Page }) => AxeBuilder;
    return builderFactory(options);
  }
}

export async function runAxeScan(
  page: Page,
  outDir: string,
  logger: Logger,
  config: Config | null = null
): Promise<AxeSummary> {
  logger.debug("Running axe-core scan");

  let builder = createAxeBuilder(page);
  builder = applyFilterConfig(builder, config?.axe);

  const results = await builder.analyze();
  const reportPath = path.join(outDir, "axe.json");
  await writeJson(reportPath, results);

  const rawViolations = (results.violations ?? []) as AxeResultViolationLike[];
  const violations = applyViolationTagExclusions(rawViolations, config?.axe?.excludeTags);
  const countsByImpact = countByImpact(violations);
  const { details, metadata } = extractDetails(violations);

  return {
    violations: violations.length,
    countsByImpact,
    reportPath,
    details,
    metadata
  };
}

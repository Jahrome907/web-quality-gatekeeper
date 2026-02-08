import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAnalyze = vi.fn();
const mockWithRules = vi.fn();
const mockDisableRules = vi.fn();
const mockWithTags = vi.fn();
const mockWriteJson = vi.fn();

class MockAxeBuilder {
  withRules = mockWithRules;
  disableRules = mockDisableRules;
  withTags = mockWithTags;
  analyze = mockAnalyze;

  constructor(_options: unknown) {}
}

vi.mock("@axe-core/playwright", () => ({
  default: MockAxeBuilder
}));
vi.mock("../src/utils/fs.js", async () => {
  const actual = await vi.importActual("../src/utils/fs.js");
  return {
    ...actual,
    writeJson: mockWriteJson
  };
});

describe("axe runner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("handles empty violation payload", async () => {
    mockAnalyze.mockResolvedValue({ violations: [] });

    const { runAxeScan } = await import("../src/runner/axe.js");
    const summary = await runAxeScan(
      {} as never,
      "/tmp/artifacts",
      { debug: vi.fn() } as never,
      null
    );

    expect(summary.violations).toBe(0);
    expect(summary.countsByImpact).toEqual({
      critical: 0,
      serious: 0,
      moderate: 0,
      minor: 0
    });
    expect(summary.details).toEqual([]);
    expect(summary.metadata).toEqual({
      totalViolations: 0,
      keptViolations: 0,
      droppedViolations: 0,
      droppedNodes: 0
    });
  });

  it("extracts WCAG tags and preserves multi-violation detail payloads", async () => {
    mockAnalyze.mockResolvedValue({
      violations: [
        {
          id: "color-contrast",
          description: "Insufficient contrast",
          help: "Elements must have sufficient color contrast",
          helpUrl: "https://example.com/help",
          impact: "serious",
          tags: ["wcag2aa", "wcag143", "cat.color"],
          nodes: [
            {
              target: ["#title", 42, "main h1"] as unknown as string[],
              html: "<h1>  Headline   </h1>",
              failureSummary: "  Fix contrast ratio  "
            }
          ]
        },
        {
          id: "image-alt",
          description: "Images require alt text",
          help: "Provide alt attributes",
          helpUrl: "https://example.com/image-alt",
          impact: "critical",
          tags: ["wcag111", "cat.text-alternatives"],
          nodes: []
        }
      ]
    });

    const { runAxeScan } = await import("../src/runner/axe.js");
    const summary = await runAxeScan(
      {} as never,
      "/tmp/artifacts",
      { debug: vi.fn() } as never,
      null
    );

    expect(summary.violations).toBe(2);
    expect(summary.countsByImpact).toEqual({
      critical: 1,
      serious: 1,
      moderate: 0,
      minor: 0
    });
    expect(summary.details).toHaveLength(2);
    expect(summary.details?.[0]?.wcagTags.slice().sort()).toEqual(["wcag143", "wcag2aa"]);
    expect(summary.details?.[0]?.tags).toEqual(["wcag2aa", "wcag143", "cat.color"]);
    expect(summary.details?.[0]?.nodes[0]).toEqual({
      target: ["#title", "42", "main h1"],
      htmlSnippet: "<h1> Headline </h1>",
      failureSummary: "Fix contrast ratio"
    });
    expect(summary.details?.[1]?.wcagTags).toEqual(["wcag111"]);
    expect(summary.metadata).toEqual({
      totalViolations: 2,
      keptViolations: 2,
      droppedViolations: 0,
      droppedNodes: 0
    });
  });

  it("applies include/exclude filter config and post-filters excluded tags", async () => {
    mockAnalyze.mockResolvedValue({
      violations: [
        {
          id: "allowed-rule",
          impact: "minor",
          tags: ["wcag111", "cat.good"],
          nodes: []
        },
        {
          id: "excluded-by-tag",
          impact: "critical",
          tags: ["cat.ignore-me"],
          nodes: []
        }
      ]
    });

    const { runAxeScan } = await import("../src/runner/axe.js");
    const summary = await runAxeScan(
      {} as never,
      "/tmp/out",
      { debug: vi.fn() } as never,
      {
        axe: {
          includeRules: ["color-contrast"],
          excludeRules: ["region"],
          includeTags: ["wcag2a"],
          excludeTags: ["cat.ignore-me"]
        }
      } as never
    );

    expect(mockWithRules).toHaveBeenCalledWith(["color-contrast"]);
    expect(mockDisableRules).toHaveBeenCalledWith(["region"]);
    expect(mockWithTags).toHaveBeenCalledWith(["wcag2a"]);
    expect(summary.violations).toBe(1);
    expect(summary.details?.[0]?.id).toBe("allowed-rule");
  });

  it("normalizes missing fields to safe defaults", async () => {
    mockAnalyze.mockResolvedValue({
      violations: [
        {
          nodes: [{}]
        }
      ]
    });

    const { runAxeScan } = await import("../src/runner/axe.js");
    const summary = await runAxeScan(
      {} as never,
      "/tmp/out",
      { debug: vi.fn() } as never,
      null
    );

    expect(summary.details?.[0]).toEqual({
      id: "unknown-rule",
      description: "",
      help: "",
      helpUrl: "",
      impact: null,
      wcagTags: [],
      tags: [],
      nodes: [
        {
          target: [],
          htmlSnippet: "",
          failureSummary: null
        }
      ]
    });
  });

  it("truncates long html snippets, failure summaries, and target arrays", async () => {
    mockAnalyze.mockResolvedValue({
      violations: [
        {
          id: "huge-node",
          impact: "moderate",
          tags: ["wcag2a"],
          nodes: [
            {
              target: Array.from({ length: 20 }, (_, i) => `#node-${i}`),
              html: "h".repeat(700),
              failureSummary: "f".repeat(1300)
            }
          ]
        }
      ]
    });

    const { runAxeScan } = await import("../src/runner/axe.js");
    const summary = await runAxeScan(
      {} as never,
      "/tmp/out",
      { debug: vi.fn() } as never,
      null
    );

    const node = summary.details?.[0]?.nodes[0];
    expect(node?.target).toHaveLength(10);
    expect(node?.htmlSnippet.length).toBe(501);
    expect(node?.failureSummary?.length).toBe(1001);
    expect(node?.htmlSnippet.endsWith("…")).toBe(true);
    expect(node?.failureSummary?.endsWith("…")).toBe(true);
  });

  it("caps stored nodes and tracks droppedNodes metadata", async () => {
    mockAnalyze.mockResolvedValue({
      violations: [
        {
          id: "many-nodes",
          impact: "serious",
          tags: ["wcag2a"],
          nodes: Array.from({ length: 55 }, (_, i) => ({
            target: [`#item-${i}`],
            html: `<div>${i}</div>`,
            failureSummary: `failure-${i}`
          }))
        }
      ]
    });

    const { runAxeScan } = await import("../src/runner/axe.js");
    const summary = await runAxeScan(
      {} as never,
      "/tmp/out",
      { debug: vi.fn() } as never,
      null
    );

    expect(summary.details?.[0]?.nodes).toHaveLength(50);
    expect(summary.metadata?.droppedNodes).toBe(5);
  });

  it("caps stored violations and tracks droppedViolations metadata", async () => {
    mockAnalyze.mockResolvedValue({
      violations: Array.from({ length: 105 }, (_, i) => ({
        id: `rule-${i}`,
        impact: i % 2 === 0 ? "critical" : "minor",
        tags: [],
        nodes: []
      }))
    });

    const { runAxeScan } = await import("../src/runner/axe.js");
    const summary = await runAxeScan(
      {} as never,
      "/tmp/out",
      { debug: vi.fn() } as never,
      null
    );

    expect(summary.violations).toBe(105);
    expect(summary.details).toHaveLength(100);
    expect(summary.metadata).toEqual({
      totalViolations: 105,
      keptViolations: 100,
      droppedViolations: 5,
      droppedNodes: 0
    });
  });

  it("writes the raw axe report artifact", async () => {
    const payload = {
      violations: [{ id: "color-contrast", impact: "serious", tags: [], nodes: [] }]
    };
    mockAnalyze.mockResolvedValue(payload);

    const { runAxeScan } = await import("../src/runner/axe.js");
    await runAxeScan(
      {} as never,
      "/tmp/custom-out",
      { debug: vi.fn() } as never,
      null
    );

    expect(mockWriteJson).toHaveBeenCalledWith(path.join("/tmp/custom-out", "axe.json"), payload);
  });
});

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("maintainer documentation", () => {
  it("keeps contributor guidance linked to architecture and release references", () => {
    const contributing = readRepoFile("CONTRIBUTING.md");
    const readme = readRepoFile("README.md");

    expect(contributing).toContain("docs/engineering/ARCHITECTURE_MAP.md");
    expect(contributing).toContain("docs/engineering/RELEASE_HANDOFF.md");
    expect(contributing).toContain("docs/testing-matrix.md");
    expect(contributing).toContain("npx playwright install --with-deps chromium");
    expect(contributing).toContain("npx playwright install chromium");
    expect(readme).toContain("docs/engineering/ARCHITECTURE_MAP.md");
    expect(readme).toContain("docs/engineering/RELEASE_HANDOFF.md");
  });

  it("publishes architecture and release handoff docs with maintainer gate references", () => {
    const architecturePath = path.join(process.cwd(), "docs/engineering/ARCHITECTURE_MAP.md");
    const handoffPath = path.join(process.cwd(), "docs/engineering/RELEASE_HANDOFF.md");

    expect(existsSync(architecturePath)).toBe(true);
    expect(existsSync(handoffPath)).toBe(true);

    const architecture = readFileSync(architecturePath, "utf8");
    const handoff = readFileSync(handoffPath, "utf8");

    expect(architecture).toContain("src/cli.ts");
    expect(architecture).toContain("src/index.ts");
    expect(architecture).toContain("action.yml");
    expect(architecture).toContain("scripts/ci/*");
    expect(handoff).toContain("npm run release:dry-run");
    expect(handoff).toContain("npm run validate:full");
    expect(handoff).toContain("overrides.yauzl = 3.2.1");
    expect(handoff).toContain("repo-settings verification");
  });
});

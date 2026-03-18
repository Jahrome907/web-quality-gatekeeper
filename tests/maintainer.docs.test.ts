import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("maintainer documentation", () => {
  it("keeps contributor guidance linked to architecture references", () => {
    const contributing = readRepoFile("CONTRIBUTING.md");
    const readme = readRepoFile("README.md");

    expect(contributing).toContain("docs/engineering/ARCHITECTURE_MAP.md");
    expect(contributing).toContain("docs/testing-matrix.md");
    expect(contributing).toContain("npx playwright install --with-deps chromium");
    expect(contributing).toContain("npx playwright install chromium");
    expect(readme).toContain("docs/engineering/ARCHITECTURE_MAP.md");
    expect(readme).toContain("docs/testing-matrix.md");
  });

  it("publishes architecture doc with maintainer gate references", () => {
    const architecturePath = path.join(process.cwd(), "docs/engineering/ARCHITECTURE_MAP.md");

    expect(existsSync(architecturePath)).toBe(true);

    const architecture = readFileSync(architecturePath, "utf8");

    expect(architecture).toContain("src/cli.ts");
    expect(architecture).toContain("src/index.ts");
    expect(architecture).toContain("action.yml");
    expect(architecture).toContain("scripts/ci/*");
  });
});

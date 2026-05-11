import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scaffoldConsumerProject } from "../src/init/scaffold.js";

describe("consumer init scaffold", () => {
  it("writes a non-destructive consumer workflow and config scaffold", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "wqg-init-"));

    try {
      const result = await scaffoldConsumerProject({ cwd, profile: "marketing" });

      expect(result).toEqual({
        profile: "marketing",
        createdFiles: [
          ".github/web-quality/config.json",
          ".github/workflows/web-quality.yml",
          ".github/web-quality/baselines/.gitkeep",
          ".github/web-quality/README.md"
        ]
      });
      await expect(readFile(path.join(cwd, ".github/web-quality/config.json"), "utf8")).resolves.toContain(
        '"policy:marketing"'
      );
      await expect(readFile(path.join(cwd, ".github/workflows/web-quality.yml"), "utf8")).resolves.toContain(
        "Jahrome907/web-quality-gatekeeper@v3"
      );
      await expect(readFile(path.join(cwd, ".github/web-quality/README.md"), "utf8")).resolves.toContain(
        "Profile: `marketing`"
      );
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite existing scaffold files unless force is set", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "wqg-init-existing-"));

    try {
      await scaffoldConsumerProject({ cwd, profile: "docs" });
      await expect(scaffoldConsumerProject({ cwd, profile: "saas" })).rejects.toThrow(
        "Refusing to overwrite existing web-quality files"
      );
      await expect(scaffoldConsumerProject({ cwd, profile: "saas", force: true })).resolves.toMatchObject({
        profile: "saas"
      });
      await expect(readFile(path.join(cwd, ".github/web-quality/config.json"), "utf8")).resolves.toContain(
        '"policy:saas"'
      );
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

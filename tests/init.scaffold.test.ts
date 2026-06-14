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
      await expect(
        readFile(path.join(cwd, ".github/web-quality/config.json"), "utf8")
      ).resolves.toContain('"policy:marketing"');
      await expect(
        readFile(path.join(cwd, ".github/workflows/web-quality.yml"), "utf8")
      ).resolves.toContain("Jahrome907/web-quality-gatekeeper@v3");
      await expect(
        readFile(path.join(cwd, ".github/workflows/web-quality.yml"), "utf8")
      ).resolves.toContain("actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10");
      await expect(
        readFile(path.join(cwd, ".github/workflows/web-quality.yml"), "utf8")
      ).resolves.toContain("actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a");
      await expect(
        readFile(path.join(cwd, ".github/workflows/web-quality.yml"), "utf8")
      ).resolves.toContain("# v6.0.3");
      await expect(
        readFile(path.join(cwd, ".github/workflows/web-quality.yml"), "utf8")
      ).resolves.toContain("# v7.0.1");
      await expect(
        readFile(path.join(cwd, ".github/web-quality/README.md"), "utf8")
      ).resolves.toContain("Profile: `marketing`");
      await expect(
        readFile(path.join(cwd, ".github/web-quality/README.md"), "utf8")
      ).resolves.toContain("Audit the homepage plus primary conversion pages");
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
      await expect(
        scaffoldConsumerProject({ cwd, profile: "saas", force: true })
      ).resolves.toMatchObject({
        profile: "saas"
      });
      await expect(
        readFile(path.join(cwd, ".github/web-quality/config.json"), "utf8")
      ).resolves.toContain('"policy:saas"');
      await expect(
        readFile(path.join(cwd, ".github/web-quality/README.md"), "utf8")
      ).resolves.toContain(
        "Audit landing, pricing, signup, documentation, and app-shell entry points."
      );
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("writes a runnable URL into generated config, workflow, and guidance", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "wqg-init-url-"));

    try {
      await scaffoldConsumerProject({
        cwd,
        profile: "saas",
        url: "https://app.example.com/?a=1&b=2"
      });

      const config = JSON.parse(
        await readFile(path.join(cwd, ".github/web-quality/config.json"), "utf8")
      ) as { urls?: Array<{ name: string; url: string }> };
      const workflow = await readFile(path.join(cwd, ".github/workflows/web-quality.yml"), "utf8");
      const readme = await readFile(path.join(cwd, ".github/web-quality/README.md"), "utf8");

      expect(config.urls).toEqual([{ name: "home", url: "https://app.example.com/?a=1&b=2" }]);
      expect(workflow).toContain("url: 'https://app.example.com/?a=1&b=2'");
      expect(workflow).toContain('WQG_SENSITIVE_AUDIT: "false"');
      expect(workflow).toContain(
        "if: always() && (env.WQG_SENSITIVE_AUDIT != 'true' || env.WQG_ALLOW_SENSITIVE_OUTPUTS == 'true')"
      );
      expect(workflow).toContain("- id: wqg");
      expect(workflow).toContain("path: |");
      expect(workflow).toContain("${{ steps.wqg.outputs.summary-path }}");
      expect(workflow).toContain("${{ steps.wqg.outputs.pr-risk-ledger-md-path }}");
      expect(readme).toContain("The scaffold is pinned to `https://app.example.com/?a=1&b=2`");
      expect(readme).toContain(
        "The generated workflow uploads the default report artifacts through the Action's"
      );
      expect(readme).toContain("wqg audit 'https://app.example.com/?a=1&b=2' \\");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("rejects credential-bearing URLs before writing scaffold files", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "wqg-init-url-secret-"));

    try {
      await expect(
        scaffoldConsumerProject({
          cwd,
          profile: "saas",
          url: "https://alice:secret@app.example.com/"
        })
      ).rejects.toThrow("Username/password in URLs are not allowed");
      await expect(
        readFile(path.join(cwd, ".github/web-quality/config.json"), "utf8")
      ).rejects.toThrow();
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

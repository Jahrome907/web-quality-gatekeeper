import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, "..");

async function readJson(filePath: string) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function runEvidence(args: string[], outDir: string) {
  return execFileAsync(
    "node",
    [path.join(ROOT, "scripts", "ci", "write-release-evidence.mjs"), ...args, "--out-dir", outDir],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        WQG_RELEASE_EVIDENCE_NOW: "2026-07-06T00:00:00.000Z"
      }
    }
  );
}

describe("release evidence artifacts", function () {
  it("writes release provenance and SPDX SBOM artifacts for the release profile", async function () {
    const outDir = await mkdtemp(path.join(tmpdir(), "wqg-release-evidence-"));
    try {
      await runEvidence(["--release-tag", "v9.9.9", "--commit", "abc123"], outDir);

      const provenancePath = path.join(outDir, "release-provenance.json");
      const sbomPath = path.join(outDir, "sbom.spdx.json");
      expect(existsSync(provenancePath)).toBe(true);
      expect(existsSync(sbomPath)).toBe(true);

      const pkg = await readJson(path.join(ROOT, "package.json"));
      const provenance = await readJson(provenancePath);
      expect(provenance.generatedAt).toBe("2026-07-06T00:00:00.000Z");
      expect(provenance.release).toEqual({
        tag: "v9.9.9",
        version: pkg.version,
        commit: "abc123"
      });
      expect(provenance.validation).toEqual({
        profile: "release",
        commands: [
          "npm run engines:check",
          "npm run release:dry-run",
          "npm pack --ignore-scripts --json"
        ]
      });
      expect(
        provenance.artifacts.map(function (artifact: { name: string }) {
          return artifact.name;
        })
      ).toEqual(["release-provenance.json", "sbom.spdx.json"]);

      const sbom = await readJson(sbomPath);
      expect(sbom.spdxVersion).toBe("SPDX-2.3");
      expect(sbom.dataLicense).toBe("CC0-1.0");
      expect(sbom.documentNamespace).toContain("/releases/download/v9.9.9/sbom.spdx.json");
      expect(
        sbom.packages.some(function (pkg: { name: string }) {
          return pkg.name === "web-quality-gatekeeper";
        })
      ).toBe(true);
      const packageNames = new Set(
        sbom.packages.map(function (pkg: { name: string }) {
          return pkg.name;
        })
      );
      expect(packageNames.has("commander")).toBe(true);
      expect(packageNames.has("playwright")).toBe(true);
      expect(packageNames.has("vitest")).toBe(false);
      expect(packageNames.has("eslint")).toBe(false);
      expect(sbom.relationships).toContainEqual({
        spdxElementId: "SPDXRef-DOCUMENT",
        relationshipType: "DESCRIBES",
        relatedSpdxElement: "SPDXRef-Package-web-quality-gatekeeper"
      });
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it("records tarball metadata without publishing local filesystem paths", async function () {
    const outDir = await mkdtemp(path.join(tmpdir(), "wqg-pack-evidence-"));
    try {
      const tarballName = "web-quality-gatekeeper-9.9.9.tgz";
      const tarballPath = path.join(outDir, tarballName);
      const packJsonPath = path.join(outDir, "pack.json");
      await writeFile(tarballPath, "release tarball bytes", "utf8");
      await writeFile(
        packJsonPath,
        JSON.stringify([{ filename: tarballName, size: 21 }], null, 2),
        "utf8"
      );

      await runEvidence(
        ["--release-tag", "v9.9.9", "--commit", "abc123", "--pack-json", packJsonPath],
        outDir
      );

      const provenance = await readJson(path.join(outDir, "release-provenance.json"));
      expect(provenance.tarball).toEqual({
        filename: tarballName,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        size: 21
      });
      expect(provenance.tarball.path).toBeUndefined();
      expect(JSON.stringify(provenance)).not.toContain(outDir);
      expect(JSON.stringify(provenance)).not.toContain(tarballPath);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
  it("logs artifact names without printing local output paths", async function () {
    const outDir = await mkdtemp(path.join(tmpdir(), "wqg-release-log-"));
    try {
      const { stdout } = await runEvidence(["--release-tag", "v9.9.9", "--commit", "abc123"], outDir);

      expect(stdout).toContain("Wrote release evidence artifacts:");
      expect(stdout).toContain("- release-provenance.json");
      expect(stdout).toContain("- sbom.spdx.json");
      expect(stdout).not.toContain(outDir);
      expect(stdout).not.toContain(path.resolve(outDir));
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
  it("records the actual manual npm publish validation profile", async function () {
    const outDir = await mkdtemp(path.join(tmpdir(), "wqg-npm-evidence-"));
    try {
      await runEvidence(
        [
          "--release-tag",
          "v9.9.9",
          "--commit",
          "tag-commit",
          "--validation-profile",
          "npm-publish"
        ],
        outDir
      );

      const provenance = await readJson(path.join(outDir, "release-provenance.json"));
      expect(provenance.release.commit).toBe("tag-commit");
      expect(provenance.validation).toEqual({
        profile: "npm-publish",
        commands: [
          "node scripts/ci/assert-publish-runtime.mjs",
          "npm run engines:check",
          "npm run validate:full",
          "npm run contracts:check",
          "npm run smoke:pack",
          "npm pack --ignore-scripts --json"
        ]
      });
      expect(provenance.validation.commands).not.toContain("npm run release:dry-run");
      expect(provenance.validation.commands).not.toContain("npm run smoke:action");
      expect(provenance.validation.commands).not.toContain("npm run python:smoke");
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});

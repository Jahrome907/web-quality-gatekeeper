import path from "node:path";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  OUTPUT_BUNDLE_MANIFEST,
  prepareOutputBundle,
  validatePreservedOutputDirectory
} from "../src/audit/outputBundle.js";

const roots: string[] = [];

async function createWorkspace() {
  const root = await mkdtemp(path.join(process.cwd(), ".tmp-output-bundle-"));
  roots.push(root);
  return {
    root,
    outDir: path.join(root, "artifacts"),
    baselineDir: path.join(root, "baselines")
  };
}

async function writeStagedFile(stagingDir: string, relativePath: string, content = relativePath) {
  const targetPath = path.join(stagingDir, ...relativePath.split("/"));
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content, "utf8");
}

async function readReceipt(outDir: string) {
  return JSON.parse(await readFile(path.join(outDir, OUTPUT_BUNDLE_MANIFEST), "utf8")) as {
    status: string;
    runId: string;
    generatedFiles: string[];
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("output bundle lifecycle", () => {
  it("replaces only owned generated evidence while preserving baselines, trend snapshots, and user files", async () => {
    const { outDir, baselineDir } = await createWorkspace();
    await mkdir(outDir, { recursive: true });
    await Promise.all([
      writeFile(path.join(outDir, "notes.txt"), "keep this", "utf8"),
      mkdir(baselineDir, { recursive: true }).then(() =>
        writeFile(path.join(baselineDir, "approved.png"), "baseline", "utf8")
      ),
      mkdir(path.join(outDir, ".wqg-history"), { recursive: true }).then(() =>
        writeFile(path.join(outDir, ".wqg-history", "previous.summary.v2.json"), "history", "utf8")
      )
    ]);

    const first = await prepareOutputBundle(outDir, "run-a");
    await Promise.all([
      writeStagedFile(first.stagingDir, "summary.json"),
      writeStagedFile(first.stagingDir, "summary.v2.json"),
      writeStagedFile(first.stagingDir, "axe.json"),
      writeStagedFile(first.stagingDir, "lighthouse.json"),
      writeStagedFile(first.stagingDir, "screenshots/first.png"),
      writeStagedFile(first.stagingDir, "diffs/first.png"),
      writeStagedFile(first.stagingDir, "pages/01-first/screenshots/home.png"),
      writeStagedFile(first.stagingDir, "trends/history.json")
    ]);
    await first.complete();

    const second = await prepareOutputBundle(outDir, "run-b");
    await Promise.all([
      writeStagedFile(second.stagingDir, "summary.json", "current summary"),
      writeStagedFile(second.stagingDir, "summary.v2.json", "current summary v2"),
      writeStagedFile(second.stagingDir, "screenshots/current.png", "current screenshot")
    ]);
    await second.complete();

    expect(await readFile(path.join(outDir, "summary.json"), "utf8")).toBe("current summary");
    expect(existsSync(path.join(outDir, "screenshots", "current.png"))).toBe(true);
    expect(existsSync(path.join(outDir, "screenshots", "first.png"))).toBe(false);
    expect(existsSync(path.join(outDir, "diffs", "first.png"))).toBe(false);
    expect(existsSync(path.join(outDir, "pages", "01-first", "screenshots", "home.png"))).toBe(
      false
    );
    expect(existsSync(path.join(outDir, "axe.json"))).toBe(false);
    expect(existsSync(path.join(outDir, "lighthouse.json"))).toBe(false);
    expect(existsSync(path.join(outDir, "trends", "history.json"))).toBe(false);
    expect(await readFile(path.join(outDir, "notes.txt"), "utf8")).toBe("keep this");
    expect(await readFile(path.join(baselineDir, "approved.png"), "utf8")).toBe("baseline");
    expect(
      await readFile(path.join(outDir, ".wqg-history", "previous.summary.v2.json"), "utf8")
    ).toBe("history");

    expect(await readReceipt(outDir)).toEqual({
      schemaVersion: 1,
      status: "complete",
      runId: "run-b",
      generatedFiles: ["screenshots/current.png", "summary.json", "summary.v2.json"]
    });
  });

  it("leaves a run-specific incomplete receipt after a fatal run and keeps staging outside the published output", async () => {
    const { outDir } = await createWorkspace();
    const first = await prepareOutputBundle(outDir, "completed-run");
    await writeStagedFile(first.stagingDir, "summary.json", "previous complete summary");
    await first.complete();

    const fatal = await prepareOutputBundle(outDir, "fatal-run");
    expect(path.dirname(fatal.stagingDir)).toBe(path.dirname(outDir));
    expect(fatal.stagingDir.startsWith(outDir)).toBe(false);
    await writeStagedFile(fatal.stagingDir, "summary.json", "partial replacement");
    await fatal.abort();

    expect(await readFile(path.join(outDir, "summary.json"), "utf8")).toBe(
      "previous complete summary"
    );
    expect(existsSync(fatal.stagingDir)).toBe(false);
    expect(await readReceipt(outDir)).toEqual({
      schemaVersion: 1,
      status: "incomplete",
      runId: "fatal-run",
      generatedFiles: ["summary.json"]
    });
  });

  it("tracks promoted files in the incomplete receipt so the next completed run removes evidence from a failed finalization", async () => {
    const { outDir } = await createWorkspace();
    const initial = await prepareOutputBundle(outDir, "initial-run");
    await writeStagedFile(initial.stagingDir, "summary.json", "initial");
    await initial.complete();

    const failed = await prepareOutputBundle(outDir, "failed-finalization");
    await Promise.all([
      writeStagedFile(failed.stagingDir, "summary.json", "replacement"),
      writeStagedFile(failed.stagingDir, "screenshots/partial.png", "partial")
    ]);
    await expect(
      failed.complete(async () => {
        throw new Error("snapshot write failed");
      })
    ).rejects.toThrow("snapshot write failed");
    await failed.abort();

    expect(existsSync(path.join(outDir, "screenshots", "partial.png"))).toBe(true);
    expect((await readReceipt(outDir)).generatedFiles).toEqual([
      "screenshots/partial.png",
      "summary.json"
    ]);

    const recovery = await prepareOutputBundle(outDir, "recovery-run");
    await writeStagedFile(recovery.stagingDir, "summary.json", "recovered");
    await recovery.complete();

    expect(await readFile(path.join(outDir, "summary.json"), "utf8")).toBe("recovered");
    expect(existsSync(path.join(outDir, "screenshots", "partial.png"))).toBe(false);
    expect((await readReceipt(outDir)).generatedFiles).toEqual(["summary.json"]);
  });

  it("fails closed for legacy generated artifacts without deleting them", async () => {
    const { outDir } = await createWorkspace();
    await mkdir(outDir, { recursive: true });
    await writeFile(path.join(outDir, "summary.json"), "legacy", "utf8");

    await expect(prepareOutputBundle(outDir, "legacy-run")).rejects.toThrow("legacy WQG artifacts");
    expect(await readFile(path.join(outDir, "summary.json"), "utf8")).toBe("legacy");
    expect(existsSync(path.join(outDir, OUTPUT_BUNDLE_MANIFEST))).toBe(false);
  });

  it("rejects symlinked ownership paths before promotion or deletion", async () => {
    const { root, outDir } = await createWorkspace();
    const first = await prepareOutputBundle(outDir, "symlink-a");
    await writeStagedFile(first.stagingDir, "screenshots/old.png", "old");
    await first.complete();

    const externalPath = path.join(root, "outside.txt");
    await writeFile(externalPath, "outside", "utf8");
    const ownedPath = path.join(outDir, "screenshots", "old.png");
    await rm(ownedPath);
    await symlink(externalPath, ownedPath, "file");

    const next = await prepareOutputBundle(outDir, "symlink-b");
    await writeStagedFile(next.stagingDir, "summary.json");
    await expect(next.complete()).rejects.toThrow("escapes base directory");
    await next.abort();

    expect(await readFile(externalPath, "utf8")).toBe("outside");
    expect((await readReceipt(outDir)).status).toBe("incomplete");
  });

  it("does not overwrite an unowned file at a generated artifact path", async () => {
    const { outDir } = await createWorkspace();
    const bundle = await prepareOutputBundle(outDir, "collision-run");
    await writeFile(path.join(outDir, "summary.json"), "user-owned", "utf8");
    await writeStagedFile(bundle.stagingDir, "summary.json", "generated");

    await expect(bundle.complete()).rejects.toThrow("unowned file");
    await bundle.abort();

    expect(await readFile(path.join(outDir, "summary.json"), "utf8")).toBe("user-owned");
    expect((await readReceipt(outDir)).status).toBe("incomplete");
  });

  it("locks concurrent writers and rejects output overlap for baselines and managed trend paths", async () => {
    const { outDir } = await createWorkspace();
    const active = await prepareOutputBundle(outDir, "active-run");
    await expect(prepareOutputBundle(outDir, "other-run")).rejects.toThrow("already owns");
    await active.abort();

    expect(() => validatePreservedOutputDirectory(outDir, outDir, "Baseline directory")).toThrow(
      "same directory"
    );
    expect(() =>
      validatePreservedOutputDirectory(outDir, path.join(outDir, "baselines"), "Baseline directory")
    ).toThrow("overlap");
    expect(() =>
      validatePreservedOutputDirectory(
        outDir,
        path.join(outDir, ".wqg-history"),
        "Trend history directory"
      )
    ).not.toThrow();
    expect(() =>
      validatePreservedOutputDirectory(
        outDir,
        path.join(outDir, "screenshots"),
        "Trend history directory"
      )
    ).toThrow("overlaps a generated");
  });

  it("uses one lock and receipt for a directory and its junction alias", async () => {
    const { root } = await createWorkspace();
    const actualOutDir = path.join(root, "actual-artifacts");
    const aliasOutDir = path.join(root, "artifact-alias");
    await mkdir(actualOutDir, { recursive: true });
    await symlink(actualOutDir, aliasOutDir, "junction");

    const active = await prepareOutputBundle(actualOutDir, "actual-active");
    await expect(prepareOutputBundle(aliasOutDir, "alias-concurrent")).rejects.toThrow(
      "already owns"
    );
    await active.abort();

    const throughAlias = await prepareOutputBundle(aliasOutDir, "alias-sequential");
    await writeStagedFile(throughAlias.stagingDir, "summary.json", "via alias");
    await throughAlias.complete();
    expect(await readFile(path.join(actualOutDir, "summary.json"), "utf8")).toBe("via alias");

    const throughActual = await prepareOutputBundle(actualOutDir, "actual-sequential");
    await writeStagedFile(throughActual.stagingDir, "summary.json", "via actual");
    await throughActual.complete();
    expect(await readFile(path.join(aliasOutDir, "summary.json"), "utf8")).toBe("via actual");
  });

  it("rejects an output root whose sibling staging and lock paths would escape the workspace", async () => {
    const outDir = process.cwd();
    const parentDir = path.dirname(outDir);
    const prefix = `.${path.basename(outDir)}.wqg-`;
    const before = (await import("node:fs/promises"))
      .readdir(parentDir)
      .then((entries) => entries.filter((entry) => entry.startsWith(prefix)).sort());

    await expect(prepareOutputBundle(outDir, "root-output")).rejects.toThrow(
      "Output directory must be within"
    );

    const after = (await import("node:fs/promises"))
      .readdir(parentDir)
      .then((entries) => entries.filter((entry) => entry.startsWith(prefix)).sort());
    expect(after).toEqual(before);
  });
});

/* global console */
import path from "node:path";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { ROOT, closeFixtureServer, runChecked, startFixtureServer } from "../ci/_shared.mjs";

// Compare actual site revisions, then prove the gate rejects a controlled regression.
const revisions = {
  before: "4b7c42921daf771097968a674a8c964a9a91c87c",
  after: "7ae7578b3802e9865f8b7c4630e9ffb062b845e3"
};
const { stdout: cliVersion } = await runChecked("node", ["dist/cli.js", "--version"]);
const packageVersion = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8")).version;
if (cliVersion.trim() !== "3.2.4" || packageVersion !== "3.2.4") {
  throw new Error(
    "This case study requires the Web Quality Gatekeeper 3.2.4 CLI and source configuration."
  );
}
const output = path.join(ROOT, "artifacts", "case-study", "project-pages");
await mkdir(output, { recursive: true });
const scratch = await mkdtemp(path.join(output, "source-"));
const config = {
  screenshots: [{ name: "project-home", path: "@target", fullPage: true }],
  toggles: { a11y: true, perf: true, visual: false },
  trends: { enabled: false }
};
const configPath = path.join(output, "config.json");
await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

try {
  for (const [label, revision] of Object.entries(revisions)) {
    const archive = path.join(scratch, `${label}.tar`);
    const destination = path.join(scratch, label);
    await mkdir(destination);
    await runChecked("git", ["archive", "--format=tar", `--output=${archive}`, revision, "docs"]);
    await runChecked("tar", ["-xf", archive, "-C", destination]);
  }
  const regression = path.join(scratch, "regression");
  await cp(path.join(scratch, "after"), regression, { recursive: true });
  const htmlPath = path.join(regression, "docs", "index.html");
  const html = await readFile(htmlPath, "utf8");
  const broken = html.replace(/(<img\b[^>]*?)\s+alt="[^"]*"/i, "$1");
  if (broken === html) throw new Error("Expected the report image to have an alt attribute.");
  await writeFile(htmlPath, broken);

  const results = {};
  for (const label of ["before", "after", "regression"]) {
    const server = await startFixtureServer(path.join(scratch, label, "docs"));
    const destination = path.join(output, label);
    await mkdir(destination, { recursive: true });
    let exitCode = 0;
    try {
      await runChecked(
        "node",
        [
          "dist/cli.js",
          "audit",
          server.url,
          "--config",
          configPath,
          "--out",
          destination,
          "--allow-internal-targets"
        ],
        { timeout: 180000 }
      );
    } catch (error) {
      exitCode = error.cause?.code;
      if (!Number.isInteger(exitCode)) throw error;
    } finally {
      await closeFixtureServer(server.server);
    }
    const summary = JSON.parse(await readFile(path.join(destination, "summary.v2.json"), "utf8"));
    results[label] = {
      exitCode,
      status: summary.overallStatus,
      violations: summary.rollup.a11yViolations
    };
    await writeFile(path.join(destination, "exit-code.txt"), `${exitCode}\n`);
    console.log(label, results[label]);
    if (label === "regression") {
      if (exitCode !== 1 || summary.overallStatus !== "fail" || summary.rollup.a11yViolations < 1) {
        throw new Error(
          "The missing-alt regression must fail the accessibility gate with exit code 1."
        );
      }
    } else if (exitCode !== 0 || summary.overallStatus !== "pass") {
      throw new Error(`${label} site did not pass the configured quality gate.`);
    }
  }
  await writeFile(
    path.join(output, "results.json"),
    `${JSON.stringify({ revisions, config, results }, null, 2)}\n`
  );
} finally {
  await rm(scratch, { recursive: true, force: true });
}

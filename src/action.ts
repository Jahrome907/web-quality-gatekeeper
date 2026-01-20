import * as fs from "node:fs";
import * as path from "node:path";
import { runAudit } from "./cli.js";

function getInput(name: string, required = false): string {
  const key = `INPUT_${name.replace(/-/g, "_").toUpperCase()}`;
  const value = process.env[key] || "";
  if (required && !value) {
    throw new Error(`Input required: ${name}`);
  }
  return value;
}

function setOutput(name: string, value: string): void {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    fs.appendFileSync(outputFile, `${name}=${value}\n`, "utf8");
  }
}

function getBooleanInput(name: string, defaultValue: boolean): boolean {
  const value = getInput(name);
  if (!value) return defaultValue;
  return value === "true";
}

async function run(): Promise<void> {
  try {
    const url = getInput("url", true);
    const config = getInput("config") || "configs/default.json";
    const baselineDir = getInput("baseline-dir") || "baselines";
    const outDir = getInput("out-dir") || "artifacts";
    const setBaseline = getBooleanInput("set-baseline", false);
    const failOnA11y = getBooleanInput("fail-on-a11y", true);
    const failOnPerf = getBooleanInput("fail-on-perf", true);
    const failOnVisual = getBooleanInput("fail-on-visual", true);
    const verbose = getBooleanInput("verbose", false);

    const exitCode = await runAudit(url, {
      config,
      out: outDir,
      baselineDir,
      setBaseline,
      failOnA11y,
      failOnPerf,
      failOnVisual,
      verbose,
    });

    const summaryPath = path.join(outDir, "summary.json");
    const reportPath = path.join(outDir, "report.html");

    setOutput("summary-json", summaryPath);
    setOutput("report-html", reportPath);

    if (fs.existsSync(summaryPath)) {
      const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
      setOutput("status", summary.overallStatus || "unknown");
    } else {
      setOutput("status", "unknown");
    }

    process.exitCode = exitCode;
  } catch (error) {
    const message = (error as Error).message || "Unexpected error";
    console.error(message);
    process.exitCode = 1;
  }
}

run();

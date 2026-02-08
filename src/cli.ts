import { Command } from "commander";
import { createRequire } from "node:module";
import { runAudit } from "./index.js";
import { validateUrl, UsageError } from "./utils/url.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

const program = new Command();
program.name("wqg").description("Web Quality Gatekeeper").version(pkg.version);

program
  .command("audit")
  .argument("<url>", "URL to audit")
  .option("--config <path>", "Config file path", "configs/default.json")
  .option("--out <dir>", "Output directory", "artifacts")
  .option("--baseline-dir <dir>", "Baseline directory", "baselines")
  .option("--set-baseline", "Overwrite baseline images", false)
  .option("--no-fail-on-a11y", "Do not fail on accessibility violations")
  .option("--no-fail-on-perf", "Do not fail on performance budget failures")
  .option("--no-fail-on-visual", "Do not fail on visual diffs")
  .option("--verbose", "Verbose logging", false)
  .action(async (url: string, options) => {
    try {
      const { isInternal } = validateUrl(url);
      if (isInternal) {
        const hostname = new URL(url).hostname;
        console.warn(
          `Auditing internal network address (${hostname}). ` +
            `Ensure this is intentional. See SECURITY.md for SSRF guidance.`
        );
      }

      const { exitCode } = await runAudit(url, {
        config: options.config,
        out: options.out,
        baselineDir: options.baselineDir,
        setBaseline: options.setBaseline ?? false,
        failOnA11y: options.failOnA11y ?? true,
        failOnPerf: options.failOnPerf ?? true,
        failOnVisual: options.failOnVisual ?? true,
        verbose: options.verbose ?? false
      });
      process.exitCode = exitCode;
    } catch (error) {
      const message = (error as Error).message || "Unexpected error";
      console.error(message);
      process.exitCode = error instanceof UsageError ? 2 : 1;
    }
  });

program.parseAsync(process.argv);

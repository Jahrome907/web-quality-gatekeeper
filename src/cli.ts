import { Command } from "commander";
import { createRequire } from "node:module";
import { runAudit } from "./index.js";
import { validateUrl, UsageError } from "./utils/url.js";
import { formatSummaryAsMarkdown } from "./report/markdown.js";
import { parseAuditAuth } from "./utils/auth.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

const program = new Command();
program.name("wqg").description("Web Quality Gatekeeper").version(pkg.version);

function collectOption(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

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
  .option("--format <type>", "Output format: json, html, or md", "html")
  .option(
    "--header <header>",
    "Request header in `Name: Value` format. Can be repeated.",
    collectOption,
    [] as string[]
  )
  .option(
    "--cookie <cookie>",
    "Cookie in `name=value` format. Can be repeated.",
    collectOption,
    [] as string[]
  )
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

      const format = options.format as string;
      if (!["json", "html", "md"].includes(format)) {
        throw new UsageError(`Invalid format: ${format}. Use json, html, or md`);
      }

      let auth;
      try {
        auth = parseAuditAuth(options.header ?? [], options.cookie ?? []);
      } catch (error) {
        throw new UsageError((error as Error).message);
      }

      const { exitCode, summary } = await runAudit(url, {
        config: options.config,
        out: options.out,
        baselineDir: options.baselineDir,
        setBaseline: options.setBaseline ?? false,
        failOnA11y: options.failOnA11y ?? true,
        failOnPerf: options.failOnPerf ?? true,
        failOnVisual: options.failOnVisual ?? true,
        verbose: options.verbose ?? false,
        format,
        auth
      });

      // Write summary to stdout when json or md is requested
      if (format === "json") {
        console.log(JSON.stringify(summary, null, 2));
      } else if (format === "md") {
        console.log(formatSummaryAsMarkdown(summary));
      }

      process.exitCode = exitCode;
    } catch (error) {
      const message = (error as Error).message || "Unexpected error";
      console.error(message);
      process.exitCode = error instanceof UsageError ? 2 : 1;
    }
  });

program.parseAsync(process.argv);

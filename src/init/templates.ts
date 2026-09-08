import type { BuiltinPolicyName } from "../config/policies.js";

export interface ConsumerTemplateOptions {
  url?: string;
}

const PROFILE_GUIDANCE: Record<
  BuiltinPolicyName,
  { target: string; cadence: string; baseline: string }
> = {
  marketing: {
    target: "Audit the homepage plus primary conversion pages such as pricing, demo, or contact.",
    cadence: "Run on pull requests that change content, layout, tracking, or design-system code.",
    baseline: "Refresh baselines after intentional visual changes to above-the-fold sections."
  },
  docs: {
    target: "Audit documentation entry points, search pages, and high-traffic guides.",
    cadence:
      "Run on pull requests that change docs templates, navigation, theme assets, or content rendering.",
    baseline:
      "Refresh baselines when navigation, typography, or code-block styling intentionally changes."
  },
  ecommerce: {
    target: "Audit homepage, category, product detail, cart, and checkout-adjacent pages.",
    cadence: "Run before merchandising, checkout, pricing, and theme changes merge.",
    baseline: "Refresh baselines only after approved product-card or checkout UI changes."
  },
  saas: {
    target: "Audit landing, pricing, signup, documentation, and app-shell entry points.",
    cadence: "Run on product UI, onboarding, pricing, and authenticated marketing-flow changes.",
    baseline: "Refresh baselines after intentional app-shell or onboarding flow layout updates."
  }
};

function yamlSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function buildConsumerConfig(
  profile: BuiltinPolicyName,
  options: ConsumerTemplateOptions = {}
): string {
  const config: Record<string, unknown> = {
    extends: [`policy:${profile}`]
  };
  if (options.url) {
    config.urls = [{ name: "home", url: options.url }];
  }
  return `${JSON.stringify(config, null, 2)}\n`;
}

export function buildConsumerWorkflow(options: ConsumerTemplateOptions = {}): string {
  const urlValue = options.url
    ? yamlSingleQuote(options.url)
    : "${{ vars.WQG_URL || 'https://your-site.example' }}";

  return `name: Web Quality Gate

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

env:
  WQG_SENSITIVE_AUDIT: "false"
  WQG_ALLOW_SENSITIVE_OUTPUTS: "false"

jobs:
  web-quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6.0.3
        with:
          persist-credentials: false
      - id: wqg
        uses: Jahrome907/web-quality-gatekeeper@v3
        with:
          url: ${urlValue}
          config-path: .github/web-quality/config.json
          baseline-dir: .github/web-quality/baselines
      - name: Upload artifacts
        if: always() && steps.wqg.outputs.bundle-complete == 'true' && (steps.wqg.outputs.sensitive-audit == 'false' || env.WQG_ALLOW_SENSITIVE_OUTPUTS == 'true')
        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
        with:
          name: wqg-artifacts
          path: \${{ steps.wqg.outputs.artifact-paths }}
          if-no-files-found: warn
`;
}

export function buildConsumerReadme(
  profile: BuiltinPolicyName,
  options: ConsumerTemplateOptions = {}
): string {
  const guidance = PROFILE_GUIDANCE[profile];
  const targetLine = options.url
    ? `The scaffold is pinned to \`${options.url}\`. Update \`.github/web-quality/config.json\` when the audited URL changes.`
    : "Set the repository variable `WQG_URL` to the public URL you want CI to audit, or replace the workflow placeholder with a fixed URL.";
  return `# Web Quality Gate

This directory contains the Web Quality Gatekeeper consumer configuration for this repository.

- Profile: \`${profile}\`
- Config: \`.github/web-quality/config.json\`
- Baselines: \`.github/web-quality/baselines/\`
- Workflow: \`.github/workflows/web-quality.yml\`

## Profile Guidance

- Target coverage: ${guidance.target}
- Suggested cadence: ${guidance.cadence}
- Baseline rule: ${guidance.baseline}

${targetLine}

The generated workflow uploads the current artifact list, including screenshots and per-page
reports, only when the Action reports \`bundle-complete=true\` and \`sensitive-audit=false\`. Baseline images
and saved trend snapshots are not included in this download. Set
\`WQG_ALLOW_SENSITIVE_OUTPUTS=true\` only when publishing sensitive outputs is
intentional.

Before the first CI run, install the CLI and explicitly create visual baselines
from the intended page state:

\`\`\`bash
npm install --save-dev web-quality-gatekeeper
npx playwright install chromium
npx wqg audit --config .github/web-quality/config.json --baseline-dir .github/web-quality/baselines --set-baseline
\`\`\`

Review and commit the PNGs and integrity manifest under
\`.github/web-quality/baselines/\`. Missing baselines fail an enabled visual check;
CI does not silently create them. Refresh baselines only for intentional UI changes
and review the images in the same pull request as that change.

The generated workflow audits the deployed URL, not the pull request's un-deployed
source. Point it at your deployment preview when changes need pre-merge validation.
`;
}

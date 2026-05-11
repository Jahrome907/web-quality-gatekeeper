import type { BuiltinPolicyName } from "../config/policies.js";

export function buildConsumerConfig(profile: BuiltinPolicyName): string {
  return `${JSON.stringify({ extends: [`policy:${profile}`] }, null, 2)}\n`;
}

export function buildConsumerWorkflow(): string {
  return `name: Web Quality Gate

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  web-quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
        with:
          persist-credentials: false
      - uses: Jahrome907/web-quality-gatekeeper@v3
        with:
          url: \${{ vars.WQG_URL || 'https://your-site.example' }}
          config-path: .github/web-quality/config.json
          baseline-dir: .github/web-quality/baselines
`;
}

export function buildConsumerReadme(profile: BuiltinPolicyName): string {
  return `# Web Quality Gate

This directory contains the Web Quality Gatekeeper consumer configuration for this repository.

- Profile: \`${profile}\`
- Config: \`.github/web-quality/config.json\`
- Baselines: \`.github/web-quality/baselines/\`
- Workflow: \`.github/workflows/web-quality.yml\`

Set the repository variable \`WQG_URL\` to the public URL you want CI to audit, or replace the workflow placeholder with a fixed URL.

Refresh visual baselines only for intentional UI changes:

\`\`\`bash
wqg audit https://your-site.example \\
  --config .github/web-quality/config.json \\
  --baseline-dir .github/web-quality/baselines \\
  --set-baseline
\`\`\`
`;
}

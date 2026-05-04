# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability, please do not open a public issue. Instead,
report it privately through GitHub's Private Vulnerability Reporting flow:

- [Open a private report](https://github.com/Jahrome907/web-quality-gatekeeper/security/advisories/new)

Using that flow lets us coordinate a fix and disclosure timeline without exposing the
issue publicly. Code of Conduct concerns should follow `CODE_OF_CONDUCT.md`, not the
security advisory flow.

We aim to acknowledge new reports within 5 business days.

## Security Considerations

### Trusted URLs Only

This tool navigates to URLs and executes JavaScript in a browser context. **Only audit URLs you trust.** A malicious website could:

- Attempt to exploit browser vulnerabilities
- Consume excessive resources (CPU, memory, network)
- Generate misleading or harmful content in reports

Internal/private target policy:

- Internal/private targets are **blocked by default** when running in CI (`CI`/`GITHUB_ACTIONS`) or when authenticated inputs are supplied (`WQG_AUTH_HEADER(S)` / `WQG_AUTH_COOKIE(S)`).
- Blocking applies to the requested URL, DNS resolution failures in sensitive
  mode, redirect destinations, outbound browser HTTP(S) requests, and the
  final URL audited by Lighthouse.
- Internal/private targets remain warning-only in local non-auth runs for development workflows.
- Override blocking only when intentional with `--allow-internal-targets` or `WQG_ALLOW_INTERNAL_TARGETS=true`.
- Public hosts are resolved and pinned before Playwright and Lighthouse runs so redirects and subrequests cannot quietly cross from an approved public target into private network space during sensitive audits.

### Configuration File Security

The configuration file controls which paths are visited and screenshotted. Security measures in place:

- **Screenshot paths** must be relative paths starting with `/` (no external URLs)
- **Timeouts** are capped at 2 minutes to prevent resource exhaustion
- **Screenshot count** is limited to 50 per audit
- **Output directories** must resolve within the current working directory even
  when symlinks are involved

### CI/CD Security

When running in CI environments:

- The GitHub Actions workflow uses `--ignore-scripts` during `npm ci` to prevent malicious postinstall scripts
- Credentials are not persisted after checkout
- Remote audits are blocking by default; relaxed/non-blocking remote mode requires explicit opt-in via `WQG_RELAXED_REMOTE=true`
- If you need authenticated audits, pass credentials via secrets (`WQG_AUTH_HEADER`, `WQG_AUTH_HEADERS`, `WQG_AUTH_COOKIE`, `WQG_AUTH_COOKIES`)
- Sensitive/authenticated runs suppress artifact uploads and PR comments by default (`WQG_SENSITIVE_AUDIT=true` or detected auth inputs)
- Only set `WQG_ALLOW_SENSITIVE_OUTPUTS=true` when you intentionally accept publication risk for artifacts/comments
- Chrome sandbox is disabled only in CI containers where it's required
- Output artifacts may contain screenshots of audited pages and violation metadata; avoid auditing pages with sensitive data visible in public repos

### Chrome Sandbox

- On local machines, Chrome runs with sandbox enabled for additional security
- In CI containers (GitHub Actions, Docker), sandbox is disabled due to container limitations
- If running locally as root (not recommended), sandbox will be disabled

### Report Content

Generated reports (HTML, JSON) may contain:

- Screenshots of audited pages
- DOM snippets from accessibility violations
- Performance timing data
- System information (browser version, environment)

**Do not commit reports from private/internal sites to public repositories.**

### Dependency Security

- Dependencies are automatically updated via Dependabot
- Runtime workflows enforce `npm run security:audit`, which blocks unexcepted high/critical runtime vulnerabilities
- Temporary exceptions must be explicit, owned, and time-bounded in `configs/security/audit-exceptions.json`
- The project requires Node.js 20+ for security updates

# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability, please do not open a public issue. Instead, use GitHub Security Advisories for this repository so we can coordinate a fix and disclosure timeline.

We aim to respond within 5 business days.

## Security Considerations

### Trusted URLs Only

This tool navigates to URLs and executes JavaScript in a browser context. **Only audit URLs you trust.** A malicious website could:

- Attempt to exploit browser vulnerabilities
- Consume excessive resources (CPU, memory, network)
- Generate misleading or harmful content in reports

### Configuration File Security

The configuration file controls which paths are visited and screenshotted. Security measures in place:

- **Screenshot paths** must be relative paths starting with `/` (no external URLs)
- **Timeouts** are capped at 2 minutes to prevent resource exhaustion
- **Screenshot count** is limited to 50 per audit
- **Output directories** must be within the current working directory

### CI/CD Security

When running in CI environments:

- The GitHub Actions workflow uses `--ignore-scripts` during `npm ci` to prevent malicious postinstall scripts
- Credentials are not persisted after checkout
- Chrome sandbox is disabled only in CI containers where it's required
- Output artifacts may contain screenshots of audited pages—avoid auditing pages with sensitive data visible

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
- Run `npm audit` regularly to check for known vulnerabilities
- The project requires Node.js 20+ for security updates

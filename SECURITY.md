# Security policy

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Report it privately to the repository maintainers through the repository's private security-advisory reporting channel, with affected package/version, reproduction steps, impact, and any suggested mitigation.

Maintainers will acknowledge the report, investigate it, coordinate a fix, and publish an advisory when disclosure is appropriate. Do not include credentials, package tokens, customer data, or other secrets in reports.

## Package access

Phase 2 packages are delivered through private GitHub Packages. Use a minimally scoped `read:packages` token with repository access, store it in a secret manager or CI secret, and revoke it if exposure is suspected. Never place a real token in repository configuration or documentation.

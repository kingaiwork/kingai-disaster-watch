# Security Policy

## Scope

This policy applies to the public GitHub repository `kingaiwork/kingai-disaster-watch` (KINGAI Disaster Watch public client).

Public hazard dashboard, publicly served datasets, Pages Functions, and warning/alert presentation. Report safety-impacting misrepresentation or stale warning handling as a vulnerability. Private hazard models and deployment infrastructure are out of scope.

## Report a vulnerability privately

Please **do not open a public issue** containing an exploit, personal data, access tokens, private infrastructure details or other sensitive material.

Use GitHub's **Report a vulnerability** option for this repository if it is available. Otherwise contact the project through **vip@kingai.work** with subject `Security: kingai-disaster-watch`. That address is listed in the KING AI public project materials; do not send credentials or sensitive user records as attachments.

Include:
- affected repository path and commit/release, if known;
- concise description of the impact and reproducible steps;
- a minimal sanitized demonstration, without live secrets;
- any observed effect on public integrity, content safety, authenticity or availability.

Please allow time for verification and coordination before public disclosure. This file does not promise a fixed response SLA, bounty or vulnerability-handling program.

## Security boundaries

- Do not publish private keys, production credentials, internal endpoints or non-public operational evidence.
- Keep security changes reviewable and validate public artifacts before publishing.
- Verify official product/release information from the canonical links in README.md.
- A successful CI check is not proof that a deployed system is secure.
- Do not execute intrusive tests against production services, customer accounts or third-party systems without explicit permission.

## Supported versions

Only actively published material identified by this repository's current README and release history is in scope. Older copies, abandoned forks and third-party reuploads are not implicitly supported.

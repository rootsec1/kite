# Security Policy

Kite is early-stage software. Please do not use public issues for vulnerability reports.

## Reporting a Vulnerability

Use GitHub private vulnerability reporting for this repository when available. If it is unavailable, contact the maintainers privately before publishing details.

Please include:

- A concise description of the issue.
- Reproduction steps.
- Affected operating system and Kite version or commit.
- Whether the issue can mutate Kubernetes resources.
- Any relevant logs or screenshots with secrets removed.

## Kubernetes Safety Scope

Kite must never perform write operations against non-local clusters during development or automated tests. If the app cannot confidently classify a cluster as local, write actions should be blocked or require explicit user confirmation.

Sensitive Kubernetes data, including kubeconfigs, tokens, secrets, logs, YAML, and cluster metadata, should remain local by default. Kite should not add telemetry or cloud sync without an explicit design review and user opt-in.

# Security Policy

## Supported versions

Security fixes are maintained on the latest commit of the `main` branch. Update
to the latest `main` before checking whether a known issue still affects your
deployment. Older commits are not maintained separately.

| Version or revision | Security updates |
| ------------------- | ---------------- |
| Latest `main`       | Supported        |
| Older commits       | Not supported    |

## Reporting a vulnerability

Email [me@reinierhernandez.com](mailto:me@reinierhernandez.com) with the subject
`[wireguard-board] Security report`.

Do not disclose vulnerabilities in public issues, discussions or pull requests.
Use the private email channel above rather than GitHub's public bug report form.

Include as much of the following as possible:

- The affected commit or version and relevant browser or deployment details.
- A description of the vulnerability, its impact and any required conditions.
- Reproduction steps or a minimal proof of concept using test data.
- Relevant sanitized logs, screenshots or code references.
- Any suggested mitigation or fix.

Do not send production API tokens, WireGuard private keys, complete client
configurations or QR codes containing credentials. Use placeholders or disposable
test credentials to demonstrate the issue.

The maintainer will review the report, request clarification when needed and
coordinate a fix and disclosure with the reporter. Please keep the details
private while the report is being investigated and a fix is being prepared.

## Scope

This policy covers the WireGuard Board frontend, its same-origin Node proxy and
their handling of server connections, credentials, client configurations and
dependencies. Examples include cross-site scripting, unintended token or private-key
exposure, credentials being persisted or sent to an unintended destination, and
proxy destination-validation bypasses.

The proxy is public and accepts dynamic public destinations without a board login.
Protected WireGuard operations still require the destination API's token. The proxy
restricts outbound routes and methods, blocks non-public addresses, pins validated
DNS results, rejects redirects and retains HTTPS certificate validation. Report any
bypass of those boundaries privately using the channel above.

The separate [wireguard-api](https://github.com/ragnarok22/wireguard-api) backend
and deployment infrastructure have their own scope. Follow the affected project's
reporting guidance for backend vulnerabilities. If the issue crosses the frontend
and backend boundary, explain both sides in your private report.

For ordinary bugs and feature requests, use the
[public issue templates](https://github.com/ragnarok22/wireguard-board/issues/new/choose).

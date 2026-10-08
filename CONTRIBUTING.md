# Contributing to WireGuard Board

Thanks for helping make WireGuard administration simpler. Contributions to the
interface, API integration, accessibility, tests and documentation are welcome.

Participation is governed by our [Code of Conduct](CODE_OF_CONDUCT.md).

## Reporting issues and suggesting features

Search [existing issues](https://github.com/ragnarok22/wireguard-board/issues)
before opening a new one. Use the
[issue templates](https://github.com/ragnarok22/wireguard-board/issues/new/choose)
to report a bug or suggest a feature.

For bug reports, include reproducible steps, expected and actual behavior, the
board commit or version, browser and operating system, and the backend version
when relevant. Screenshots and sanitized logs are helpful.

For features, describe the problem and the workflow you want to improve. Discuss
larger changes in an issue before implementing them so we can agree on scope.

Never include real API tokens, private keys, complete client configurations or
QR codes containing credentials in public issues or pull requests. Report
vulnerabilities privately using the [Security Policy](SECURITY.md).

Issues specific to server networking or the backend belong in
[wireguard-api](https://github.com/ragnarok22/wireguard-api). For security issues
in that project, follow its own reporting guidance.

## Development setup

See the [README](README.md#local-development) for the supported Node.js versions
and prerequisites. Fork the repository, clone your fork and create a branch from
`main`:

```bash
git clone https://github.com/YOUR-USERNAME/wireguard-board.git
cd wireguard-board
git switch -c improve-peer-search
pnpm install --frozen-lockfile
pnpm dev
```

The board connects through its same-origin proxy. See the
[integration documentation](README.md#integration-with-wireguard-api) for public
destination requirements, backend compatibility and local connection setup.
Automated tests use simulated responses and isolated local HTTP servers; they do
not require a live WireGuard server or privileged networking.

## Project conventions

- Write UI text, documentation, comments and contribution descriptions in English.
- Use kebab-case for project source files, folders and branch names. Preserve
  filenames and directories required by tools, including GitHub community files
  and template discovery paths.
- Keep the interface simple and responsive. Check keyboard navigation, focus,
  accessible labels and contrast when changing UI components.
- Use the existing React, TypeScript, TanStack Query, Zod and UI patterns. Keep
  API response validation at the API boundary and queries isolated by server and
  session.
- Keep tokens and generated private keys out of persistent browser storage, logs,
  fixtures containing real data and the frontend bundle.
- Avoid automatic retries of operations that create peers. Configuration retries
  must not repeat peer creation.
- Keep proxy destinations publicly routable, pin validated DNS addresses, preserve
  TLS verification and reject redirects. Extend the method/route allowlist and its
  tests together when adding API capabilities.
- Prefer small, focused changes. Avoid unrelated refactors and dependency changes.
- Keep `pnpm-lock.yaml` in sync when changing dependencies.
- Fix lint findings rather than suppressing warnings to make checks pass.

## Tests and verification

For bug fixes, start with a focused test that reproduces the failure, then apply
the fix and demonstrate that the test passes. Test observable behavior and
important boundaries rather than mirroring implementation details. Documentation
and other low-impact changes do not need unrelated tests.

Before submitting application changes, run:

```bash
pnpm check
pnpm coverage
pnpm build
```

Coverage must meet the thresholds configured in `vitest.config.ts`. Do not lower
them just to get a change through. For UI changes, also check desktop and mobile
layouts and describe the manual verification in the pull request.

To apply formatting and available lint fixes:

```bash
pnpm format
pnpm lint
```

For documentation-only changes, run `pnpm format:check`.

CI uses Node.js 24 and the pnpm version pinned in `package.json`. Changes to proxy
rate limiting must preserve shared counters, trusted-IP handling and credential
redaction. Changes to metadata transfer must keep imported servers locked and
exclude credentials from exports. Security-header changes must stay consistent
between `vercel.json` and `server/security-headers.ts`.

The deployed smoke test is a separate, manually dispatched workflow using a test
API. It creates and revokes one disposable peer, so use the documented test settings
and do not run it against an unspecified server. Ordinary PR checks need no live
API or Vercel credentials.

## Pull requests

1. Open a pull request against `main` with a clear, descriptive title.
2. Complete the pull request template with the motivation, related issues and
   verification results. Explain any checks that do not apply.
3. Include screenshots for visible UI changes, using sample data without secrets.
4. Update documentation when behavior, setup or commands change.
5. Respond to review feedback and keep the pull request focused.

By submitting a contribution, you agree that it will be distributed under the
project's existing [GNU General Public License, version 3](LICENSE).

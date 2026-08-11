# Code signing & auto-update (B4 + B5)

Status as of this change: **auto-update is fully wired in code; the app is NOT yet
code-signed** — no certificate exists yet. This doc is both the setup guide and the
outstanding action-item list.

## 1. Why this matters together

An unsigned `.exe` triggers Windows SmartScreen's "unknown publisher" warning on every
manual install. Auto-update does not fix that on its own — a background update of an
unsigned binary either gets blocked by Windows or still throws a warning. Both must ship
together.

## 2. Outstanding action item: buy a certificate

Nothing here can be completed without this. Someone needs to:

1. Decide the publishing entity (the pharmacy's business, or your company).
2. Buy a **Windows code signing certificate** from a CA (DigiCert, Sectigo, SSL.com, etc.):
   - **EV (Extended Validation)** — strongly preferred. SmartScreen reputation is
     instant, so warnings disappear from the very first signed release. Requires
     hardware-token/HSM-based key storage (USB token or cloud HSM like Azure Key Vault /
     DigiCert KeyLocker) — EV keys cannot be exported as a plain `.pfx` file anymore.
   - **Standard (OV)** — cheaper and simpler (`.pfx` file + password), but SmartScreen
     reputation builds up over time based on install volume. On a low-volume single-client
     app, expect warnings to persist for **weeks to months** after signing starts. This is
     not a bug in this setup — it's how SmartScreen reputation works — and should be
     communicated to the client up front so it isn't mistaken for "the fix didn't work."
3. Get the resulting credential into CI/build environment as secrets (never into the repo):
   - Standard cert: `CSC_LINK` (path to the `.pfx`, or a base64-encoded blob) and
     `CSC_KEY_PASSWORD`, both as environment variables at build time. `electron-builder`
     auto-detects these — no certificate path or password needs to live in
     `electron-builder.yml`.
   - EV/HSM cert: signing is done via the CA's signing tool (e.g. DigiCert KeyLocker's
     `smctl`/`smpkcs11`) integrated into the build step instead of a plain `CSC_LINK`. The
     specific wiring depends on which HSM the client's CA uses — revisit this once a
     certificate is purchased.
4. Update `electron-builder.yml`'s `win.publisherName` to the exact Subject Name on the
   certificate (currently a placeholder: `PharmaPOS`) — it must match exactly or signing
   fails.

**This step cannot be done from this environment** — it requires a real business identity,
a real purchase, and (for EV) physical hardware-token provisioning. Everything below this
point works once that credential exists.

## 3. Building a signed installer

```bash
export CSC_LINK=/path/to/cert.pfx        # or base64 of the file
export CSC_KEY_PASSWORD=...              # never commit; set in your CI secret store
npm run build:win
```

Verify it actually signed — don't trust a green build:

```powershell
signtool verify /pa dist\scaffold-tmp-<version>-setup.exe
```

(macOS/Linux equivalent: `osslsigncode verify` if cross-checking outside Windows.)

## 4. Release feed: GitHub Releases (public repo)

`electron-builder.yml` already has:

```yaml
publish:
  provider: github
  owner: K4RM-P
  repo: Personal
```

Chosen over a generic/S3 feed because the repo is public — `electron-updater` on the
client machine can then anonymously read release metadata (`latest.yml`) and download
installer assets with **no token embedded in the shipped app**. (A private repo would
require baking a GitHub token into every install, which is extractable from an installed
app — avoided here on purpose.)

Publishing still requires a token, but only on the machine doing the *build/publish*, not
the client's machine:

```bash
export GH_TOKEN=...    # repo-scoped PAT, never committed, used only at publish time
npm run release:win    # builds + signs + uploads installer + latest.yml to the release
```

Confirm network reachability: a pharmacy's normal internet connection reaching
`github.com` / `objects.githubusercontent.com` over HTTPS (443) is all that's required —
no VPN or special firewall rule expected, but this should be confirmed against the actual
client site before go-live.

## 5. Runtime update flow (already implemented)

- `src/main/update/autoUpdate.ts` — checks on startup and every 4 hours while running.
  Downloads automatically in the background (`autoDownload = true`); **never installs**
  until `autoUpdater.quitAndInstall()` is explicitly called, which only happens via:
  - `autoInstallOnAppQuit = true` (applies next natural app quit), or
  - the client clicking "Install & Restart" from the logout prompt when an update is
    ready (`src/renderer/src/components/LogoutConfirmModal.tsx`), or
  - a future explicit "Restart & Update" action if added later.
- Renderer gets a **non-blocking banner** (`UpdateBanner.tsx`) — never a modal — while a
  download is in progress or ready. It never appears over/blocks checkout.
- Settings → **Application Updates** card (`UpdateSettingsCard.tsx`) — manual "Check for
  Updates" button plus current status, for a client who wants to force a check.
- Background check/download failures (no internet, GitHub unreachable) are logged via the
  existing structured logger (`src/main/logging/logger.ts`) and never shown to the cashier
  — see the `autoUpdater.on('error', ...)` handler.

## 6. First-time transition for the client

Auto-update cannot retroactively apply to an already-installed **unsigned** build — there
is no way around one final manual install:

1. Build and publish this version (with signing + auto-update wired) as a new GitHub
   Release using `npm run release:win`.
2. The client manually downloads and runs this one installer — this is the **last** manual
   install they will ever need to do.
3. From that point on: `initAutoUpdater` checks on every app start and every 4 hours,
   finds any newer published release, downloads it in the background, and installs it the
   next time the app is closed/reopened or the client accepts the logout-time prompt.
4. If the client already has an older, unsigned build installed today: confirm before
   handoff that its version number is *lower* than the new signed release's version in
   `package.json` — `electron-updater` on the new build compares semver against
   `latest.yml`, so this only matters if, hypothetically, downgrading were attempted (it
   isn't here, since this is a fresh manual install, not an update of the old binary).

## 7. What's verified vs. not, honestly

Not verifiable from this environment — flagged, not glossed over:

- **No certificate exists yet** — nothing above the "buy a cert" step in §2 has been
  exercised against a real cert. `signingHashAlgorithms`/`publisherName` are configured but
  unverified until a real `CSC_LINK`/`CSC_KEY_PASSWORD` is supplied and a build is run.
- **No Windows machine/VM available here** — SmartScreen behavior (warning present/absent)
  has not been observed firsthand and can't be until a signed build is tested on real
  Windows.
- **No live GitHub Releases publish has been performed** — the `publish` config is
  unchanged from what already existed (`K4RM-P/Personal`, confirmed public), but no test
  release has actually been pushed as part of this change.

### Test plan to run once a certificate exists (do this before calling B4/B5 done)

1. Build a signed installer; run `signtool verify /pa` — confirm signed, not just "build
   succeeded."
2. Fresh-install the signed build on a clean Windows machine/VM — confirm SmartScreen
   behavior; if using a standard (non-EV) cert, expect and document a possible lingering
   warning until reputation builds.
3. Bump `version` in `package.json`, run `npm run release:win` to publish a second release.
4. Confirm an already-running older install detects the new version on its next
   check-for-updates cycle (or force it via Settings → Check for Updates).
5. Start a sale on the older version while a background download is in progress — confirm
   checkout completes normally and nothing installs mid-sale.
6. Close and reopen the app (or use the logout-time "Install & Restart" prompt) — confirm
   the update applies with no manual file handling and no "trust this file" prompt.
7. Confirm the app reports the new version number post-update (e.g. via an About/Settings
   display — add one if none currently exists).
8. Disconnect network before a background check — confirm it fails silently (logged only,
   `type: 'ERROR', source: 'autoUpdater'` in the daily log file) and retries on the next
   4-hour cycle rather than surfacing anything to the cashier.
9. Confirm no in-progress sale is ever interrupted — updates only apply on quit/restart or
   the explicit logout prompt, never live.

## 8. Non-negotiables recap

- Certificate files, passwords, and `GH_TOKEN` are environment/secrets only — never
  committed. Confirmed: nothing in this change adds a cert, key, or token to the repo or
  `electron-builder.yml`.
- No mid-session install: enforced by never calling `quitAndInstall()` except from
  `autoInstallOnAppQuit` (fires on quit) or the explicit logout-prompt button.
- Background failures never surface a scary dialog to the cashier — logged only.

# Desktop updater release runbook

`package.json` is the canonical version. `pnpm version:check` must pass before any bundle is
built; it checks Cargo, Tauri, and the backend fallback version without rewriting them.

## Key setup

Generate the updater key pair once with `pnpm tauri signer generate`. Store the private key
and password in each protected `desktop-internal`, `desktop-pilot`, and `desktop-stable`
GitHub environment as `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Keep an offline, dual-control backup. The public key is
safe to store as the `TAURI_UPDATER_PUBLIC_KEY` environment variable.

Formal macOS builds also require the Developer ID certificate, signing identity, and Apple
notarization credentials listed in `desktop-release.yml`. Windows requires an Azure Artifact
Signing account/profile and its Entra credentials; no `.pfx` private key enters CI.

Each protected environment must also define `UPDATE_BASE_URL`, `NEXT_PUBLIC_API_URL`, the
optional AMap/ASR public settings, and `NEXT_PUBLIC_DESKTOP_UPDATE_CHANNEL`. Set repository
variable `DESKTOP_RELEASE_ENABLED=true` only after the internal environment is fully
provisioned; from then on every master commit runs the signed internal workflow.

## Channels

- `internal`: build from a reviewed master commit and publish first.
- `pilot`: manually dispatch an exact commit SHA. The workflow accepts it only when it is an
  ancestor of master and has a `desktop-internal-<sha>` tag created by a successful internal
  build.
- `stable`: never run a new build. Promote the verified pilot manifest byte-for-byte after
  approval in the protected `desktop-stable` environment.

The updater endpoint is channel-neutral. Every request carries the persisted
`X-ZhiYuan-Update-Channel` header. On first launch, pass
`--update-channel=internal|pilot|stable`; the Rust shell stores it in the app data directory.
An absent or invalid value always defaults to stable. App updates preserve that external
file, so a stable client that installs pilot-tested bytes continues asking for stable
manifests, and a fresh stable installation cannot silently join pilot.

The signed workflow emits installers, updater bundles, and `.sig` files. Prepare the static
manifest input (version, notes, RFC 3339 publication time, HTTPS artifact URL and signature
content per target), then run:

```bash
pnpm update:manifest -- manifest-input.json latest.json
```

Publish artifacts under a versioned, immutable path. The `$UPDATE_BASE_URL/latest.json`
router must select the internal, pilot, or stable manifest from the signed channel header.
Configure that host before enabling a channel; the release build refuses an empty public
key, an HTTP endpoint, or a direct stable build.

`promote-desktop.yml` downloads the currently served pilot manifest, verifies that all three
formal targets and the approved version are present, and emits the same bytes from the
protected stable environment. Publishing that artifact to the stable route is the final
host-specific operation; it cannot be wired until the update host is provisioned.

Ordinary CI uses `build-tauri.yml` and uploads artifacts with `-unsigned` in their names.
Those builds verify portability only and must never be distributed to operators.

# Content Security Policy

The policy shipped in `tauri.conf.json` is an exact allowlist: it names every origin the
packaged app may reach and nothing else. `connect-src` deliberately does **not** include an
API origin, because there is no single correct one — it differs per deployment, and a
default that happened to work for one environment would silently become a permitted
exfiltration target in all the others.

That is the whole point of the directive. A CSP only earns its cost when the list is short
enough that adding to it is a decision someone makes on purpose.

## Local development

`tauri.conf.json` has no localhost origins, so the dev server and local backend are
unreachable under it. Use the overlay:

```bash
pnpm tauri:dev
```

which is `tauri dev --config src-tauri/tauri.dev.conf.json`. The overlay adds
`http://localhost:3000` (Next dev server), `http://localhost:8080` (Spring backend) and
their websocket forms, and is never used by `tauri build`.

## Adding an origin for a deployment

Extend `connect-src` in a build-time overlay rather than editing `tauri.conf.json`, so the
strict baseline stays intact and each environment's additions are visible in one file:

```bash
pnpm tauri build --config path/to/production.conf.json
```

Origins the optional integrations need, if they are enabled:

| Feature        | Directive     | Origins                                                                                      |
| -------------- | ------------- | -------------------------------------------------------------------------------------------- |
| Platform API   | `connect-src` | `https://api.<your-domain>`                                                                  |
| AMap JS API    | `script-src`  | `https://webapi.amap.com`                                                                    |
| AMap JS API    | `connect-src` | `https://restapi.amap.com` `https://webapi.amap.com` or the configured security proxy origin |
| AMap tiles     | `img-src`     | `https://*.amap.com` `https://*.autonavi.com`                                                |
| Volcengine ASR | `connect-src` | `wss://<your-asr-gateway>`                                                                   |

For an AMap-enabled desktop artifact, set `NEXT_PUBLIC_AMAP_KEY` and the HTTPS
`NEXT_PUBLIC_AMAP_SERVICE_HOST`, then run:

```bash
pnpm tauri:build:amap
```

That command derives the exact service-proxy origin (and `NEXT_PUBLIC_API_URL`, when set),
merges only the required AMap sources into a build-time CSP overlay, and leaves
`tauri.conf.json` unchanged. The normal `pnpm tauri build` remains the strict no-map rollback
path. Insecure or credential-bearing deployment URLs are rejected before the build starts.

The ASR entry is our own gateway, not Volcengine: the browser never connects to Volcengine
directly, because the credentials that sign that connection are server-side. See
`lib/voice/volcengine-asr.ts`.

## Directives that are not `'none'`, and why

- **`style-src 'unsafe-inline'`** — Next.js and Tailwind emit inline `style` attributes.
  There is no build flag that removes them, and a nonce cannot be attached to a statically
  exported bundle. This is the one concession in the policy.
- **`img-src data: blob:`** — inlined icons, and canvas output.
- **`worker-src blob:`** — bundler-generated workers are instantiated from blob URLs.

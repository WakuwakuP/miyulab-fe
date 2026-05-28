# AGENTS.md

## Cursor Cloud specific instructions

### Overview

miyulab-fe is a Fediverse (Pleroma/Mastodon/Friendica/Firefish/Misskey) web client built with Next.js 16, React 19, and TypeScript 6. It uses browser-side SQLite WASM for local data storage and WebSocket streaming for real-time timeline updates.

### Development Commands

See `package.json` scripts and `.github/copilot-instructions.md` for the full reference. Key commands:

- `yarn check` — Biome lint & format (must pass before commit)
- `yarn test:run` — Vitest tests (83 files, 1639 tests)
- `yarn dev` — Dev server with HTTPS (runs `copy:sqlite-wasm` then `next dev --experimental-https`)
- `yarn build` — Production build

### Running the Dev Server

The `yarn dev` script uses `--experimental-https` which generates a self-signed cert. For headless/CI environments where HTTPS is not needed, use the local `next` binary directly:

```bash
./node_modules/.bin/next dev --port 3000
```

Run `yarn copy:sqlite-wasm` first if SQLite WASM assets are missing from `public/`.

### Node.js Version

This project requires **Node.js 24** (matching CI). The VM has nvm installed; use:

```bash
export PATH="/home/ubuntu/.nvm/versions/node/v24.16.0/bin:$PATH"
```

to ensure the correct version is on PATH (the `/exec-daemon/node` binary is v22 and should not be used).

### Caveats

- The `prebuild` script (`zenstack generate && zenstack migrate deploy`) requires `DATABASE_URL` for PostgreSQL. It only applies to production builds and query-log features — the dev server runs fine without it.
- SQLite WASM requires COOP/COEP headers (configured in `next.config.mjs`). The app will not function correctly in browsers that don't support SharedArrayBuffer/OPFS.
- The Fediverse backend URL defaults to `https://pl.waku.dev`. No local backend server is needed — the app connects to remote Fediverse instances.
- Husky pre-commit hook runs `yarn check` and `yarn build`. For cloud agent commits, these hooks do not run automatically since the `.git/hooks` path is not configured in the CI-like environment.

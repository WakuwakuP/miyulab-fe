# Weekly package upgrade

Upgrade outdated dependencies in this Yarn 4 / Node.js 24 project, leaving all
successful changes in the working tree. Read `AGENTS.md`, `package.json`, the
Yarn configuration, and relevant implementation before editing.

Use `yarn outdated || true` to inspect available updates. Upgrade packages one
at a time or in tightly related groups, and keep only upgrades that can be made
compatible with the application. Pair packages with their `@types/*`
counterparts, and upgrade these ecosystems together when applicable:

- `react`, `react-dom`, `@types/react`, and `@types/react-dom`
- `tailwindcss` and `@tailwindcss/postcss`
- packages whose versions are coupled by the `resolutions` field

Take special care with Next.js, React, TypeScript, Biome, megalodon, sharp, and
major-version changes. Preserve and update `package.json` resolutions when
needed. Do not force an incompatible major upgrade just because it is newer.

When `@sqlite.org/sqlite-wasm` changes, ensure the effective package version
and `public/sqlite3.wasm` stay synchronized. The project's `yarn build` invokes
the repository's SQLite WASM copy script; verify that the resulting binary is
left in the working tree together with `package.json` and `yarn.lock`.

After each package group, use `yarn check:fix` as needed and investigate any
type, lint, or build breakage. The workflow will independently run, in order,
`yarn check`, `yarn exec tsc --noEmit`, and `yarn build` before publishing.

Hard constraints:

- Do not run `git`, `gh`, or any command that commits, pushes, or creates a pull
  request. The workflow performs those operations after verification.
- Do not read or write secrets, credentials, `.env*`, `.git/**`, or key files.
- Do not edit `.github/**`, `.cursor/**`, `.codex/**`, `AGENTS.md`,
  `CLAUDE.md`, or generated `src/zenstack/**` files.
- Do not make product changes unrelated to compatibility with an upgrade.
- Do not use npm, npx, pnpm, or another package manager.

If everything is already current, leave the working tree unchanged and say so
in the final response. Otherwise, make the upgrades and compatibility fixes;
do not merely describe them.

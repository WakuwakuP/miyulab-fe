# SonarQube issue fix

Fix the open SonarQube issues for this repository, leaving all successful
changes in the working tree. Read `AGENTS.md` and the relevant implementation
before editing.

Use the configured SonarQube MCP server to inspect project
`WakuwakuP_miyulab-fe_2b9f1381-5c7d-4b89-8aca-9a9a897900dc`. Focus on issues
in new code on the main branch that cause the Quality Gate to fail. Retrieve
each issue's rule, message, file, and line through MCP before changing code.
Fix the underlying rule rather than suppressing or merely marking the issue as
resolved. Keep changes limited to the reported issues and closely related
tests.

The workflow runs this exact verification sequence after you finish:

1. `yarn check`
2. `yarn typecheck`
3. `yarn test:run`
4. `yarn build`

You do not have shell access. Review your edits carefully so the workflow can
pass the full verification sequence.

Hard constraints:

- Use the SonarQube MCP tools for SonarQube access. Do not call SonarQube with
  `curl` or attempt to discover credentials.
- Do not attempt to inspect the process environment, Cursor configuration, or
  MCP authentication.
- Do not run `git`, `gh`, or any command that commits, pushes, or creates a pull
  request. The workflow performs those operations after verification.
- Do not read or write secrets, credentials, `.env*`, `.git/**`, or key files.
- Do not edit `.agents/**`, `.github/**`, `.claude/**`, `.cursor/**`,
  `.cursorignore`, `.cursorrules`, `.codex/**`, `.husky/**`, `AGENTS.md`,
  `CLAUDE.md`, or generated `src/zenstack/**` files.
- Do not disable rules, add exclusions, add suppression comments, reduce test
  coverage, or weaken the Quality Gate.
- Do not make product changes unrelated to a reported SonarQube issue.
- Do not use npm, npx, pnpm, or another package manager.

If there are no open new-code issues, leave the working tree unchanged and say
so. Otherwise, implement the fixes; do not merely describe them. End with a
short list of the SonarQube issues fixed and the verification performed.

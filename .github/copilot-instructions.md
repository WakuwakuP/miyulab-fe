# GitHub Copilot Instructions for miyulab-fe

## Pre-commit Verification

Before creating any commit, please ensure the following checks pass:

### 1. Build Verification
Always run and verify that the build succeeds:
```bash
yarn build
```

### 2. Lint Check
Ensure code follows project standards:
```bash
yarn lint
```

### 3. Format Check
Verify code formatting is correct:
```bash
yarn format
```

## Development Environment Setup

This project uses:
- **Package Manager**: Yarn (with corepack)
- **Node.js Framework**: Next.js 16.0.10
- **Language**: TypeScript
- **Styling**: Tailwind CSS

## Build Process

The project build process includes:
1. TypeScript compilation
2. Next.js optimization
3. Static asset processing

## Important Notes

- Always test your changes with `yarn build` before committing
- The project uses yarn workspace configuration with immutable installs
- Husky pre-commit hooks will automatically run linting and formatting
- Follow existing code patterns and TypeScript conventions

## Environment Variables

When testing locally, ensure proper environment variables are set as documented in README.md:
- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_BACKEND_URL`
- `NEXT_PUBLIC_BACKEND_SNS` (optional)
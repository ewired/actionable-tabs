# Agent Instructions

## Code Quality and Validation

After making any code changes to this project, always run `make fix` to ensure code quality and catch any issues:

```bash
make fix
```

This command runs:
- TypeScript type checking (`bunx tsc --noEmit`)
- Biome linting and formatting (`bunx --bun biome check --fix`)
- Knip analysis for unused files and dependencies (`bunx knip --fix --fix-type types --fix-type exports`)

The project is configured to automatically fix most formatting and linting issues, but will fail if there are TypeScript errors or other critical issues that cannot be auto-fixed.

## Project Structure

- `src/background.js` - Main browser extension background script
- `src/settings/` - Extension settings page files
- `src/icons/` - Extension icons
- `knip.json` - Configured to ignore certain rules (files, binaries, unlisted dependencies)
- `tsconfig.json` - TypeScript configuration

Always ensure `make fix` passes completely before considering changes complete.

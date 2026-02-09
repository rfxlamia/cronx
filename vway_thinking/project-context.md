---
project_name: 'CRONX'
user_name: 'V'
date: '2026-02-09'
sections_completed: ['technology_stack']
existing_patterns_found: 8
---

# Project Context for AI Agents

_This file contains critical rules and patterns that AI agents must follow when implementing code in this project. Focus on unobvious details that agents might otherwise miss._

---

## Technology Stack & Versions

**Core Technologies:**
- TypeScript 5.3.3 (strict mode enabled)
- Node.js ≥18.0.0 (ESM modules, NodeNext resolution)
- Build: tsup 8.0.0 (dual CJS/ESM output)
- Test: Vitest 1.2.0 + @vitest/coverage-v8 1.6.1
- Dev Runtime: tsx 4.7.0

**Production Dependencies:**
- better-sqlite3 ^11.0.0 (SQLite persistence)
- chokidar ^3.6.0 (file watching)
- commander ^12.0.0 (CLI framework)
- pino ^8.19.0 (structured logging)
- yaml ^2.4.0 (YAML parsing)
- zod ^3.22.4 (runtime schema validation)

**Build Configuration:**
- Target: ES2022
- Module: NodeNext (ESM-first with CJS dual output)
- Subpath exports: `/strategies`
- CLI binary: `dist/cli.js` with shebang
- Source maps: enabled
- Declarations: enabled with `.d.ts` and `.d.cts`

## Critical Implementation Rules

### Language-Specific Rules

- **TypeScript Strict Mode**: Always enabled - no `any` types, explicit return types
- **ESM-First Imports**: Use `.js` extensions in imports (even for `.ts` source files)
- **Dual Output Structure**: Maintain CJS + ESM compatibility with proper type exports (`.d.ts` and `.d.cts`)
- **Barrel Exports**: Use `index.ts` files for clean public API exports
- **Error Classes**: Extend Error for custom errors (GatewayError, ConfigError, etc.)
- **Zod Validation**: Use Zod schemas for runtime config validation
- **Type-Only Exports**: Export types separately from values for better tree-shaking
- **Generic Types**: Use generics for reusability (JobHandler<T>, StrategyWrapper)
- **Pino Logging**: Use structured logging with proper log levels

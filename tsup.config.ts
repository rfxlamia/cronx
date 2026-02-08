import { defineConfig } from 'tsup'

export default defineConfig([
  // Main library entry
  {
    entry: ['src/index.ts'],
    format: ['cjs', 'esm'],
    dts: true,
    clean: true,
    sourcemap: true,
    splitting: false,
    treeshake: true,
    outDir: 'dist',
  },
  // Strategies subpath export
  {
    entry: ['src/strategies/index.ts'],
    format: ['cjs', 'esm'],
    dts: true,
    sourcemap: true,
    splitting: false,
    treeshake: true,
    outDir: 'dist/strategies',
  },
  // CLI entry (ESM only for bin)
  {
    entry: ['src/cli.ts'],
    format: ['esm'],
    dts: false,
    sourcemap: true,
    splitting: false,
    outDir: 'dist',
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
])

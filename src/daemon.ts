#!/usr/bin/env node
/**
 * CRONX Daemon
 *
 * Main entry point for the CRONX scheduler daemon.
 *
 * @packageDocumentation
 */

import { loadConfigFromFile, configToJobs } from './config/index.js';
import { SQLiteStore } from './storage/sqlite.js';
import { FileBridge } from './gateway/file-bridge.js';
import { Scheduler } from './core/scheduler.js';
import { getDefaultPaths } from './constants.js';

// =============================================================================
// Daemon
// =============================================================================

/**
 * Main daemon entry point.
 */
async function main(): Promise<void> {
  console.log('CRONX Daemon starting...');

  const defaults = getDefaultPaths();

  // Parse command line args
  const args = process.argv.slice(2);
  const seed = args.find((arg) => arg.startsWith('--seed='))?.split('=')[1];
  const configPath =
    args.find((arg) => arg.startsWith('--config='))?.split('=')[1] ?? defaults.configPath;
  const dbPath =
    args.find((arg) => arg.startsWith('--db='))?.split('=')[1] ?? defaults.dbPath;

  console.log(`Loading config from: ${configPath}`);
  console.log(`Using database: ${dbPath}`);

  // Load configuration
  let config;
  try {
    config = loadConfigFromFile(configPath);
  } catch (error) {
    console.error('Failed to load configuration:', error);
    process.exit(1);
  }

  // Convert to jobs
  const jobs = configToJobs(config, { enabledOnly: true });
  console.log(`Loaded ${jobs.length} enabled jobs`);

  if (jobs.length === 0) {
    console.warn('No enabled jobs found. Exiting.');
    process.exit(0);
  }

  // Initialize store
  const store = new SQLiteStore(dbPath);

  // Initialize file bridge
  const bridge = new FileBridge({
    triggerDir: config.cronx.triggerDir,
    openclawPath: config.cronx.openclawPath,
    defaultRecipient: config.cronx.defaultRecipient,
    cliTimeoutMs: config.cronx.cliTimeoutMs,
    writeTimeoutMs: config.cronx.writeTimeoutMs,
  });

  try {
    await bridge.validateDirectory();
    console.log('Trigger directory validated');
  } catch (error) {
    console.error('Failed to validate trigger directory:', error);
    process.exit(1);
  }

  const health = await bridge.healthCheck();
  if (!health.cliAvailable) {
    console.error('OpenClaw CLI not available. Ensure "openclaw" is in PATH.');
    process.exit(1);
  }

  // Create scheduler
  const scheduler = new Scheduler({
    jobs,
    store,
    bridge,
    timezone: config.cronx.timezone,
    seed,
  });

  // Setup graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\nReceived ${signal}. Shutting down...`);
    await scheduler.stop();
    store.close();
    console.log('CRONX Daemon stopped.');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Start scheduler
  try {
    await scheduler.start();
    console.log('CRONX Daemon started successfully.');

    // Log initial status
    const status = scheduler.getStatus();
    console.log('\nScheduled jobs:');
    for (const job of status) {
      const nextRun = job.nextRun ? job.nextRun.toISOString() : 'N/A';
      console.log(`  - ${job.name}: next run at ${nextRun}`);
    }
  } catch (error) {
    console.error('Failed to start scheduler:', error);
    store.close();
    process.exit(1);
  }
}

// Run main
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

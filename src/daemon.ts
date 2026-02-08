#!/usr/bin/env node
/**
 * CRONX Daemon
 *
 * Main entry point for the CRONX scheduler daemon.
 *
 * @packageDocumentation
 */

import * as path from 'node:path';
import * as os from 'node:os';
import { loadConfigFromFile, configToJobs } from './config/index.js';
import { SQLiteStore } from './storage/sqlite.js';
import { GatewayClient } from './gateway/client.js';
import { Scheduler } from './core/scheduler.js';

// =============================================================================
// Constants
// =============================================================================

/** Default config directory */
const DEFAULT_CONFIG_DIR = path.join(os.homedir(), '.cronx');

/** Default config file name */
const CONFIG_FILE_NAME = 'cronx.config.yaml';

/** Default database file name */
const DB_FILE_NAME = 'cronx.db';

// =============================================================================
// Daemon
// =============================================================================

/**
 * Main daemon entry point.
 */
async function main(): Promise<void> {
  console.log('CRONX Daemon starting...');

  // Parse command line args
  const args = process.argv.slice(2);
  const seed = args.find((arg) => arg.startsWith('--seed='))?.split('=')[1];
  const configPath =
    args.find((arg) => arg.startsWith('--config='))?.split('=')[1] ??
    path.join(DEFAULT_CONFIG_DIR, CONFIG_FILE_NAME);

  const dbPath =
    args.find((arg) => arg.startsWith('--db='))?.split('=')[1] ??
    path.join(DEFAULT_CONFIG_DIR, DB_FILE_NAME);

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

  // Initialize gateway client
  const gateway = new GatewayClient({
    url: config.cronx.gateway.url,
    sessionKey: config.cronx.gateway.sessionKey,
    timeout: config.cronx.gateway.timeout,
  });

  // Create scheduler
  const scheduler = new Scheduler({
    jobs,
    store,
    gateway,
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

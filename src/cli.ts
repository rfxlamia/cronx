#!/usr/bin/env node
/**
 * CRONX CLI
 *
 * Command-line interface for CRONX scheduler.
 *
 * @packageDocumentation
 */

import { Command } from 'commander';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn } from 'node:child_process';
import { loadConfigFromFile, configToJobs } from './config/index.js';
import { SQLiteStore } from './storage/sqlite.js';
import { GatewayClient } from './gateway/client.js';
import { Scheduler } from './core/scheduler.js';
import { createStrategy } from './strategies/index.js';

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
// Helper Functions
// =============================================================================

/**
 * Get default paths
 */
function getDefaultPaths(): { configPath: string; dbPath: string } {
  return {
    configPath: path.join(DEFAULT_CONFIG_DIR, CONFIG_FILE_NAME),
    dbPath: path.join(DEFAULT_CONFIG_DIR, DB_FILE_NAME),
  };
}

/**
 * Format date for display
 */
function formatDate(date: Date | null): string {
  if (!date) return 'Never';
  return date.toLocaleString();
}

/**
 * Format duration
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

// =============================================================================
// CLI Program
// =============================================================================

const program = new Command();

program
  .name('cronx')
  .description('CRONX - Random job scheduler for AI agents')
  .version('0.1.0');

// -----------------------------------------------------------------------------
// cronx start
// -----------------------------------------------------------------------------

program
  .command('start')
  .description('Start the CRONX scheduler')
  .option('-d, --daemon', 'Run as background daemon')
  .option('-s, --seed <seed>', 'Seed for reproducible randomness')
  .option('-c, --config <path>', 'Path to config file')
  .action(async (options) => {
    const { configPath, dbPath } = getDefaultPaths();
    const config = options.config ?? configPath;

    if (options.daemon) {
      // Start as daemon
      console.log('Starting CRONX daemon in background...');

      const daemonPath = path.join(__dirname, 'daemon.js');
      const args = [`--config=${config}`, `--db=${dbPath}`];

      if (options.seed) {
        args.push(`--seed=${options.seed}`);
      }

      const child = spawn('node', [daemonPath, ...args], {
        detached: true,
        stdio: 'ignore',
      });

      child.unref();
      console.log(`Daemon started with PID: ${child.pid}`);
      process.exit(0);
    }

    // Run in foreground
    console.log('Starting CRONX scheduler...');

    try {
      const configData = loadConfigFromFile(config);
      const jobs = configToJobs(configData, { enabledOnly: true });

      if (jobs.length === 0) {
        console.log('No enabled jobs found.');
        process.exit(0);
      }

      const store = new SQLiteStore(dbPath);
      const gateway = new GatewayClient({
        url: configData.cronx.gateway.url,
        sessionKey: configData.cronx.gateway.sessionKey,
        timeout: configData.cronx.gateway.timeout,
      });

      const scheduler = new Scheduler({
        jobs,
        store,
        gateway,
        timezone: configData.cronx.timezone,
        seed: options.seed,
      });

      // Graceful shutdown
      const shutdown = async (): Promise<void> => {
        console.log('\nShutting down...');
        await scheduler.stop();
        store.close();
        process.exit(0);
      };

      process.on('SIGTERM', shutdown);
      process.on('SIGINT', shutdown);

      await scheduler.start();

      console.log(`Started with ${jobs.length} jobs.`);
      console.log('Press Ctrl+C to stop.\n');

      // Show status
      const status = scheduler.getStatus();
      for (const job of status) {
        console.log(`  ${job.name}: next at ${formatDate(job.nextRun)}`);
      }
    } catch (error) {
      console.error('Error starting scheduler:', error);
      process.exit(1);
    }
  });

// -----------------------------------------------------------------------------
// cronx status
// -----------------------------------------------------------------------------

program
  .command('status')
  .description('Show scheduler and job status')
  .option('-c, --config <path>', 'Path to config file')
  .action(async (options) => {
    const { configPath, dbPath } = getDefaultPaths();
    const config = options.config ?? configPath;

    try {
      const configData = loadConfigFromFile(config);
      const jobs = configToJobs(configData);
      const store = new SQLiteStore(dbPath);

      console.log('CRONX Status\n');
      console.log('Jobs:');
      console.log('─'.repeat(70));

      for (const job of jobs) {
        const state = store.getJobState(job.name);
        const status = state?.enabled ? 'enabled' : 'disabled';
        const nextRun = state?.nextRun ? new Date(state.nextRun) : null;
        const lastRun = state?.lastRun ? new Date(state.lastRun) : null;

        console.log(`\n  ${job.name} [${status}]`);
        console.log(`    Strategy: ${job.strategy}`);
        console.log(`    Next run: ${formatDate(nextRun)}`);
        console.log(`    Last run: ${formatDate(lastRun)}`);

        if (state?.failCount && state.failCount > 0) {
          console.log(`    Failures: ${state.failCount}`);
        }

        // Show recent runs
        const runs = store.getRecentRuns(job.name, 3);
        if (runs.length > 0) {
          console.log('    Recent runs:');
          for (const run of runs) {
            const time = new Date(run.triggeredAt).toLocaleString();
            const duration = run.durationMs ? formatDuration(run.durationMs) : 'N/A';
            console.log(`      - ${time}: ${run.status} (${duration})`);
          }
        }
      }

      store.close();
    } catch (error) {
      console.error('Error getting status:', error);
      process.exit(1);
    }
  });

// -----------------------------------------------------------------------------
// cronx list
// -----------------------------------------------------------------------------

program
  .command('list')
  .description('List all configured jobs')
  .option('-c, --config <path>', 'Path to config file')
  .option('-e, --enabled', 'Show only enabled jobs')
  .action(async (options) => {
    const { configPath } = getDefaultPaths();
    const config = options.config ?? configPath;

    try {
      const configData = loadConfigFromFile(config);
      const jobs = configToJobs(configData, { enabledOnly: options.enabled });

      console.log('Configured Jobs:\n');
      console.log(
        'Name'.padEnd(25) +
          'Strategy'.padEnd(15) +
          'Enabled'.padEnd(10) +
          'Description'
      );
      console.log('─'.repeat(70));

      for (const job of jobs) {
        const enabled = job.enabled ? 'Yes' : 'No';
        const desc = job.description ?? '';
        console.log(
          job.name.padEnd(25) +
            job.strategy.padEnd(15) +
            enabled.padEnd(10) +
            desc.substring(0, 30)
        );
      }

      console.log(`\nTotal: ${jobs.length} jobs`);
    } catch (error) {
      console.error('Error listing jobs:', error);
      process.exit(1);
    }
  });

// -----------------------------------------------------------------------------
// cronx next
// -----------------------------------------------------------------------------

program
  .command('next')
  .description('Show next scheduled runs')
  .argument('[job]', 'Job name (optional, shows all if not specified)')
  .option('-c, --config <path>', 'Path to config file')
  .option('-n, --count <count>', 'Number of future runs to show', '5')
  .action(async (jobName, options) => {
    const { configPath, dbPath } = getDefaultPaths();
    const config = options.config ?? configPath;
    const count = parseInt(options.count, 10);

    try {
      const configData = loadConfigFromFile(config);
      let jobs = configToJobs(configData, { enabledOnly: true });

      if (jobName) {
        jobs = jobs.filter((j: { name: string }) => j.name === jobName);
        if (jobs.length === 0) {
          console.error(`Job '${jobName}' not found or disabled.`);
          process.exit(1);
        }
      }

      const store = new SQLiteStore(dbPath);

      console.log('Next Scheduled Runs:\n');

      for (const job of jobs) {
        console.log(`${job.name}:`);

        const strategy = createStrategy(job);
        const state = store.getJobState(job.name);
        let lastRun = state?.lastRun ?? null;

        for (let i = 0; i < count; i++) {
          const nextRun = strategy.calculateNextRun(lastRun);
          const nextDate = new Date(nextRun);
          const inMs = nextRun - Date.now();
          const inStr = inMs > 0 ? `(in ${formatDuration(inMs)})` : '(past)';

          console.log(`  ${i + 1}. ${nextDate.toLocaleString()} ${inStr}`);
          lastRun = nextRun;
        }

        console.log();
      }

      store.close();
    } catch (error) {
      console.error('Error calculating next runs:', error);
      process.exit(1);
    }
  });

// -----------------------------------------------------------------------------
// Parse and run
// -----------------------------------------------------------------------------

program.parse();

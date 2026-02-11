/**
 * CRONX CLI
 *
 * Command-line interface for CRONX scheduler.
 *
 * @packageDocumentation
 */

import { Command } from 'commander';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { loadConfigFromFile, configToJobs } from './config/index.js';
import { SQLiteStore } from './storage/sqlite.js';
import { FileBridge } from './gateway/file-bridge.js';
import { Scheduler } from './core/scheduler.js';
import { createStrategy } from './strategies/index.js';
import { getDefaultPaths } from './constants.js';

// =============================================================================
// ESM Compatibility
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Format date for display
 */
function formatDate(date: Date | null, uninitialized?: boolean): string {
  if (!date) return uninitialized ? 'Initializing...' : 'Never';
  return date.toLocaleString();
}

/**
 * Format duration using appropriate time unit
 */
function formatDuration(ms: number): string {
  const units = [
    { divisor: 86400000, unit: 'd', sub: 'h', subDiv: 3600000 },
    { divisor: 3600000, unit: 'h', sub: 'm', subDiv: 60000 },
    { divisor: 60000, unit: 'm', sub: 's', subDiv: 1000 },
  ];

  for (const { divisor, unit, sub, subDiv } of units) {
    const value = Math.floor(ms / divisor);
    if (value > 0) {
      const remainder = Math.floor((ms % divisor) / subDiv);
      return `${value}${unit} ${remainder}${sub}`;
    }
  }
  return `${Math.floor(ms / 1000)}s`;
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
      const bridge = new FileBridge({
        triggerDir: configData.cronx.triggerDir,
        openclawPath: configData.cronx.openclawPath,
        defaultRecipient: configData.cronx.defaultRecipient,
        cliTimeoutMs: configData.cronx.cliTimeoutMs,
        writeTimeoutMs: configData.cronx.writeTimeoutMs,
      });

      await bridge.validateDirectory();
      const health = await bridge.healthCheck();
      if (!health.cliAvailable) {
        throw new Error('OpenClaw CLI not available. Ensure "openclaw" is in PATH.');
      }

      const scheduler = new Scheduler({
        jobs,
        store,
        bridge,
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
      store.initialize(jobs);

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
        const isUninitialized = !state?.nextRun && !state?.lastRun;
        console.log(`    Next run: ${formatDate(nextRun, isUninitialized)}`);
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

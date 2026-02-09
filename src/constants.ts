/**
 * CRONX Shared Constants
 *
 * @packageDocumentation
 */

import * as path from 'node:path';
import * as os from 'node:os';

/** Default config directory */
export const DEFAULT_CONFIG_DIR = path.join(os.homedir(), '.cronx');

/** Default config file name */
export const CONFIG_FILE_NAME = 'cronx.config.yaml';

/** Default database file name */
export const DB_FILE_NAME = 'cronx.db';

/**
 * Get default paths for config and database
 */
export function getDefaultPaths(): { configPath: string; dbPath: string } {
  return {
    configPath: path.join(DEFAULT_CONFIG_DIR, CONFIG_FILE_NAME),
    dbPath: path.join(DEFAULT_CONFIG_DIR, DB_FILE_NAME),
  };
}

#!/usr/bin/env node
/**
 * CRONX Trigger Poller for OpenClaw
 * 
 * Run this script periodically to check for CRONX trigger files.
 * 
 * Usage: node cronx-poller.mjs [--trigger-dir=/path/to/triggers]
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_TRIGGER_DIR = '/root/.cronx/triggers';

function getTriggerDir() {
  const arg = process.argv.find(a => a.startsWith('--trigger-dir='));
  if (arg) {
    return arg.split('=')[1];
  }
  return process.env.CRONX_TRIGGER_DIR || DEFAULT_TRIGGER_DIR;
}

function pollTriggers(triggerDir) {
  if (!fs.existsSync(triggerDir)) {
    console.log(`[CRONX Poller] Trigger directory doesn't exist yet: ${triggerDir}`);
    return [];
  }

  const files = fs.readdirSync(triggerDir)
    .filter(f => f.endsWith('.json') && f.startsWith('cronx-'))
    .map(f => path.join(triggerDir, f));

  if (files.length === 0) {
    return [];
  }

  console.log(`[CRONX Poller] Found ${files.length} trigger(s)`);

  const triggers = [];

  for (const filepath of files) {
    try {
      const content = fs.readFileSync(filepath, 'utf-8');
      const payload = JSON.parse(content);
      triggers.push(payload);
      
      // Delete after reading
      fs.unlinkSync(filepath);
      console.log(`[CRONX Poller] ✓ Processed: ${path.basename(filepath)}`);
    } catch (error) {
      console.error(`[CRONX Poller] ✗ Failed to process ${filepath}:`, error.message);
      // Move to error folder
      const errorDir = path.join(triggerDir, 'errors');
      if (!fs.existsSync(errorDir)) {
        fs.mkdirSync(errorDir, { recursive: true });
      }
      const errorPath = path.join(errorDir, path.basename(filepath));
      try {
        fs.renameSync(filepath, errorPath);
      } catch {
        // Ignore rename errors
      }
    }
  }

  return triggers;
}

function main() {
  const triggerDir = getTriggerDir();
  console.log(`[CRONX Poller] Polling: ${triggerDir}`);
  console.log(`[CRONX Poller] Timestamp: ${new Date().toISOString()}`);
  console.log('');

  const triggers = pollTriggers(triggerDir);

  if (triggers.length === 0) {
    console.log('[CRONX Poller] No triggers to process.');
    process.exit(0);
  }

  console.log('');
  console.log('[CRONX Poller] === TRIGGERS TO PROCESS ===');
  
  for (const trigger of triggers) {
    console.log('');
    console.log(`Job: ${trigger.sessionKey || 'unknown'}`);
    console.log(`Priority: ${trigger.priority || 'normal'}`);
    console.log(`Time: ${new Date(trigger.timestamp).toLocaleString()}`);
    console.log(`Message: ${trigger.message}`);
    console.log('---');
    
    console.log('[ACTION] Send this message:');
    console.log(`> ${trigger.message}`);
  }

  console.log('');
  console.log(`[CRONX Poller] Processed ${triggers.length} trigger(s)`);
}

main();

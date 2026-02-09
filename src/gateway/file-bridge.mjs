#!/usr/bin/env node
/**
 * CRONX File-Based Trigger Bridge
 * 
 * Workaround untuk OpenClaw Gateway yang tidak expose REST API.
 * CRONX tulis trigger files, agent utama poll folder ini.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const TRIGGER_DIR = process.env.CRONX_TRIGGER_DIR || '/root/.cronx/triggers';

interface TriggerPayload {
  message: string;
  priority?: 'low' | 'normal' | 'high';
  timestamp: number;
  jobName: string;
}

/**
 * Save a trigger to file
 */
export function saveTrigger(jobName: string, message: string, priority: 'low' | 'normal' | 'high' = 'normal'): void {
  // Ensure trigger directory exists
  if (!fs.existsSync(TRIGGER_DIR)) {
    fs.mkdirSync(TRIGGER_DIR, { recursive: true });
  }

  const payload: TriggerPayload = {
    message,
    priority,
    timestamp: Date.now(),
    jobName,
  };

  const filename = `${jobName}-${Date.now()}.json`;
  const filepath = path.join(TRIGGER_DIR, filename);

  fs.writeFileSync(filepath, JSON.stringify(payload, null, 2));
  console.log(`[CRONX Bridge] Trigger saved: ${filepath}`);
}

/**
 * Poll for new triggers (called by main agent)
 */
export function pollTriggers(): TriggerPayload[] {
  if (!fs.existsSync(TRIGGER_DIR)) {
    return [];
  }

  const files = fs.readdirSync(TRIGGER_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => path.join(TRIGGER_DIR, f));

  const triggers: TriggerPayload[] = [];

  for (const filepath of files) {
    try {
      const content = fs.readFileSync(filepath, 'utf-8');
      const payload = JSON.parse(content) as TriggerPayload;
      triggers.push(payload);
      
      // Delete after reading (or move to processed/)
      fs.unlinkSync(filepath);
      console.log(`[CRONX Bridge] Trigger processed: ${path.basename(filepath)}`);
    } catch (error) {
      console.error(`[CRONX Bridge] Failed to process ${filepath}:`, error);
    }
  }

  return triggers;
}

// CLI usage for testing
if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv[2];
  
  if (command === 'test') {
    console.log('Testing CRONX file-based trigger...');
    saveTrigger('test-job', 'Hello from CRONX! 🎉', 'normal');
    console.log('Trigger saved. Run "poll" to read it back.');
  } else if (command === 'poll') {
    const triggers = pollTriggers();
    console.log(`Found ${triggers.length} triggers:`);
    for (const t of triggers) {
      console.log(`  - ${t.jobName}: ${t.message}`);
    }
  } else {
    console.log('Usage: node cronx-bridge.mjs [test|poll]');
  }
}

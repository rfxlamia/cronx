#!/usr/bin/env node
/**
 * CRONX Test Trigger - Kirim nama buah
 * 
 * Usage: node test-trigger.mjs
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const TRIGGER_DIR = '/root/.cronx/triggers';

// Buat trigger file
if (!fs.existsSync(TRIGGER_DIR)) {
  fs.mkdirSync(TRIGGER_DIR, { recursive: true });
}

const payload = {
  message: "Test dari CRONX: Apel, Mangga, Jeruk! 🍎🥭🍊",
  timestamp: Date.now(),
  jobName: "test-buah"
};

const filename = `cronx-test-${Date.now()}.json`;
const filepath = path.join(TRIGGER_DIR, filename);

fs.writeFileSync(filepath, JSON.stringify(payload, null, 2));
console.log(`Trigger created: ${filepath}`);
console.log('Jika OpenClaw pickup, seharusnya kirim ke WhatsApp...');

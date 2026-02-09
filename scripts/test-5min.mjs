#!/usr/bin/env node
/**
 * CRONX 5-Minute Test - Fruit Probabilistic
 * 
 * Simulates CRONX probabilistic scheduling for 5 minutes
 * Uses FileGatewayClient to write trigger files
 */

import { FileGatewayClient } from '../src/gateway/file-client.ts';
import * as fs from 'node:fs';

const TRIGGER_DIR = '/root/.cronx/triggers';
const TEST_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const CHECK_INTERVAL_MS = 5000; // 5 seconds
const PROBABILITY = 0.3; // 30%

const FRUITS = [
  '🍎 Apel',
  '🍌 Pisang',
  '🍊 Jeruk',
  '🍇 Anggur',
  '🍓 Stroberi',
  '🥭 Mangga',
  '🍍 Nanas',
  '🍉 Semangka',
  '🍈 Melon',
  '🥑 Alpukat'
];

function getRandomFruit() {
  return FRUITS[Math.floor(Math.random() * FRUITS.length)];
}

function shouldTrigger() {
  return Math.random() < PROBABILITY;
}

async function runTest() {
  console.log('========================================');
  console.log('CRONX 5-Minute Fruit Test');
  console.log('========================================');
  console.log(`Duration: 5 minutes`);
  console.log(`Check interval: ${CHECK_INTERVAL_MS / 1000}s`);
  console.log(`Probability: ${PROBABILITY * 100}%`);
  console.log(`Expected triggers: ~${(TEST_DURATION_MS / CHECK_INTERVAL_MS) * PROBABILITY}`);
  console.log('========================================\n');

  // Clean up trigger directory
  if (fs.existsSync(TRIGGER_DIR)) {
    fs.readdirSync(TRIGGER_DIR)
      .filter(f => f.startsWith('cronx-') && f.endsWith('.json'))
      .forEach(f => fs.unlinkSync(`${TRIGGER_DIR}/${f}`));
  }

  const client = new FileGatewayClient({
    triggerDir: TRIGGER_DIR,
    sessionKey: 'fruit-probabilistic'
  });

  let checkCount = 0;
  let triggerCount = 0;
  const startTime = Date.now();

  console.log('Starting test...\n');

  const interval = setInterval(async () => {
    const elapsed = Date.now() - startTime;
    checkCount++;

    if (elapsed >= TEST_DURATION_MS) {
      clearInterval(interval);
      console.log('\n========================================');
      console.log('Test Complete!');
      console.log('========================================');
      console.log(`Total checks: ${checkCount}`);
      console.log(`Total triggers: ${triggerCount}`);
      console.log(`Actual probability: ${(triggerCount / checkCount * 100).toFixed(1)}%`);
      console.log('========================================');
      process.exit(0);
    }

    if (shouldTrigger()) {
      triggerCount++;
      const fruit = getRandomFruit();
      const result = await client.trigger({
        message: `CRONX_FRUIT_TEST: ${fruit}`,
        priority: 'normal'
      });
      
      if (result.success) {
        console.log(`[${new Date().toLocaleTimeString()}] ✓ Trigger: ${fruit}`);
      } else {
        console.log(`[${new Date().toLocaleTimeString()}] ✗ Failed: ${result.error}`);
      }
    } else {
      console.log(`[${new Date().toLocaleTimeString()}] - Check ${checkCount} (no trigger)`);
    }
  }, CHECK_INTERVAL_MS);
}

runTest().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});

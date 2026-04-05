// server/memory/__tests__/memory-service.test.ts
// Run: npx tsx server/memory/__tests__/memory-service.test.ts

import assert from 'node:assert/strict';
process.env.MEMORY_DB_PATH = ':memory:';

const { MemoryService } = await import('../memory-service.js');
const svc = new MemoryService();

// MEM-01: saveDecision
const id = await svc.saveDecision({
  symbol: 'COMI',
  recommendation: 'Buy',
  confidence: 'High',
  reasoning: 'solid P/E ratio at 8x vs sector 12x',
  inputsHash: 'abc123abc123abc1',
  priceAtRec: 25.5,
  fairValue: 30.0,
});
assert.ok(typeof id === 'number' && id > 0, 'saveDecision should return numeric id');
console.log('PASS: MEM-01 saveDecision');

// MEM-02: scoreOutcome
await svc.scoreOutcome(id, '5d', 8.5);
const dec = await svc.getDecisionById(id);
assert.equal(dec?.outcome5d, 8.5, 'outcome_5d should be 8.5');
assert.equal(dec?.outcome30d, null, 'outcome_30d should still be null');
console.log('PASS: MEM-02 scoreOutcome');

// MEM-03: saveEpisode with validity
const futureDate = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
const epId = await svc.saveEpisode({
  symbol: 'COMI',
  lesson: 'P/E thesis was correct; CBE rate cut came 3 months later than expected',
  context: 'HIGH_RATES regime, Q3 2025',
  validUntil: futureDate,
  macroRegime: 'HIGH_RATES',
  decisionId: id,
});
assert.ok(typeof epId === 'number' && epId > 0, 'saveEpisode should return numeric id');
console.log('PASS: MEM-03 saveEpisode');

// MEM-04: getRelevantEpisodes — expired episode filter
const pastDate = new Date(Date.now() - 1000);
await svc.saveEpisode({
  symbol: 'COMI',
  lesson: 'This lesson is stale and should not appear',
  context: 'stale context',
  validUntil: pastDate,
  macroRegime: 'HIGH_RATES',
});
// Regime-mismatched episode
await svc.saveEpisode({
  symbol: 'COMI',
  lesson: 'This lesson is for wrong regime',
  context: 'RECOVERY context',
  macroRegime: 'RECOVERY',
});

const episodes = await svc.getRelevantEpisodes('COMI', 'HIGH_RATES', 3);
const staleFound = episodes.some(e => e.lesson.includes('stale'));
const wrongRegimeFound = episodes.some(e => e.lesson.includes('wrong regime'));
assert.equal(staleFound, false, 'Expired episode must NOT be returned');
assert.equal(wrongRegimeFound, false, 'Wrong macroRegime episode must NOT be returned');
console.log('PASS: MEM-04 getRelevantEpisodes filters');

// MEM-05: invalidateDecision
await svc.invalidateDecision(id, 'THESIS_ERROR');
const invalidated = await svc.getDecisionById(id);
assert.equal(invalidated?.invalidationReason, 'THESIS_ERROR', 'invalidationReason should be THESIS_ERROR');
console.log('PASS: MEM-05 invalidateDecision');

console.log('\nAll memory-service tests PASSED');

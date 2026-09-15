import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialAttempt, updateAttempt, fixtureResult, parseRoute, topics, topicTrees, exercises } from '../public/model.js';

test('sample run, review and repair remain separate from the original', () => {
  const original = initialAttempt('duplicate');
  const run = updateAttempt(original, 'run');
  assert.equal(fixtureResult(run.problem, run.fixed, 2).actual, '2');
  const retry = updateAttempt(initialAttempt('duplicate'), 'repair');
  assert.equal(retry.assisted, true);
  assert.equal(retry.ran, false);
  assert.equal(fixtureResult(retry.problem, retry.fixed, 2).actual, '7');
  assert.equal(original.fixed, false);
});
test('help continues the attempt, disputes preserve the evidence', () => {
  const helped = updateAttempt(initialAttempt(), 'help');
  assert.equal(helped.assisted, true);
  assert.equal(helped.finished, false);
  const disputed = updateAttempt(updateAttempt(helped, 'finish'), 'dispute');
  assert.equal(disputed.disputed, true);
  assert.equal(disputed.finished, true);
  assert.equal(disputed.problem, helped.problem);
});
test('catalog references resolve and the demonstration is excluded', () => {
  for (const topic of topics) {
    for (const problem of topic.exercises) {
      assert.ok(exercises[problem]);
      assert.notEqual(problem, 'duplicate');
    }
    if (topic.parent) assert.ok(topics.some((candidate) => candidate.id === topic.parent));
  }
});
test('deep links preserve source and recovery state', () => {
  const route = parseRoute('#review?source=sample&state=missing');
  assert.equal(route.page, 'review');
  assert.equal(route.params.get('source'), 'sample');
  assert.equal(route.params.get('state'), 'missing');
  assert.equal(parseRoute('').page, 'welcome');
});

test('every topic has reachable practice leaves backed by original exercises', () => {
  for (const topic of topics) {
    const leaves = topicTrees[topic.id].flatMap((branch) => branch.leaves);
    assert.ok(leaves.length);
    assert.equal(new Set(leaves.map((leaf) => leaf.id)).size, leaves.length);
    for (const leaf of leaves) for (const id of leaf.exercises) {
      assert.ok(exercises[id]);
      assert.notEqual(id, 'duplicate');
    }
  }
});

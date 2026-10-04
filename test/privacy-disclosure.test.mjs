import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { legalScreen } from '../public/legal.js';
import { feedbackTextLimit } from '../public/feedback-questions.js';
import { bugTextLimit, operatorContact } from '../public/bug-report-contract.js';

const deployment = ts.parseConfigFileTextToJson('wrangler.jsonc', await readFile('wrangler.jsonc', 'utf8'));
assert.equal(deployment.error, undefined, 'Deployment configuration must parse');
const policy = JSON.parse(deployment.config.vars.WAITLIST_POLICY);
const facts = [
  ['Waitlist policy version', 'Waitlist, when enabled', policy.version],
  ['Feedback response text limit', 'Feedback, when enabled', `${feedbackTextLimit} characters`],
  ['Bug report text limit', 'Bug reports, when enabled', `${bugTextLimit} characters`],
  ['Operator contact', 'Scope and operator', operatorContact],
  ['Waitlist Operator contact', 'Waitlist, when enabled', policy.contact],
];
const notice = legalScreen('privacy');

function checkFact([name, heading, value]) {
  const section = notice.split(`<h2>${heading}</h2>`)[1]?.split('</section>')[0];
  assert.ok(typeof value === 'string' && value.length > 0 && section?.includes(value), `Privacy disclosure drift: ${name} must contain ${value}`);
}

for (const fact of facts) {
  test(`privacy notice matches ${fact[0]}`, () => checkFact(fact));
  test(`a changed ${fact[0]} fails with its name`, () => {
    assert.throws(() => checkFact([fact[0], fact[1], `changed-${fact[2]}`]), error => error.code === 'ERR_ASSERTION' && error.message.includes(fact[0]));
  });
}

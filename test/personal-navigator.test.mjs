import assert from 'node:assert/strict';
import test from 'node:test';
import { createPersonalState, navigatePersonal } from '../public/personal-navigator.js';

const active = () => ({ ...createPersonalState(), user: { id: 'candidate' }, page: 'workspace', attempt: { attempt: { id: 'attempt', status: 'active', input_mode: 'voice', draft_source: 'saved' } } });

test('page navigation saves a changed Draft before loading and leaving the Attempt', () => {
  for (const page of ['home', 'catalog', 'sessions', 'profile', 'settings']) {
    const state = active();
    const original = structuredClone(state);
    const result = navigatePersonal(state, { type: 'page', page, editorSource: 'changed' });
    assert.equal(result.state.page, page);
    assert.equal(result.state.attempt, null);
    assert.deepEqual(result.effects, [{ type: 'save-draft' }, { type: 'stop-voice' }, { type: 'reload' }, { type: 'url', page }]);
    assert.deepEqual(state, original, 'the navigator never mutates its input');
  }
});

test('initial routes and authentication views are state, without a browser', () => {
  for (const page of ['home', 'catalog', 'sessions', 'profile', 'settings']) assert.equal(createPersonalState({ page }).page, page);
  assert.equal(createPersonalState({ page: 'sample' }).page, 'home');
  for (const view of ['sign-in', 'sign-up', 'forgot']) {
    const result = navigatePersonal(createPersonalState(), { type: 'auth-view', view });
    assert.equal(result.state.authView, view);
  }
  assert.equal(createPersonalState({ auth: 'sign-up' }).authView, 'sign-up');
  assert.equal(createPersonalState({ reset: 'token' }).resetToken, 'token');
});

test('Problem, Attempt, Review, related Problems and external navigation request ordered effects', () => {
  for (const [action, page, effect] of [
    [{ type: 'select-problem', problemId: 'problem' }, 'home', null],
    [{ type: 'open-attempt', attemptId: 'next' }, 'workspace', { type: 'load-attempt', attemptId: 'next' }],
    [{ type: 'page', page: 'review' }, 'review', { type: 'load-review', attemptId: 'attempt' }],
    [{ type: 'open-related' }, 'related', { type: 'load-related' }],
    [{ type: 'leave', href: '#sample' }, 'workspace', { type: 'location', href: '#sample' }],
  ]) {
    const result = navigatePersonal(active(), { ...action, editorSource: 'changed' });
    assert.equal(result.state.page, page);
    assert.deepEqual(result.effects, [{ type: 'save-draft' }, { type: 'stop-voice' }, ...(effect ? [effect] : [])]);
    if (action.type === 'select-problem') {
      assert.equal(result.state.selectedProblemId, 'problem');
      assert.equal(result.state.attempt, null);
    }
  }
  const detail = active().attempt;
  const loaded = navigatePersonal(active(), { type: 'attempt-loaded', detail, review: { review: { status: 'pending' } } }).state;
  assert.equal(loaded.attempt, detail);
  assert.equal(loaded.review.review.status, 'pending');
  assert.equal(loaded.selectedProblemId, null);
  assert.deepEqual(loaded.related, []);
  assert.equal(navigatePersonal(loaded, { type: 'page', page: 'workspace' }).state.attempt, detail);
  assert.deepEqual(navigatePersonal(loaded, { type: 'review-loaded', review: { findings: [] } }).state.review, { findings: [] });
  assert.deepEqual(navigatePersonal(loaded, { type: 'related-loaded', related: ['problem'] }).state.related, ['problem']);
});

test('unchanged, completed and absent Drafts do not request a save', () => {
  for (const state of [active(), { ...active(), attempt: null }, { ...active(), attempt: { attempt: { ...active().attempt.attempt, status: 'completed' } } }]) {
    const result = navigatePersonal(state, { type: 'page', page: 'sessions', editorSource: state.attempt?.attempt.status === 'completed' ? 'changed' : 'saved' });
    assert.ok(!result.effects.some(effect => effect.type === 'save-draft'));
  }
});

test('sign-out and account deletion clear exactly the same account state', () => {
  const state = { ...active(), catalog: ['private'], attempts: ['private'], review: {}, related: ['private'], selectedProblemId: 'private', historyPage: 5, historyMore: true, resetToken: 'private', authView: 'forgot' };
  const signedOut = navigatePersonal(state, { type: 'sign-out', editorSource: 'changed' });
  const deleted = navigatePersonal(state, { type: 'account-cleared' });
  assert.deepEqual(signedOut.state, deleted.state);
  assert.equal(signedOut.state.user, null);
  assert.equal(signedOut.state.attempt, null);
  assert.equal(signedOut.state.review, null);
  assert.equal(signedOut.state.selectedProblemId, null);
  assert.equal(signedOut.state.resetToken, null);
  assert.equal(signedOut.state.authView, 'sign-in');
  assert.deepEqual(signedOut.state.catalog, []);
  assert.deepEqual(signedOut.state.attempts, []);
  assert.deepEqual(signedOut.state.related, []);
  assert.equal(signedOut.state.historyPage, 0);
  assert.equal(signedOut.state.historyMore, false);
  assert.deepEqual(signedOut.effects, [{ type: 'save-draft' }, { type: 'stop-voice' }, { type: 'sign-out' }, { type: 'url', replace: true }]);
  assert.deepEqual(deleted.effects, [{ type: 'stop-voice' }, { type: 'url', replace: true }]);
});

test('voice toggle and disposal return effects without owning a voice session', () => {
  for (const [voiceActive, type] of [[false, 'start-voice'], [true, 'stop-voice']]) {
    assert.deepEqual(navigatePersonal(active(), { type: 'voice', voiceActive }).effects, [{ type }]);
  }
  assert.deepEqual(navigatePersonal(createPersonalState(), { type: 'voice' }).effects, []);
  for (const row of [{ input_mode: 'text', status: 'active' }, { input_mode: 'voice', status: 'completed' }]) {
    assert.deepEqual(navigatePersonal({ ...active(), attempt: { attempt: row } }, { type: 'voice' }).effects, []);
  }
  assert.deepEqual(navigatePersonal(active(), { type: 'dispose' }).effects, [{ type: 'stop-voice' }]);
});

test('availability and account reloads update state without changing a requested page', () => {
  const state = createPersonalState({ page: 'profile' });
  const loaded = navigatePersonal(state, { type: 'loaded', data: { collectionEnabled: true, user: { id: 'candidate' }, catalog: ['problem'], attempts: ['attempt'], historyPage: 1, historyMore: true } }).state;
  assert.equal(loaded.page, 'profile');
  assert.equal(loaded.user.id, 'candidate');
  assert.deepEqual(loaded.catalog, ['problem']);
  assert.deepEqual(navigatePersonal(loaded, { type: 'reload' }).effects, [{ type: 'reload' }]);
  const loggedOut = navigatePersonal(loaded, { type: 'loaded', data: { user: null } }).state;
  assert.equal(loggedOut.user, null);
  assert.deepEqual(loggedOut.catalog, []);
});

test('filtering, pagination, and loaded evidence retain other state', () => {
  let state = active();
  state = navigatePersonal(state, { type: 'filter', key: 'topic', value: 'Arrays' }).state;
  assert.deepEqual(state.catalogFilter, { topic: 'Arrays', difficulty: '', limit: 30 });
  assert.equal(navigatePersonal(state, { type: 'more-problems' }).state.catalogFilter.limit, 60);
  state = navigatePersonal(state, { type: 'history-loaded', data: { attempts: ['next'], page: 1, hasMore: true } }).state;
  assert.deepEqual(state.attempts, ['next']);
  assert.equal(state.historyPage, 1);
  assert.equal(state.historyMore, true);
  state.attempt = { ...state.attempt, events: ['first'], transcripts: [], checkpoints: [], runs: [] };
  const result = navigatePersonal(state, { type: 'evidence-loaded', data: { events: ['next'], transcripts: [], checkpoints: [], runs: [], page: 1, hasMore: false } });
  assert.deepEqual(result.state.attempt.events, ['first', 'next']);
  assert.deepEqual(state.attempt.events, ['first']);
  assert.equal(result.state.attempt.hasMore, false);
});

test('authentication messages and password-reset completion are transitions', () => {
  const state = createPersonalState({ auth: 'sign-up', reset: 'token' });
  const signIn = navigatePersonal(state, { type: 'auth-view', view: 'sign-in', message: 'Check email' }).state;
  assert.equal(signIn.authMessage, 'Check email');
  const reset = navigatePersonal(state, { type: 'account-cleared', message: 'Password changed' }).state;
  assert.equal(reset.resetToken, null);
  assert.equal(reset.authMessage, 'Password changed');
});

test('unknown actions and pages leave the navigator unchanged', () => {
  const state = active();
  for (const action of [{ type: 'unknown' }, { type: 'page', page: 'sample' }]) assert.deepEqual(navigatePersonal(state, action), { state, effects: [] });
  for (const action of [{ type: 'page', page: 'review' }, { type: 'page', page: 'workspace' }, { type: 'open-related' }]) {
    const empty = createPersonalState();
    assert.deepEqual(navigatePersonal(empty, action), { state: empty, effects: [] });
  }
});

test('finish completion loads the frozen Attempt without saving edits made while finishing', () => {
  const result = navigatePersonal(active(), { type: 'finish-completed', attemptId: 'attempt', editorSource: 'edited during finish' });
  assert.deepEqual(result.effects, [{ type: 'stop-voice' }, { type: 'load-attempt', attemptId: 'attempt' }]);
  assert.equal(result.state.page, 'workspace');
});

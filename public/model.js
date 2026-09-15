export const original = `def first_duplicate(values):
    seen = set()
    answer = None
    for value in values:
        if value in seen:
            answer = value
        seen.add(value)
    return answer`;

export const repaired = `def first_duplicate(values):
    seen = set()
    for value in values:
        if value in seen:
            return value
        seen.add(value)
    return None`;

export const topics = [
  { id: 'sequences', name: 'Sequence fundamentals', note: 'Read, scan, and keep track', parent: '', column: 0, row: 1, exercises: ['alert'] },
  { id: 'sets', name: 'Maps & sets', note: 'Remember what you have seen', parent: 'sequences', column: 1, row: 0, exercises: ['tags'] },
  { id: 'flow', name: 'Control flow', note: 'Know when to stop', parent: 'sequences', column: 1, row: 2, exercises: ['alert'] },
  { id: 'repeat', name: 'Repeated values', note: 'Find the first matching event', parent: 'sets', column: 2, row: 0, exercises: ['tags'] },
  { id: 'runs', name: 'Consecutive groups', note: 'Track a changing sequence', parent: 'flow', column: 2, row: 2, exercises: ['runs'] },
];

export const exercises = {
  duplicate: { title: 'First duplicate', topic: 'Maps & sets', function: 'first_duplicate', input: '[7, 2, 7, 2]', expected: '7', actual: '2', lead: 'Return the first value you encounter for a second time.', body: 'Scan the list from left to right. Return the value as soon as it repeats. If no value repeats, return None.', explanation: 'The second 7 appears before the second 2, so the answer is 7.', original, repaired },
  tags: { title: 'First repeated tag', topic: 'Maps & sets', function: 'first_repeated_tag', input: '["api", "web", "api", "web"]', expected: '2', actual: '3', lead: 'Find the index where a tag first repeats.', body: 'Read the tags from left to right. Return the zero-based index of the first tag that has already appeared. Return None if all tags are different.', explanation: 'The tag "api" first repeats at index 2. Stop there, even if another tag repeats later.', original: 'def first_repeated_tag(tags):\n    seen = set()\n    answer = None\n    for index, tag in enumerate(tags):\n        if tag in seen:\n            answer = index\n        seen.add(tag)\n    return answer', repaired: 'def first_repeated_tag(tags):\n    seen = set()\n    for index, tag in enumerate(tags):\n        if tag in seen:\n            return index\n        seen.add(tag)\n    return None' },
  alert: { title: 'First threshold alert', topic: 'Control flow', function: 'first_alert', input: '[4, 9, 3, 12], threshold = 8', expected: '1', actual: '3', lead: 'Find the first reading above a threshold.', body: 'Given a list of readings and a threshold, return the zero-based index of the first reading strictly greater than the threshold. Return None if no reading qualifies.', explanation: 'The reading 9 at index 1 is the first value strictly above 8.', original: 'def first_alert(readings, threshold):\n    answer = None\n    for index, reading in enumerate(readings):\n        if reading > threshold:\n            answer = index\n    return answer', repaired: 'def first_alert(readings, threshold):\n    for index, reading in enumerate(readings):\n        if reading > threshold:\n            return index\n    return None' },
  runs: { title: 'First consecutive pair', topic: 'Consecutive groups', function: 'first_pair', input: '[1, 4, 4, 2, 2]', expected: '1', actual: '3', lead: 'Find where the first pair of equal neighbors begins.', body: 'Return the index of the first value in the earliest equal consecutive pair. Return None when there is no such pair.', explanation: 'The pair [4, 4] begins at index 1, before the pair [2, 2].', original: 'def first_pair(values):\n    answer = None\n    for index in range(len(values) - 1):\n        if values[index] == values[index + 1]:\n            answer = index\n    return answer', repaired: 'def first_pair(values):\n    for index in range(len(values) - 1):\n        if values[index] == values[index + 1]:\n            return index\n    return None' },
};

export const topicTrees = {
  sequences: [
    { name: 'Reading a sequence', note: 'Position, order, and bounds', leaves: [{ id: 'scan', name: 'Left-to-right scans', exercises: ['alert'] }] },
    { name: 'Comparing neighbors', note: 'Reason about adjacent values', leaves: [{ id: 'neighbors', name: 'Adjacent pairs', exercises: ['runs'] }] },
  ],
  sets: [
    { name: 'Membership', note: 'Remember earlier values', leaves: [{ id: 'seen', name: 'Seen-value tracking', exercises: ['tags'] }] },
    { name: 'Order of discovery', note: 'Identify the earliest match', leaves: [{ id: 'first-match', name: 'First repeated occurrence', exercises: ['tags'] }] },
  ],
  flow: [
    { name: 'Conditions', note: 'Decide when a value qualifies', leaves: [{ id: 'threshold', name: 'Threshold checks', exercises: ['alert'] }] },
    { name: 'Stopping rules', note: 'Return rather than overwrite', leaves: [{ id: 'early-return', name: 'Early returns', exercises: ['tags', 'alert'] }] },
  ],
  repeat: [
    { name: 'Non-adjacent repeats', note: 'Remember values across a scan', leaves: [{ id: 'duplicates', name: 'Repeated tags', exercises: ['tags'] }] },
    { name: 'Adjacent repeats', note: 'Compare each neighboring pair', leaves: [{ id: 'pairs', name: 'Consecutive pairs', exercises: ['runs'] }] },
  ],
  runs: [
    { name: 'Pair boundaries', note: 'Check the next position safely', leaves: [{ id: 'bounds', name: 'Neighbor comparisons', exercises: ['runs'] }] },
    { name: 'First qualifying pair', note: 'Preserve the earliest result', leaves: [{ id: 'first-pair', name: 'Stop at the first pair', exercises: ['runs'] }] },
  ],
};

export const scenes = [
  ['Your practice', 'welcome', 'Personal home, current focus, and activity'],
  ['New practice home', 'welcome?state=empty', 'Honest first-use state without invented progress'],
  ['Learning map', 'roadmap', 'Connected topics and practice selection'],
  ['Topic detail', 'roadmap?topic=sets', 'Selected topic with subtopic cards beneath the map'],
  ['Problem drawer', 'roadmap?topic=sets&leaf=seen', 'Final practice node opens a sliding left panel'],
  ['List view', 'roadmap?view=list', 'An equivalent, linear path'],
  ['Session history', 'sessions', 'Review ready, saved draft, and return'],
  ['Empty history', 'sessions?state=empty', 'A clear first action'],
  ['History unavailable', 'sessions?state=error', 'Recovery without false zero activity'],
  ['Personal setup', 'setup', 'Goal, topics, and recording choices'],
  ['Microphone unavailable', 'setup?state=mic', 'Continue with text'],
  ['Guided sample', 'sample', 'Read → run → review → retry'],
  ['Mock interview', 'interview', 'Problem, code, tests, and conversation'],
  ['Expanded conversation', 'interview?state=expanded', 'More transcript space without moving code'],
  ['Test run pending', 'interview?state=running', 'Prepared pending-state preview'],
  ['Runner unavailable', 'interview?state=runner', 'Keep the draft and retry'],
  ['Connection lost', 'interview?state=offline', 'Text fallback and preserved work'],
  ['Review', 'review', 'Evidence, interpretation, and next action'],
  ['Review pending', 'review?state=pending', 'Saved attempt without a judgment'],
  ['Review unavailable', 'review?state=error', 'Retry evaluation, keep evidence'],
  ['No clear weakness', 'review?state=clear', 'Observations without invented criticism'],
  ['Missing evidence', 'review?state=missing', 'A narrow observation, no diagnosis'],
  ['Audio replay controls', 'review?state=audio', 'Playback UI independent of saved code checkpoints'],
  ['Disputed finding', 'review?state=disputed', 'Original evidence remains visible'],
  ['Checkpoint retry', 'retry', 'Fresh Coach practice, original preserved'],
  ['Retry result', 'complete?state=passed', 'What changed, not a mastery claim'],
  ['Related practice', 'related', 'Authored relationship and familiarity'],
  ['No related exercise', 'related?state=empty', 'Return to ordinary practice'],
  ['Recording preferences', 'preferences', 'Choices, export, and deletion'],
  ['Design system', 'system', 'Tokens, components, and motion specimen'],
];

export function parseRoute(hash) {
  const [page = 'welcome', query = ''] = hash.replace(/^#\/?/, '').split('?');
  return { page: page || 'welcome', params: new URLSearchParams(query) };
}

export function fixtureResult(problem, fixed, caseIndex) {
  if (caseIndex === 0) return { input: problem === 'alert' ? '[], threshold = 8' : '[]', expected: 'None', actual: 'None', passed: true };
  if (caseIndex === 1 && problem === 'duplicate') return { input: '[3, 3]', expected: '3', actual: '3', passed: true };
  if (caseIndex === 1 && problem === 'tags') return { input: '["api", "api"]', expected: '1', actual: '1', passed: true };
  if (caseIndex === 1 && problem === 'alert') return { input: '[1, 9], threshold = 8', expected: '1', actual: '1', passed: true };
  if (caseIndex === 1 && problem === 'runs') return { input: '[4, 4]', expected: '0', actual: '0', passed: true };
  const exercise = exercises[problem];
  return { input: exercise.input, expected: exercise.expected, actual: fixed ? exercise.expected : exercise.actual, passed: fixed };
}

export function initialAttempt(problem = 'tags') {
  return { problem, fixed: false, ran: false, assisted: false, finished: false, disputed: false, draft: false };
}

export function updateAttempt(attempt, action) {
  switch (action) {
    case 'run': return { ...attempt, ran: true };
    case 'repair': return { ...attempt, fixed: true, assisted: true, ran: false };
    case 'help': return { ...attempt, assisted: true };
    case 'finish': return { ...attempt, finished: true, draft: false };
    case 'save': return { ...attempt, draft: true };
    case 'dispute': return { ...attempt, disputed: true };
    default: return attempt;
  }
}

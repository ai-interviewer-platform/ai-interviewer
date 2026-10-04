// Pure Personal practice transitions. The adapter completes effects before it
// commits the returned state, so a failed Draft save cannot navigate away.
const pages = ['home', 'sessions', 'catalog', 'profile', 'settings'];

export function createPersonalState({ page, auth, reset, voiceProvider, thinkingModel } = {}) {
  return { user: null, catalog: [], attempts: [], attempt: null, review: null, related: [],
    collectionEnabled: false, voiceEnabled: false, voiceProvider, thinkingModel,
    page: pages.includes(page) ? page : 'home', selectedProblemId: null,
    catalogFilter: { topic: '', difficulty: '', limit: 30 }, historyPage: 0, historyMore: false,
    emailEnabled: false, authView: auth === 'sign-up' ? 'sign-up' : 'sign-in', resetToken: reset ?? null, authMessage: '' };
}

function clearAccount(state) {
  return { ...createPersonalState(), collectionEnabled: state.collectionEnabled,
    voiceEnabled: state.voiceEnabled, voiceProvider: state.voiceProvider,
    thinkingModel: state.thinkingModel, emailEnabled: state.emailEnabled };
}

export function navigatePersonal(state, action) {
  const effects = [];
  const leave = () => {
    const attempt = state.attempt?.attempt;
    if (state.page === 'workspace' && attempt && attempt.status !== 'completed' &&
        typeof action.editorSource === 'string' && action.editorSource !== attempt.draft_source) effects.push({ type: 'save-draft' });
    effects.push({ type: 'stop-voice' });
  };
  switch (action.type) {
    case 'page':
      if (['workspace', 'review'].includes(action.page)) {
        if (!state.attempt) return { state, effects };
        leave();
        if (action.page === 'review') effects.push({ type: 'load-review', attemptId: state.attempt.attempt.id });
        return { state: { ...state, page: action.page, selectedProblemId: null }, effects };
      }
      if (!pages.includes(action.page)) return { state, effects };
      leave();
      effects.push({ type: 'reload' }, { type: 'url', page: action.page });
      return { state: { ...state, page: action.page, attempt: null, review: null, related: [], selectedProblemId: null }, effects };
    case 'select-problem':
      leave();
      return { state: { ...state, page: 'home', selectedProblemId: action.problemId, attempt: null, review: null, related: [] }, effects };
    case 'open-attempt':
    case 'finish-completed':
      if (action.type === 'open-attempt') leave();
      else effects.push({ type: 'stop-voice' });
      effects.push({ type: 'load-attempt', attemptId: action.attemptId });
      return { state: { ...state, page: 'workspace', selectedProblemId: null }, effects };
    case 'attempt-loaded':
      return { state: { ...state, page: 'workspace', attempt: action.detail, review: action.review, related: [], selectedProblemId: null }, effects };
    case 'open-related':
      if (!state.attempt) return { state, effects };
      leave();
      effects.push({ type: 'load-related' });
      return { state: { ...state, page: 'related' }, effects };
    case 'review-loaded':
      return { state: { ...state, review: action.review }, effects };
    case 'related-loaded':
      return { state: { ...state, related: action.related }, effects };
    case 'leave':
      leave();
      effects.push({ type: 'location', href: action.href });
      return { state, effects };
    case 'auth-view':
      return { state: { ...state, authView: action.view, authMessage: action.message ?? '' }, effects };
    case 'sign-out':
    case 'account-cleared':
      if (action.type === 'sign-out') { leave(); effects.push({ type: 'sign-out' }); }
      else effects.push({ type: 'stop-voice' });
      effects.push({ type: 'url', replace: true });
      return { state: { ...clearAccount(state), authMessage: action.message ?? '' }, effects };
    case 'voice':
      if (state.page === 'workspace' && state.attempt?.attempt.input_mode === 'voice' && state.attempt.attempt.status !== 'completed') {
        effects.push({ type: action.voiceActive ? 'stop-voice' : 'start-voice' });
      }
      return { state, effects };
    case 'dispose':
      return { state, effects: [{ type: 'stop-voice' }] };
    case 'reload':
      return { state, effects: [{ type: 'reload' }] };
    case 'loaded':
      return { state: { ...(action.data.user === null ? { ...clearAccount(state), page: state.page, authView: state.authView, resetToken: state.resetToken, authMessage: state.authMessage } : state), ...action.data }, effects };
    case 'filter':
      return { state: { ...state, catalogFilter: { ...state.catalogFilter, [action.key]: action.value, limit: 30 } }, effects };
    case 'more-problems':
      return { state: { ...state, catalogFilter: { ...state.catalogFilter, limit: state.catalogFilter.limit + 30 } }, effects };
    case 'history-loaded':
      return { state: { ...state, attempts: [...state.attempts, ...action.data.attempts], historyPage: action.data.page, historyMore: action.data.hasMore }, effects };
    case 'evidence-loaded': {
      const attempt = { ...state.attempt, page: action.data.page, hasMore: action.data.hasMore };
      for (const key of ['events', 'transcripts', 'checkpoints', 'runs']) attempt[key] = [...state.attempt[key], ...action.data[key]];
      return { state: { ...state, attempt }, effects };
    }
    default:
      return { state, effects };
  }
}

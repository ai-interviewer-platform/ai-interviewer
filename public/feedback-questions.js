// Contextual feedback questions (#21), shared by the browser (public/support.js) and the
// server (src/feedback.ts). Change a question's wording or answers only with a new version.
export const feedbackQuestions = {
  landing: { id: 'landing-clarity', version: 1, question: 'How clear is what Coursay offers?', answers: { clear: 'Clear', partly: 'Partly clear', unclear: 'Unclear' } },
  practice: { id: 'practice-flow', version: 1, question: 'How did this practice step work for you?', answers: { expected: 'As expected', confusing: 'Somewhat confusing', blocked: 'It did not work for me' } },
  review: { id: 'review-understanding', version: 1, question: 'How understandable is this review?', answers: { understandable: 'Understandable', partly: 'Partly understandable', hard: 'Hard to follow' } },
  navigation: { id: 'navigation-ease', version: 1, question: 'How easy was it to find what you needed here?', answers: { easy: 'Easy', mixed: 'Somewhat hard', hard: 'Hard' } },
  policy: { id: 'policy-clarity', version: 1, question: 'How clear is this page?', answers: { clear: 'Clear', partly: 'Partly clear', unclear: 'Unclear' } },
  personal: { id: 'personal-practice', version: 1, question: 'How is personal practice working for you?', answers: { expected: 'As expected', confusing: 'Somewhat confusing', blocked: 'It did not work for me' } },
};
// The feature each page asks about. Every page in public/measurement-contract.js has one.
export const pageFeature = { landing: 'landing', welcome: 'navigation', roadmap: 'navigation', sessions: 'navigation', sample: 'practice', interview: 'practice', review: 'review', retry: 'practice', complete: 'review', related: 'navigation', preferences: 'navigation', system: 'navigation', 'demo-profile': 'navigation', terms: 'policy', privacy: 'policy', cookies: 'policy', personal: 'personal' };
export const feedbackCategories = ['usability', 'content', 'bug', 'feature_request', 'praise', 'other'];
export const feedbackStatuses = ['new', 'reviewing', 'planned', 'resolved', 'declined'];
// Closing a response needs a recorded resolution.
export const closedFeedbackStatuses = ['resolved', 'declined'];
export const feedbackTextLimit = 2000;

// The question asked on a page, or undefined for a page without one.
export function questionFor(page) {
  return Object.hasOwn(pageFeature, page) ? { feature: pageFeature[page], ...feedbackQuestions[pageFeature[page]] } : undefined;
}

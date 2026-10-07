import type { ReviewQueue } from "./review-queue";

export interface HyperdriveBinding {
  connectionString: string;
}

export interface PythonRunner {
  fetch(request: Request): Promise<Response>;
}

export interface Env {
  ASSETS: Fetcher;
  HYPERDRIVE?: HyperdriveBinding;
  DATABASE_URL?: string;
  REVIEW_QUEUE: ReviewQueue;
  PYTHON_RUNNER?: PythonRunner;
  PYTHON_RUNNER_URL?: string;
  PYTHON_RUNNER_TOKEN?: string;
  BETTER_AUTH_URL: string;
  // Deployed commit, set by `npm run deploy`. Absent in local development.
  GIT_SHA?: string;
  BETTER_AUTH_SECRET: string;
  PERSONAL_DATA_COLLECTION_APPROVED?: string;
  LANDING_PRIMARY_ACTION?: string;
  LANDING_EXPERIMENT?: string;
  WAITLIST_COLLECTION_APPROVED?: string;
  WAITLIST_POLICY?: string;
  WAITLIST_OPERATOR_TOKEN?: string;
  MEASUREMENT_COLLECTION_APPROVED?: string;
  FEEDBACK_COLLECTION_APPROVED?: string;
  BUG_REPORT_COLLECTION_APPROVED?: string;
  // Absent in local development and tests; then only the project-wide limits apply.
  FORM_VISITOR_LIMITER?: RateLimit;
  MEASURE_VISITOR_LIMITER?: RateLimit;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  DEEPGRAM_API_KEY?: string;
  VOICE_SESSIONS: DurableObjectNamespace;
  REVIEW_PROVIDER_API_KEY?: string;
  REVIEW_PROVIDER_MODEL?: string;
  REVIEW_PROVIDER?: string;
  // Workers AI: evidence-linked reviews and text-mode interviewer replies.
  AI?: Ai;
}

export interface HyperdriveBinding {
  connectionString: string;
}

export interface QueueMessage {
  id: string;
  body: unknown;
  ack(): void;
  retry(): void;
}

export interface ReviewQueue {
  send(body: { reviewId: string }): Promise<void>;
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
  BETTER_AUTH_SECRET: string;
  PERSONAL_DATA_COLLECTION_APPROVED?: string;
  LANDING_PRIMARY_ACTION?: string;
  WAITLIST_COLLECTION_APPROVED?: string;
  WAITLIST_POLICY?: string;
  WAITLIST_OPERATOR_TOKEN?: string;
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

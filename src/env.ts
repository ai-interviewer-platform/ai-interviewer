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
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  PERSONAL_DATA_COLLECTION_APPROVED?: string;
  DEEPGRAM_API_KEY?: string;
  REVIEW_PROVIDER_API_KEY?: string;
  REVIEW_PROVIDER_MODEL?: string;
}

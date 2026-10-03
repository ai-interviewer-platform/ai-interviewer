import type { Pool } from "pg";
import type { Env } from "./env";
import { logOperationalEvent } from "./observability";
import { reviewProviderConfigured, type ReviewProvider } from "./review-provider";
import { processReview } from "./reviews";

// The two ports of the Review queue. The Cloudflare Queue binding (REVIEW_QUEUE and the
// messages of the Worker queue handler) is one adapter; InMemoryReviewQueue is the other.
export interface ReviewQueue {
  send(body: { reviewId: string }): Promise<void>;
}
export interface ReviewMessage {
  readonly body: unknown;
  ack(): void;
  retry(): void;
}

// A claimed Review is not sent again until this window ends.
export const reviewDispatchClaimSeconds = 60;

export type ReviewDispatch =
  | { status: "queued" | "already dispatched"; reviewId: string }
  | { status: "failed" }
  | { status: "missing" };

// The one "Review configured" rule: a Review needs a provider and a queue.
export function reviewConfigured(env: Env): boolean {
  return reviewProviderConfigured(env) && Boolean(env.REVIEW_QUEUE?.send);
}

// Dispatches the Review of a completed Attempt: claim it, send it, and release the claim
// when the send fails. A finish retry calls this again, so after the claim window it also
// recovers a dispatch whose message was lost. There is no scheduled sweep.
export async function dispatchReview(pool: Pool, queue: ReviewQueue, attemptId: string): Promise<ReviewDispatch> {
  const review = await pool.query<{ id: string }>("SELECT id FROM reviews WHERE attempt_id = $1", [attemptId]);
  const reviewId = review.rows[0]?.id;
  if (!reviewId) return { status: "missing" };
  const claim = await pool.query(
    "UPDATE reviews SET dispatch_claimed_at = now() WHERE id = $1 AND status = 'pending' AND (dispatch_claimed_at IS NULL OR dispatch_claimed_at < now() - make_interval(secs => $2)) RETURNING id",
    [reviewId, reviewDispatchClaimSeconds],
  );
  if (!claim.rows.length) return { status: "already dispatched", reviewId };
  try {
    await queue.send({ reviewId });
  } catch {
    logOperationalEvent("warn", "review_dispatch_failed");
    await pool.query("UPDATE reviews SET dispatch_claimed_at = NULL WHERE id = $1 AND status = 'pending'", [reviewId]);
    return { status: "failed" };
  }
  return { status: "queued", reviewId };
}

function hasReviewId(value: unknown): value is { reviewId: string } {
  return typeof value === "object" && value !== null && !Array.isArray(value) && "reviewId" in value && typeof value.reviewId === "string";
}

// Consumes a batch of Review messages. An invalid message, a ready Review and a permanent
// failure are acknowledged; a transient failure is retried by the queue.
export async function consumeReviews(messages: readonly ReviewMessage[], env: Env, pool: Pool, provider?: ReviewProvider): Promise<void> {
  for (const message of messages) {
    const body = message.body;
    if (!hasReviewId(body)) {
      message.ack();
      continue;
    }
    try {
      await processReview(body.reviewId, env, pool, provider);
      message.ack();
    } catch {
      // Transient provider/database failures are retried by the queue. The
      // review record itself keeps the frozen evidence set and remains the
      // recovery source if dispatch was lost after an attempt completed.
      logOperationalEvent("warn", "review_queue_retry");
      message.retry();
    }
  }
}

// The in-memory adapter. Messages wait in order until a delivery consumes them as one batch.
// An acknowledged message leaves the queue; a retried message stays for the next delivery.
export class InMemoryReviewQueue implements ReviewQueue {
  readonly messages: unknown[] = [];
  private failedSends = 0;

  // The next send throws, as an unavailable queue does.
  failNextSend(): void {
    this.failedSends++;
  }

  async send(body: unknown): Promise<void> {
    if (this.failedSends > 0) {
      this.failedSends--;
      throw new Error("The in-memory Review queue rejected the message.");
    }
    this.messages.push(body);
  }

  async deliver(env: Env, pool: Pool, provider?: ReviewProvider): Promise<Array<"ack" | "retry">> {
    const outcomes: Array<"ack" | "retry"> = [];
    const batch = this.messages.splice(0).map((body, index) => ({
      body,
      ack: () => { outcomes[index] = "ack"; },
      retry: () => { outcomes[index] = "retry"; },
    }));
    await consumeReviews(batch, env, pool, provider);
    this.messages.push(...batch.filter((_, index) => outcomes[index] === "retry").map(message => message.body));
    return outcomes;
  }
}

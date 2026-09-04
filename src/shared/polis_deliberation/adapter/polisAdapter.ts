import type {
  PolisAdapter,
  PolisAdapterConfig,
  CreateDeliberationInput,
  VoteDirection,
  Statement,
  ClusterState,
  PolisConversationResponse,
  PolisComment,
  PolisMathResult,
  PolisNextCommentResponse,
} from "./types.js";

const RETRY_DELAYS = [500, 1500, 3000];
const REQUEST_TIMEOUT_MS = 15_000;

/** A Polis failure, carrying the upstream status and error code as FIELDS.
 *
 *  The body never goes into the message. Polis mints a participant JWT into
 *  its error responses, and the old message interpolated the whole body — so
 *  a 409 rendered a live one-year token, for Adam's own account, onto the
 *  conversation page (2026-09-04). The full body still reaches the server
 *  log, where it belongs. */
export interface PolisApiError extends Error {
  status: number;
  polisCode?: string;
}

function polisError(status: number, path: string, body: string): PolisApiError {
  let code: string | undefined;
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    if (typeof parsed.error === "string") code = parsed.error;
  } catch {
    /* not JSON — the code stays undefined and the log carries the text */
  }
  console.error(`[polis] ${status} ${path} — ${body}`);
  const err = new Error(
    `Polis API ${status}: ${path}${code ? ` (${code})` : ""}`,
  ) as PolisApiError;
  err.status = status;
  err.polisCode = code;
  return err;
}

export function createPolisAdapter(config: PolisAdapterConfig): PolisAdapter {
  const { baseUrl, authToken } = config;

  /**
   * Only GETs are retried.
   *
   * Every method used to be retried on timeout, and that is what wedged a
   * conversation on 2026-09-04: a POST to /api/v3/comments took longer than
   * the 15s timeout, the client aborted, and the retry posted the same
   * statement again — which Polis correctly rejected as
   * `polis_err_post_comment_duplicate`. A client-side timeout says nothing
   * about whether the server applied the write, so retrying a POST can only
   * ever duplicate it. Retrying a read is free; retrying a create is not.
   */
  function isRetryable(opts: RequestInit): boolean {
    return (opts.method ?? "GET").toUpperCase() === "GET";
  }

  async function apiFetch<T>(
    path: string,
    opts: RequestInit = {},
  ): Promise<T> {
    const url = `${baseUrl}${path}`;
    const retryable = isRetryable(opts);
    const maxAttempts = retryable ? RETRY_DELAYS.length : 0;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxAttempts; attempt++) {
      if (attempt > 0) {
        await sleep(RETRY_DELAYS[attempt - 1]);
      }

      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        REQUEST_TIMEOUT_MS,
      );

      try {
        const res = await fetch(url, {
          ...opts,
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
            ...((opts.headers as Record<string, string>) ?? {}),
          },
        });

        clearTimeout(timeout);

        if (!res.ok) {
          const body = await res.text().catch(() => "");
          if (res.status >= 500 && attempt < maxAttempts) {
            lastError = polisError(res.status, path, body);
            continue;
          }
          throw polisError(res.status, path, body);
        }

        const text = await res.text();
        if (!text) return {} as T;
        return JSON.parse(text) as T;
      } catch (err: any) {
        clearTimeout(timeout);
        if (err.name === "AbortError") {
          lastError = new Error(`Polis API timeout: ${path}`);
          if (attempt < maxAttempts) continue;
        }
        throw lastError ?? err;
      }
    }

    throw lastError ?? new Error(`Polis API failed: ${path}`);
  }

  const voteMap: Record<VoteDirection, -1 | 0 | 1> = {
    agree: 1,
    disagree: -1,
    pass: 0,
  };

  return {
    async createDeliberation(
      input: CreateDeliberationInput,
    ): Promise<{ conversation_id: string }> {
      const conv = await apiFetch<PolisConversationResponse>(
        "/api/v3/conversations",
        {
          method: "POST",
          body: JSON.stringify({
            topic: input.topic,
            description: input.description,
            is_active: true,
            is_draft: false,
            strict_moderation: input.strict_moderation,
            xid_required: true,
            use_xid_whitelist: false,
          }),
        },
      );

      const conversationId = conv.url.split("/").pop()!;

      // Seeding is best-effort, and deliberately so: the conversation EXISTS
      // the moment the call above returns, and the id is the only thing the
      // hub cannot recover on its own. Letting a seed failure throw meant the
      // id was never returned, so the hub recorded nothing while Polis kept a
      // live conversation — an orphan, and a second one on every retry
      // (2026-09-04, proc_5889e8e441d1495e / Polis 5fm62xv5ma). A conversation
      // that opens with some of its seed statements is far better than one
      // that is lost.
      if (input.seed_statements?.length) {
        const failed: string[] = [];
        for (const txt of input.seed_statements) {
          try {
            await apiFetch("/api/v3/comments", {
              method: "POST",
              body: JSON.stringify({
                conversation_id: conversationId,
                txt,
                is_seed: true,
              }),
            });
          } catch (err) {
            // A duplicate means the statement is already on the conversation,
            // which is the state we wanted — not a failure.
            if ((err as PolisApiError).polisCode === "polis_err_post_comment_duplicate") {
              continue;
            }
            failed.push(txt.slice(0, 60));
          }
        }
        if (failed.length > 0) {
          console.error(
            `[polis] conversation ${conversationId} opened, but ${failed.length} of ` +
              `${input.seed_statements.length} seed statements failed to post: ` +
              failed.join(" | "),
          );
        }
      }

      return { conversation_id: conversationId };
    },

    async submitStatement(
      conversationId: string,
      actorXid: string,
      text: string,
    ): Promise<{ statement_id: number }> {
      const result = await apiFetch<{ tid: number }>(
        "/api/v3/comments",
        {
          method: "POST",
          body: JSON.stringify({
            conversation_id: conversationId,
            txt: text,
            xid: actorXid,
          }),
        },
      );
      return { statement_id: result.tid };
    },

    async recordVote(
      conversationId: string,
      actorXid: string,
      statementId: number,
      vote: VoteDirection,
    ): Promise<void> {
      await apiFetch("/api/v3/votes", {
        method: "POST",
        body: JSON.stringify({
          conversation_id: conversationId,
          tid: statementId,
          vote: voteMap[vote],
          xid: actorXid,
        }),
      });
    },

    async getNextStatement(
      conversationId: string,
      actorXid: string,
    ): Promise<Statement | null> {
      try {
        const result = await apiFetch<PolisNextCommentResponse>(
          `/api/v3/nextComment?conversation_id=${enc(conversationId)}&xid=${enc(actorXid)}`,
        );
        console.log(`[polis] nextComment for xid=${actorXid} conv=${conversationId}:`, JSON.stringify(result));
        if (!result || !result.txt) return null;
        return {
          id: result.tid,
          text: result.txt,
          is_seed: result.is_seed ?? false,
          created: result.created,
        };
      } catch (err) {
        console.error(`[polis] nextComment error for xid=${actorXid} conv=${conversationId}:`, err);
        return null;
      }
    },

    async pullClusterState(conversationId: string): Promise<ClusterState> {
      const [math, comments] = await Promise.all([
        apiFetch<PolisMathResult>(
          `/api/v3/math/pca2?conversation_id=${enc(conversationId)}`,
        ),
        apiFetch<PolisComment[]>(
          `/api/v3/comments?conversation_id=${enc(conversationId)}&mod=1`,
        ),
      ]);

      const commentTexts = new Map(comments.map((c) => [c.tid, c.txt]));

      const groups = Object.entries(math.repness ?? {}).map(
        ([groupId, repComments]) => {
          const groupVotes = math["group-votes"]?.[groupId];
          return {
            id: Number(groupId),
            size: groupVotes?.["n-members"] ?? 0,
            representative_statements: repComments.slice(0, 5).map((rep) => ({
              text: commentTexts.get(rep.tid) ?? `[statement ${rep.tid}]`,
              direction: rep["repful-for"],
              repness: rep.repness,
            })),
          };
        },
      );

      const mapConsensus = (items: typeof math.consensus.agree) =>
        items.slice(0, 10).map((item) => ({
          statement_id: item.tid,
          text: commentTexts.get(item.tid) ?? `[statement ${item.tid}]`,
          agree_rate: item["p-success"],
          vote_count: item["n-trials"],
        }));

      return {
        participant_count: math.n ?? 0,
        statement_count: math["n-cmts"] ?? 0,
        math_tick: math.math_tick ?? 0,
        groups,
        consensus: {
          agree: mapConsensus(math.consensus?.agree ?? []),
          disagree: mapConsensus(math.consensus?.disagree ?? []),
        },
      };
    },

    async closeDeliberation(conversationId: string): Promise<void> {
      await apiFetch("/api/v3/conversation/close", {
        method: "POST",
        body: JSON.stringify({ conversation_id: conversationId }),
      });
    },

    async getStatements(conversationId: string): Promise<Statement[]> {
      const comments = await apiFetch<PolisComment[]>(
        `/api/v3/comments?conversation_id=${enc(conversationId)}&mod=1`,
      );
      return comments.map((c) => ({
        id: c.tid,
        text: c.txt,
        is_seed: c.is_seed,
        created: c.created,
      }));
    },
  };
}

function enc(s: string): string {
  return encodeURIComponent(s);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

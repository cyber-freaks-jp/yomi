/** Reviewed keyword search: explicit per-chat collection, no model or auto-fetch. */

import type { LineProtocolService } from '../../line/core/service.js'
import { collectMessages } from '../../search/collector.js'
import {
  getIndexedMessageCount,
  getMessageContext,
  type SearchResult,
  searchMessages,
} from '../../search/store.js'
import { createPhiAccumulator, maskInto, phiNote } from '../phi-guard.js'
import { jsonText, toolError, toonText } from './shared.js'

/**
 * Reciprocal Rank Fusion constant. The standard k=60 from Cormack et al.:
 * a result's contribution from one list is 1/(k + rank), so rank matters
 * but no single list can dominate on raw score scale (bm25's negative log
 * scores and cosine's [0,1] are never compared directly — only their
 * ranks are). Larger k flattens the rank curve; 60 is the well-tested default.
 */
const RRF_K = 60

/**
 * Merge several already-ranked result lists into one, deduping by
 * messageId, using Reciprocal Rank Fusion. Each list contributes
 * 1/(RRF_K + rank) to a message's fused score; scores sum across lists, so
 * a message ranked highly by BOTH keyword and semantic search rises above
 * one ranked highly by only one. The returned `score` is the fused RRF
 * score (NOT a cosine similarity or bm25 value) — it exists only to order
 * results, and is reported as-is rather than dressed up as a probability.
 *
 * @param lists - Ranked result lists (best-first) to fuse.
 * @param limit - Maximum number of fused results to return.
 * @returns Fused results, best-first, each carrying its RRF score.
 */
export function fuseByRrf(
  lists: SearchResult[][],
  limit: number,
): (SearchResult & { score: number })[] {
  const scores = new Map<string, number>()
  const rows = new Map<string, SearchResult>()
  for (const list of lists) {
    list.forEach((row, rank) => {
      scores.set(
        row.messageId,
        (scores.get(row.messageId) ?? 0) + 1 / (RRF_K + rank),
      )
      if (!rows.has(row.messageId)) {
        rows.set(row.messageId, row)
      }
    })
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([messageId, score]) => ({
      ...(rows.get(messageId) as SearchResult),
      score,
    }))
}

/**
 * Keep one active conversation from flooding the top results. Skipped rows are
 * backfilled only when there are not enough distinct conversations, so a query
 * scoped by its natural matches still returns the requested number of hits.
 */
export function applyConversationDiversity<T extends SearchResult>(
  rows: T[],
  limit: number,
  perChat = 3,
): T[] {
  const selected: T[] = []
  const deferred: T[] = []
  const counts = new Map<string, number>()
  for (const row of rows) {
    if ((counts.get(row.chatId) ?? 0) < perChat) {
      selected.push(row)
      counts.set(row.chatId, (counts.get(row.chatId) ?? 0) + 1)
    } else {
      deferred.push(row)
    }
  }
  return [...selected, ...deferred].slice(0, limit)
}

/** Collect only explicitly selected chats, without embeddings. */
export async function handleCollectMessages(
  service: LineProtocolService,
  args: { chatIds?: string[]; perChat?: number },
) {
  if (!Array.isArray(args.chatIds) || args.chatIds.length === 0) {
    return toolError(
      'Explicit chatIds are required; all-chat collection is disabled.',
    )
  }
  const summary = await collectMessages(service, {
    chatIds: args.chatIds,
    perChat: args.perChat,
  })
  return {
    content: [{ type: 'text' as const, text: jsonText(summary) }],
  }
}

/** Search the existing local keyword index without fetching messages. */
export async function handleSearchMessages(
  _service: LineProtocolService,
  args: { query: string; limit?: number },
) {
  if (!args.query) {
    return toolError('query is required.')
  }
  if (getIndexedMessageCount() === 0) {
    return {
      content: [
        {
          type: 'text' as const,
          text: 'Search index is empty. Explicitly collect selected chatIds first; search never collects automatically.',
        },
      ],
    }
  }
  const limit = args.limit ?? 20
  // Pull a deeper candidate pool from each method than the caller's limit,
  // so RRF has enough overlap/depth to reorder meaningfully before slicing.
  const pool = Math.max(limit * 3, 30)
  const keyword = searchMessages(args.query, pool)
  const mode = 'keyword'
  const results = applyConversationDiversity(keyword, limit)

  const acc = createPhiAccumulator()
  const maskedResults = (results as (SearchResult & { score?: number })[]).map(
    (row) => ({
      ...row,
      text: maskInto(acc, row.text),
      context: getMessageContext(row.messageId).map((message) => ({
        ...message,
        text: maskInto(acc, message.text),
      })),
    }),
  )
  const content: any[] = [
    {
      type: 'text' as const,
      text: toonText({ mode, results: maskedResults }),
    },
  ]
  const note = phiNote(acc)
  if (note) content.push(note)
  return { content }
}

/**
 * Model catalog for the free lane.
 *
 * Two sources, deliberately layered so no single one can break the plugin:
 *
 * 1. the upstream listing itself (`/zen/v1/models`) — the authoritative set of
 *    ids the gateway will currently name;
 * 2. a vetted local capability table (context window / vision / reasoning),
 *    because the upstream listing discloses an id and nothing else.
 *
 * @module src/catalog.js
 */

import { baseModelId, isResponsesModel } from './upstream.js'

/**
 * Ids that are free-tier without carrying the `-free` suffix.
 *
 * `big-pickle` is the reason this set exists beyond a regex: it is a stealth id
 * with no suffix, it is on the official Zen free list, and on 2026-10-01 it
 * answered `Bearer public` with a tool call in 2.1 s from this egress — while
 * every other unsuffixed id on the listing came back `401 AuthError Missing API
 * key`. A suffix-only rule hid a working model from the picker.
 */
const ALWAYS_FREE = new Set(['union-alpha', 'space-bunny-free', 'big-pickle'])

/**
 * Free-lane ids that are **not** chat models, and must never reach the picker.
 *
 * Jev is a "System One" structured-decision model from TypeSafe AI: instead of
 * generating text it evaluates a `state` against typed questions and returns
 * values with probabilities. Zen serves it at `/zen/v1/systemone`, not the chat
 * endpoint — measured 2026-10-01 on this egress: `/systemone` answers 200 with a
 * real answer in ~1 s, while `/chat/completions` answers `500 Internal server
 * error` every single time. It was sitting in the picker as a model that could
 * never complete a turn.
 *
 * It is still free and still usable — just through a tool rather than the model
 * selector. `dsh-jev-decide` exposes it that way.
 */
const NON_CHAT_MODELS = new Set(['jev-1.13', 'jev-1.13-free'])

/**
 * Local capability baseline. `contextWindow`/`maxOutput` are the provider's
 * published capacities; `vision` is what this lane actually accepted under a
 * direct image-input probe, not what a model card claims.
 */
export const CAPABILITIES = [
  { match: /^mimo.*v2\.6/, vision: true, reasoning: true, contextWindow: 1048576, maxOutput: 131072, canDisableThinking: false },
  { match: /^mimo.*v2\.5/, vision: true, reasoning: true, contextWindow: 1048576, maxOutput: 131072, canDisableThinking: false },
  { match: /^mimo/, vision: true, reasoning: true, contextWindow: 262144, maxOutput: 131072 },
  { match: /^muse.?spark/, vision: true, reasoning: true, contextWindow: 1048576, maxOutput: 131072 },
  // Measured on this lane 2026-10-01 with a codeword planted in message 1 of the
  // transcript: still recalled at 900 032 tokens (and at 700 032), while the
  // control that never received the codeword produced nothing — so the gateway
  // really serves ~1M here. The single 128 000 entry made dsh-compaction-basic
  // fire at 128 000 × 0.8 = 102 400 tokens and discard roughly eight times the
  // window the model can hold. Corroborated by pi-ai's registry and the Zen
  // free-model table, both of which say 1 000 000.
  { match: /^nemotron-3-ultra/, vision: false, reasoning: true, contextWindow: 1000000, maxOutput: 32768 },
  // Recalled the same way at 300 032 tokens; pi-ai and the free-model table both
  // say 262 144, so the threshold lands at 209 715 — inside what is proven.
  { match: /^nemotron-3\.5/, vision: false, reasoning: true, contextWindow: 262144, maxOutput: 32768 },
  { match: /^nemotron/, vision: false, reasoning: true, contextWindow: 128000, maxOutput: 32768 },
  { match: /^ling/, vision: false, reasoning: true, contextWindow: 128000, maxOutput: 32768 },
  { match: /^space.?bunny/, vision: true, reasoning: true, contextWindow: 262144, maxOutput: 65536 },
  { match: /^longcat/, vision: true, reasoning: true, contextWindow: 262144, maxOutput: 65536 },
  { match: /^union/, vision: true, reasoning: false, contextWindow: 262144, maxOutput: 131072 },
  // Stealth id, no suffix: 200 K / 32 K is the published figure (pi.dev and the
  // Zen free-model pages both say 200000 / 32000), text-only, answers anonymously.
  { match: /^big.?pickle/, vision: false, reasoning: true, contextWindow: 200000, maxOutput: 32000 },
  { match: /^deepseek/, vision: false, reasoning: true, contextWindow: 128000, maxOutput: 64000 },
  { match: /^jev/, vision: false, reasoning: false, contextWindow: 32768, maxOutput: 4096 },
]

/** Human-facing display names, so a raw upstream id never reaches the picker. */
const DISPLAY_NAMES = {
  'mimo-v2.6-flash-free': 'MiMo V2.6 Flash',
  'mimo-v2.5-free': 'MiMo V2.5',
  'muse-spark-1.3-contributor-free': 'Muse Spark 1.3',
  'muse-spark-1.2-contributor-free': 'Muse Spark 1.2',
  'nemotron-3-ultra-free': 'Nemotron 3 Ultra',
  'nemotron-3.5-lightning-free': 'Nemotron 3.5 Lightning',
  'ling-3.0-flash-fin-free': 'Ling 3.0 Flash Fin',
  'space-bunny-free': 'Space Bunny',
  'union-alpha': 'Union Alpha',
  'deepseek-v4-flash-free': 'DeepSeek V4 Flash',
  'jev-1.13-free': 'Jev 1.13',
  'big-pickle': 'Big Pickle',
}

/** Ids whose regional availability is known to be egress-dependent. */
const REGION_SENSITIVE = [/^muse.?spark/]

/**
 * Is this id on the免密 lane? The gateway's listing mixes paid and free ids;
 * only these answer without a per-user key.
 */
export function isFreeLane(modelId) {
  const base = baseModelId(modelId)
  if (ALWAYS_FREE.has(base)) return true
  return /(?:^|[-_])free(?:$|[-_.])/.test(base)
}

/** Look up the baseline capacities for one model id. */
export function capabilitiesFor(modelId) {
  const base = baseModelId(modelId)
  for (const entry of CAPABILITIES) if (entry.match.test(base)) return entry
  return { vision: false, reasoning: true, contextWindow: 131072, maxOutput: 32768 }
}

export function isRegionSensitive(modelId) {
  const base = baseModelId(modelId)
  return REGION_SENSITIVE.some(pattern => pattern.test(base))
}

/** Title-case a bare upstream id into something a picker can show. */
export function displayModelName(modelId) {
  const base = baseModelId(modelId)
  const known = DISPLAY_NAMES[base]
  if (known !== undefined) return known
  const words = base
    .replace(/[-_.]+/g, ' ')
    .replace(/(\d)\s+/g, '$1 ')
    .trim()
    .split(' ')
    .map(word => (/^\d/.test(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ')
  return words
}

/**
 * Merge the upstream listing with the local capability table.
 *
 * @param {string[]} ids - raw upstream model ids
 * @returns {Array<object>} catalog entries in listing order
 */
export function buildCatalog(ids) {
  const seen = new Set()
  const entries = []
  for (const raw of ids) {
    const id = String(raw ?? '').trim()
    if (id === '' || !isFreeLane(id)) continue
    const base = baseModelId(id)
    if (NON_CHAT_MODELS.has(base)) continue
    if (seen.has(base)) continue
    seen.add(base)
    const caps = capabilitiesFor(base)
    entries.push({
      id: base,
      name: displayModelName(base),
      wire: isResponsesModel(base) ? 'responses' : 'chat',
      vision: caps.vision === true,
      reasoning: caps.reasoning !== false,
      contextWindow: number(caps.contextWindow) ?? 131072,
      maxOutput: number(caps.maxOutput) ?? 32768,
      canDisableThinking: caps.canDisableThinking !== false,
      regionSensitive: isRegionSensitive(base),
    })
  }
  return entries
}

function number(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : undefined
}

/** Parse the gateway's `{"data":[{"id":…}]}` listing. */
export function parseListing(payload) {
  const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : Array.isArray(payload) ? payload : []
  return rows.map(row => (typeof row === 'string' ? row : row?.id)).filter(id => typeof id === 'string' && id !== '')
}

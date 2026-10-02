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
  // MiMo V2.6：官方 mimo.mi.com 规格 1M / 128K。Zen 免费通道实测 262K 与 325K
  // 超长输入均正常且能召回开头码字（models.dev/pi-ai 的 200K/32K 是过时数据，
  // 会误导压缩阈值提前 5~6 倍）。2026-10-02 实测：视觉可用（图片正确读出 FLEDGE
  // 42）；reasoning_effort 全档位接受，"none" 能真正关思考（reasoning 归零），但
  // OFM 不提供 Off 档，故 canDisableThinking 仍为 false 以保留"思考与正文共享
  // 上限"的翻倍预算；effortAware 让 Light/Balanced/Deep 映射成 low/high/max
  // 真实生效。
  { match: /^mimo.*v2\.6/, vision: true, reasoning: true, contextWindow: 1048576, maxOutput: 131072, canDisableThinking: false, effortAware: true },
  // MiMo V2.5：同上，官方 1M / 128K；视觉实测可用；effort 实测 "none" 关思考、
  // low/max 改变推理量。
  { match: /^mimo.*v2\.5/, vision: true, reasoning: true, contextWindow: 1048576, maxOutput: 131072, canDisableThinking: false, effortAware: true },
  { match: /^mimo/, vision: true, reasoning: true, contextWindow: 1048576, maxOutput: 131072 },
  { match: /^muse.?spark/, vision: true, reasoning: true, contextWindow: 1048576, maxOutput: 131072 },
  // Measured on this lane 2026-10-01 with a codeword planted in message 1 of the
  // transcript: still recalled at 900 032 tokens (and at 700 032), while the
  // control that never received the codeword produced nothing — so the gateway
  // really serves ~1M here. The single 128 000 entry made dsh-compaction-basic
  // fire at 128 000 × 0.8 = 102 400 tokens and discard roughly eight times the
  // window the model can hold. Corroborated by pi-ai's registry and the Zen
  // free-model table, both of which say 1 000 000.
  // 2026-10-02 实测：effort "none" 可真正关思考（reasoning 归零），low/max 改变推理
  // 量，故 effortAware；OFM 无 Off 档，thinking 实际恒开，canDisableThinking 置 false
  // 以翻倍共享上限。
  { match: /^nemotron-3-ultra/, vision: false, reasoning: true, contextWindow: 1000000, maxOutput: 128000, canDisableThinking: false, effortAware: true },
  // Recalled the same way at 300 032 tokens; pi-ai and the free-model table both
  // say 262 144, so the threshold lands at 209 715 — inside what is proven.
  // effort 实测同 3-ultra："none" 关思考、low/max 改变推理量。
  { match: /^nemotron-3\.5/, vision: false, reasoning: true, contextWindow: 262144, maxOutput: 262144, canDisableThinking: false, effortAware: true },
  { match: /^nemotron/, vision: false, reasoning: true, contextWindow: 128000, maxOutput: 32768 },
  { match: /^ling/, vision: false, reasoning: true, contextWindow: 262144, maxOutput: 32768 },
  // Space Bunny（2026-09-23 发布，官方博客确认 1M 上下文）：models.dev 记录
  // 1M / 524288，支持 effort low/medium/high/xhigh/max。旧值 262144/65536 偏小，
  // 会提前 4 倍触发压缩。effortAware 让 OFM 的 light/balanced/deep 映射成
  // low/high/max 发出（都在其允许范围内）。2026-10-02 实测：reasoning_effort "none"
  // 直接 400、thinking.type=disabled 也 400，思考无法关闭，canDisableThinking 置 false。
  { match: /^space.?bunny/, vision: true, reasoning: true, contextWindow: 1048576, maxOutput: 524288, canDisableThinking: false, effortAware: true },
  // LongCat 2.5 Preview（官方 LongCat 2.x 系列 1M 上下文）：models.dev 记录
  // 1M / 131072。旧值 262144/65536 偏小约 4 倍。2026-10-02 实测视觉可用；
  // reasoning_effort 全档位接受但 "none" 不能关思考（thinking.type=disabled 可以），
  // OFM 不发送 thinking 字段，故保持默认 canDisableThinking。
  { match: /^longcat/, vision: true, reasoning: true, contextWindow: 1000000, maxOutput: 131072 },
  { match: /^union/, vision: true, reasoning: false, contextWindow: 262144, maxOutput: 131072 },
  // Stealth id, no suffix: 200 K / 32 K is the published figure (pi.dev and the
  // Zen free-model pages both say 200000 / 32000), text-only, answers anonymously.
  // 2026-10-02 实测：reasoning_effort "none" 400，思考无法关闭。
  { match: /^big.?pickle/, vision: false, reasoning: true, contextWindow: 200000, maxOutput: 32000, canDisableThinking: false },
  // DeepSeek V4 Flash：models.dev 与 pi-ai 均记 200K / 128K（旧值 128K/64K 偏小）。
  // 该模型当前在免费通道已停服（Model is unavailable），由可用性探测从选择器移除；
  // 若回归，参数即按真实规格生效。
  { match: /^deepseek/, vision: false, reasoning: true, contextWindow: 200000, maxOutput: 128000 },
  // Fledge（2026-10 新模型，Lab 未知）：models.dev 记录 1M / 131072 且 input 含 image；
  // 2026-10-02 实测视觉可用（正确读出图片文字/颜色/形状）。实测只接受
  // reasoning_effort = ["low","high","max"]（"none"/"minimal"/"medium"/"xhigh" 均 400），
  // 思考不能关。effortAware 标记让 adapter 把 OFM 的 light/balanced/deep 映射成上游
  // reasoning_effort 值（effort.js EFFORT_WIRE），从而触发真正的深度推理；
  // 否则该模型只回"复述用户输入"的伪推理，且 OFM 解析器拿不到标准字段。
  { match: /^fledge/, vision: true, reasoning: true, contextWindow: 1048576, maxOutput: 131072, canDisableThinking: false, effortAware: true },
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
      effortAware: caps.effortAware === true,
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

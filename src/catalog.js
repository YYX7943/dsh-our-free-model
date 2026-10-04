/**
 * Model catalog for the free lane.
 *
 * Two sources, deliberately layered so no single one can break the plugin:
 *
 * 1. the upstream listing itself (`/zen/v1/models`) 鈥?the authoritative set of
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
 * answered `Bearer public` with a tool call in 2.1 s from this egress 鈥?while
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
 * endpoint 鈥?measured 2026-10-01 on this egress: `/systemone` answers 200 with a
 * real answer in ~1 s, while `/chat/completions` answers `500 Internal server
 * error` every single time. It was sitting in the picker as a model that could
 * never complete a turn.
 *
 * It is still free and still usable 鈥?just through a tool rather than the model
 * selector. `dsh-jev-decide` exposes it that way.
 */
const NON_CHAT_MODELS = new Set(['jev-1.13', 'jev-1.13-free'])

/**
 * Local capability baseline. `contextWindow`/`maxOutput` are the provider's
 * published capacities; `vision` is what this lane actually accepted under a
 * direct image-input probe, not what a model card claims.
 */
export const CAPABILITIES = [
  // MiMo V2.6锛氬畼鏂?mimo.mi.com 瑙勬牸 1M / 128K銆俍en 鍏嶈垂閫氶亾瀹炴祴 262K 涓?325K
  // 瓒呴暱杈撳叆鍧囨甯镐笖鑳藉彫鍥炲紑澶寸爜瀛楋紙models.dev/pi-ai 鐨?200K/32K 鏄繃鏃舵暟鎹紝
  // 浼氳瀵煎帇缂╅槇鍊兼彁鍓?5~6 鍊嶏級銆?026-10-02 瀹炴祴锛氳瑙夊彲鐢紙鍥剧墖姝ｇ‘璇诲嚭 FLEDGE
  // 42锛夛紱reasoning_effort 鍏ㄦ。浣嶆帴鍙楋紝"none" 鑳界湡姝ｅ叧鎬濊€冿紙reasoning 褰掗浂锛夛紝浣?  // OFM 涓嶆彁渚?Off 妗ｏ紝鏁?canDisableThinking 浠嶄负 false 浠ヤ繚鐣?鎬濊€冧笌姝ｆ枃鍏变韩
  // 涓婇檺"鐨勭炕鍊嶉绠楋紱effortAware 璁?Light/Balanced/Deep 鏄犲皠鎴?low/high/max
  // 鐪熷疄鐢熸晥銆?  { match: /^mimo.*v2\.6/, vision: true, reasoning: true, contextWindow: 1048576, maxOutput: 131072, canDisableThinking: false, effortAware: true },
  // MiMo V2.5锛氬悓涓婏紝瀹樻柟 1M / 128K锛涜瑙夊疄娴嬪彲鐢紱effort 瀹炴祴 "none" 鍏虫€濊€冦€?  // low/max 鏀瑰彉鎺ㄧ悊閲忋€?  { match: /^mimo.*v2\.5/, vision: true, reasoning: true, contextWindow: 1048576, maxOutput: 131072, canDisableThinking: false, effortAware: true },
  { match: /^mimo/, vision: true, reasoning: true, contextWindow: 1048576, maxOutput: 131072 },
  { match: /^muse.?spark/, vision: true, reasoning: true, contextWindow: 1048576, maxOutput: 131072 },
  // Measured on this lane 2026-10-01 with a codeword planted in message 1 of the
  // transcript: still recalled at 900 032 tokens (and at 700 032), while the
  // control that never received the codeword produced nothing 鈥?so the gateway
  // really serves ~1M here. The single 128 000 entry made dsh-compaction-basic
  // fire at 128 000 脳 0.8 = 102 400 tokens and discard roughly eight times the
  // window the model can hold. Corroborated by pi-ai's registry and the Zen
  // free-model table, both of which say 1 000 000.
  // 2026-10-02 瀹炴祴锛歟ffort "none" 鍙湡姝ｅ叧鎬濊€冿紙reasoning 褰掗浂锛夛紝low/max 鏀瑰彉鎺ㄧ悊
  // 閲忥紝鏁?effortAware锛汷FM 鏃?Off 妗ｏ紝thinking 瀹為檯鎭掑紑锛宑anDisableThinking 缃?false
  // 浠ョ炕鍊嶅叡浜笂闄愩€?  { match: /^nemotron-3-ultra/, vision: false, reasoning: true, contextWindow: 1000000, maxOutput: 128000, canDisableThinking: false, effortAware: true },
  // Recalled the same way at 300 032 tokens; pi-ai and the free-model table both
  // say 262 144, so the threshold lands at 209 715 鈥?inside what is proven.
  // effort 瀹炴祴鍚?3-ultra锛?none" 鍏虫€濊€冦€乴ow/max 鏀瑰彉鎺ㄧ悊閲忋€?  { match: /^nemotron-3\.5/, vision: false, reasoning: true, contextWindow: 262144, maxOutput: 262144, canDisableThinking: false, effortAware: true },
  { match: /^nemotron/, vision: false, reasoning: true, contextWindow: 128000, maxOutput: 32768 },
  { match: /^ling/, vision: false, reasoning: true, contextWindow: 262144, maxOutput: 32768 },
  // Space Bunny锛?026-09-23 鍙戝竷锛屽畼鏂瑰崥瀹㈢‘璁?1M 涓婁笅鏂囷級锛歮odels.dev 璁板綍
  // 1M / 524288锛屾敮鎸?effort low/medium/high/xhigh/max銆傛棫鍊?262144/65536 鍋忓皬锛?  // 浼氭彁鍓?4 鍊嶈Е鍙戝帇缂┿€俥ffortAware 璁?OFM 鐨?light/balanced/deep 鏄犲皠鎴?  // low/high/max 鍙戝嚭锛堥兘鍦ㄥ叾鍏佽鑼冨洿鍐咃級銆?026-10-02 瀹炴祴锛歳easoning_effort "none"
  // 鐩存帴 400銆乼hinking.type=disabled 涔?400锛屾€濊€冩棤娉曞叧闂紝canDisableThinking 缃?false銆?  { match: /^space.?bunny/, vision: true, reasoning: true, contextWindow: 1048576, maxOutput: 524288, canDisableThinking: false, effortAware: true },
  // LongCat 2.5 Preview锛堝畼鏂?LongCat 2.x 绯诲垪 1M 涓婁笅鏂囷級锛歮odels.dev 璁板綍
  // 1M / 131072銆傛棫鍊?262144/65536 鍋忓皬绾?4 鍊嶃€?026-10-02 瀹炴祴瑙嗚鍙敤锛?  // reasoning_effort 鍏ㄦ。浣嶆帴鍙椾絾 "none" 涓嶈兘鍏虫€濊€冿紙thinking.type=disabled 鍙互锛夛紝
  // OFM 涓嶅彂閫?thinking 瀛楁锛屾晠淇濇寔榛樿 canDisableThinking銆?  { match: /^longcat/, vision: true, reasoning: true, contextWindow: 1000000, maxOutput: 131072 },
  { match: /^union/, vision: true, reasoning: false, contextWindow: 262144, maxOutput: 131072 },
  // Stealth id, no suffix: 200 K / 32 K is the published figure (pi.dev and the
  // Zen free-model pages both say 200000 / 32000), text-only, answers anonymously.
  // 2026-10-02 瀹炴祴锛歳easoning_effort "none" 400锛屾€濊€冩棤娉曞叧闂€?  { match: /^big.?pickle/, vision: false, reasoning: true, contextWindow: 200000, maxOutput: 32000, canDisableThinking: false },
  // DeepSeek V4 Flash锛歮odels.dev 涓?pi-ai 鍧囪 200K / 128K锛堟棫鍊?128K/64K 鍋忓皬锛夈€?  // 璇ユā鍨嬪綋鍓嶅湪鍏嶈垂閫氶亾宸插仠鏈嶏紙Model is unavailable锛夛紝鐢卞彲鐢ㄦ€ф帰娴嬩粠閫夋嫨鍣ㄧЩ闄わ紱
  // 鑻ュ洖褰掞紝鍙傛暟鍗虫寜鐪熷疄瑙勬牸鐢熸晥銆?  { match: /^deepseek/, vision: false, reasoning: true, contextWindow: 200000, maxOutput: 128000 },
  // Fledge锛?026-10 鏂版ā鍨嬶紝Lab 鏈煡锛夛細models.dev 璁板綍 1M / 131072 涓?input 鍚?image锛?  // 2026-10-02 瀹炴祴瑙嗚鍙敤锛堟纭鍑哄浘鐗囨枃瀛?棰滆壊/褰㈢姸锛夈€傚疄娴嬪彧鎺ュ彈
  // reasoning_effort = ["low","high","max"]锛?none"/"minimal"/"medium"/"xhigh" 鍧?400锛夛紝
  // 鎬濊€冧笉鑳藉叧銆俥ffortAware 鏍囪璁?adapter 鎶?OFM 鐨?light/balanced/deep 鏄犲皠鎴愪笂娓?  // reasoning_effort 鍊硷紙effort.js EFFORT_WIRE锛夛紝浠庤€岃Е鍙戠湡姝ｇ殑娣卞害鎺ㄧ悊锛?  // 鍚﹀垯璇ユā鍨嬪彧鍥?澶嶈堪鐢ㄦ埛杈撳叆"鐨勪吉鎺ㄧ悊锛屼笖 OFM 瑙ｆ瀽鍣ㄦ嬁涓嶅埌鏍囧噯瀛楁銆?  { match: /^fledge/, vision: true, reasoning: true, contextWindow: 1048576, maxOutput: 131072, canDisableThinking: false, effortAware: true },
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
 * Is this id on the鍏嶅瘑 lane? The gateway's listing mixes paid and free ids;
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

/** Parse the gateway's `{"data":[{"id":鈥]}` listing. */
export function parseListing(payload) {
  const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : Array.isArray(payload) ? payload : []
  return rows.map(row => (typeof row === 'string' ? row : row?.id)).filter(id => typeof id === 'string' && id !== '')
}

export const EAC_CHANNEL = 'eac'
export const EAC_TAG = 'EAC'

const EAC_DISPLAY_NAMES = {
  'deepseek-ai/deepseek-v4.1-flash': 'DeepSeek V4.1 Flash',
  'moonshotai/kimi-k2.6': 'Kimi K2.6',
  'moonshotai/kimi-k3': 'Kimi K3',
  'openai/gpt-oss-20b': 'GPT-OSS 20B',
  'z-ai/glm-5.3': 'GLM 5.3',
  'z-ai/glm-5.3-flash': 'GLM 5.3 Flash',
}

/**
 * Capacities per model: published specs cross-checked against this lane where
 * the relay allowed a probe (2026-10-03), and the thinking-level menu copied
 * from ZCode's built-in provider config (`config/provider/zcode-builtin.json`,
 * the `modelRules`/`modelApiRules`/`providerSiteRules` buckets) — the same
 * per-model declaration shape that product ships: a list of levels plus a
 * JSON merge patch the level maps onto the request body. `vision` records what
 * the relay actually accepted under a direct image-input probe — DeepSeek V4.1
 * Flash and GLM 5.3 Flash answered a 1×1 image with its colour; the Kimi
 * models carry native vision encoders per their model cards but the relay's
 * kimi routes were down during the probe, so their flag follows the published
 * spec. These numbers bound the client-side truncation estimates and the sent
 * max_tokens; the relay enforces its own ceilings on the wire.
 *
 * `efforts`/`effortDefault`/`effortPatch` mirror ZCode's declaration for the
 * model families it names; `effortPatch` uses `$effort` as the selected
 * level's placeholder, and `effortOffPatch` (when present) replaces the patch
 * for the off level. Models ZCode does not declare (kimi-k2.6, gpt-oss-20b)
 * fall back to the family-standard `reasoning_effort` field.
 */
const EAC_CAPABILITIES = [
  {
    match: /^deepseek-ai\/deepseek-v4/,
    vision: true, reasoning: true, contextWindow: 1048576, maxOutput: 384000,
    efforts: ['disabled', 'low', 'high', 'max'], effortDefault: 'high',
    effortPatch: { reasoning_effort: '$effort' },
    effortOffPatch: { reasoning: { enabled: false } },
  },
  {
    match: /^moonshotai\/kimi-k3/,
    vision: true, reasoning: true, contextWindow: 1048576, maxOutput: 131072,
    efforts: ['low', 'high', 'max'], effortDefault: 'high',
    effortPatch: { reasoning_effort: '$effort' },
  },
  {
    match: /^moonshotai\/kimi/,
    vision: true, reasoning: true, contextWindow: 262144, maxOutput: 98304,
    efforts: ['low', 'high', 'max'], effortDefault: 'high',
    effortPatch: { reasoning_effort: '$effort' },
  },
  {
    match: /^z-ai\/glm-5\.3-flash/,
    vision: true, reasoning: true, contextWindow: 1048576, maxOutput: 131072,
    efforts: ['low', 'high', 'max'], effortDefault: 'high',
    effortPatch: { thinking: { type: 'enabled' }, output_config: { effort: '$effort' } },
  },
  {
    match: /^z-ai\/glm-5/,
    vision: false, reasoning: true, contextWindow: 1048576, maxOutput: 131072,
    efforts: ['low', 'high', 'max'], effortDefault: 'high',
    effortPatch: { thinking: { type: 'enabled' }, output_config: { effort: '$effort' } },
  },
  {
    match: /^openai\/gpt-oss/,
    vision: false, reasoning: true, contextWindow: 131072, maxOutput: 32768,
    efforts: ['low', 'medium', 'high'], effortDefault: 'medium',
    effortPatch: { reasoning_effort: '$effort' },
  },
]

/** `org/model` → the model's own name under the channel tag. */
export function eacDisplayName(modelId) {
  const base = String(modelId ?? '').trim()
  const bare = base.includes('/') ? base.slice(base.indexOf('/') + 1) : base
  const known = EAC_DISPLAY_NAMES[base]
  const pretty = known ?? bare
    .replace(/[-_.]+/g, ' ')
    .trim()
    .split(' ')
    .map(word => (/^\d/.test(word) ? word : word.toUpperCase() === word ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ')
  return `${EAC_TAG} ${pretty}`
}

function eacCapabilitiesFor(modelId) {
  for (const entry of EAC_CAPABILITIES) if (entry.match.test(modelId)) return entry
  return { vision: false, reasoning: true, contextWindow: 131072, maxOutput: 32768 }
}

/**
 * Build the co-paid lane's catalog rows from its raw listing ids.
 *
 * Every row is one chat-wire model that always thinks (the relay streams
 * reasoning whether or not the caller asks for it) and never sees images.
 */
export function buildEacCatalog(ids) {
  const seen = new Set()
  const entries = []
  for (const raw of ids) {
    const id = String(raw ?? '').trim()
    if (id === '' || seen.has(id)) continue
    seen.add(id)
    const caps = eacCapabilitiesFor(id)
    entries.push({
      id,
      name: eacDisplayName(id),
      channel: EAC_CHANNEL,
      wire: 'chat',
      vision: caps.vision === true,
      reasoning: caps.reasoning !== false,
      contextWindow: number(caps.contextWindow) ?? 131072,
      maxOutput: number(caps.maxOutput) ?? 32768,
      canDisableThinking: Array.isArray(caps.efforts) ? caps.efforts.includes('disabled') : false,
      regionSensitive: false,
      // The model's declared thinking menu, copied from ZCode's built-in config.
      ...Array.isArray(caps.efforts) ? { efforts: [...caps.efforts], effortDefault: caps.effortDefault } : {},
      ...caps.effortPatch === undefined ? {} : { effortPatch: caps.effortPatch },
      ...caps.effortOffPatch === undefined ? {} : { effortOffPatch: caps.effortOffPatch },
    })
  }
  return entries
}

/** Is this catalog row from the co-paid lane? */
export function isEacEntry(entry) {
  return entry?.channel === EAC_CHANNEL
}

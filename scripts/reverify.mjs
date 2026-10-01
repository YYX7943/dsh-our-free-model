/**
 * One-command health check for the anonymous free lane.
 *
 * The repo's older probes under `scripts/probes/` import `./open-sse/…`, a
 * directory that is not in the tree, so eight of them fail with
 * `ERR_MODULE_NOT_FOUND` before sending anything — exactly when they are needed,
 * i.e. after upstream moves the gate. This script uses the plugin's own modules
 * instead, so it exercises the same headers, the same tool fingerprint and the
 * same endpoint split the adapter will use in a real turn.
 *
 * Three lamps, mirroring what an operator actually asks:
 *
 *   ① is the catalogue reachable and does it still parse into free-lane entries?
 *   ② does the anonymous gate accept this client identity right now?
 *   ③ which models answer from *this* egress?
 *
 * It prints status codes, verdicts and latencies only — never content, never a
 * key (the lane's credential is the literal `public`, and nothing else exists).
 *
 *   node scripts/reverify.mjs            # everything
 *   node scripts/reverify.mjs mimo-v2.6-flash-free big-pickle
 *
 * Exit code: 0 = the lane answered; 1 = the gate refused, or the catalogue could
 * not be read (both are real problems, not configuration mistakes).
 */
import { buildCatalog, parseListing } from '../src/catalog.js'
import { detectEgress, probeModel, STATE } from '../src/probe.js'
import { UPSTREAM_BASE } from '../src/upstream.js'

const ONLY = process.argv.slice(2)
const green = text => `🟢 ${text}`
const yellow = text => `🟡 ${text}`
const red = text => `🔴 ${text}`

/** A refusal about the client identity, as opposed to about the model. */
function gateRefused(result) {
  return /free tier|within opencode|missing session/i.test(result?.detail ?? '')
}

const rows = []
const lastVerdict = new Map()
const say = line => { console.log(line); rows.push(line) }

// ① catalogue
say('== ① 目录 ==')
let entries = []
try {
  const response = await fetch(`${UPSTREAM_BASE}/zen/v1/models`, { headers: { 'User-Agent': 'opencode/1.18.31' } })
  const listing = parseListing(await response.json())
  entries = buildCatalog(listing)
  if (response.status !== 200) {
    say(red(`HTTP ${response.status}：上游目录不可达，先查网络`))
    console.log('\n目录不通，② ③ 无从谈起。')
    process.exit(1)
  }
  say(green(`HTTP 200：上游列出 ${listing.length} 个 id，其中 ${entries.length} 个判定为免密车道`))
} catch (error) {
  say(red(`目录读取失败：${String(error?.message ?? error)}`))
  process.exit(1)
}

// ② the gate
const canary = ONLY[0] ?? (entries.find(e => e.id === 'mimo-v2.6-flash-free') ?? entries[0])?.id
say('')
say(`== ② 匿名门禁（canary: ${canary ?? '无模型'}）==`)
let gate = null
if (canary === undefined) {
  say(yellow('目录里没有可探测的模型，跳过'))
} else {
  const entry = entries.find(e => e.id === canary) ?? { id: canary }
  gate = await probeModel(entry, { timeoutMs: 30000 })
  if (gate.state === STATE.available) {
    say(green(`通过：${canary} 在 ${gate.latencyMs} ms 内应答${gate.ttftMs === undefined ? '' : `，首字 ${gate.ttftMs} ms`}`))
  } else if (gateRefused(gate)) {
    say(red(`门禁拒绝：${gate.detail}`))
  } else {
    say(yellow(`${canary} → ${gate.state}：${gate.detail ?? '（无详情）'}`))
  }
}

// ③ per-model
const targets = ONLY.length > 0
  ? ONLY.map(id => entries.find(e => e.id === id) ?? { id })
  : entries
if (targets.length > 0) {
  say('')
  say(`== ③ 逐模型（${targets.length} 个）==`)
  const width = Math.max(...targets.map(e => e.id.length))
  let refusedAll = 0
  for (const model of targets) {
    const result = await probeModel(model, { timeoutMs: 30000 })
    lastVerdict.set(model.id, result.state)
    const lamp = result.state === STATE.available ? green('可用  ')
      : result.state === STATE.regionBlocked ? yellow('地区受限')
      : result.state === STATE.throttled ? yellow('限流  ')
      : gateRefused(result) ? red('门禁拒')
      : result.state === STATE.unavailable ? red('已下架')
      : yellow('未知  ')
    if (gateRefused(result)) refusedAll += 1
    const detail = result.state === STATE.available
      ? `${result.latencyMs} ms${result.ttftMs === undefined ? '' : `，首字 ${result.ttftMs} ms`}`
      : String(result.detail ?? '').slice(0, 110)
    say(`  ${lamp}  ${model.id.padEnd(width)}  ${detail}`)
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  say('')
  if (targets.length > 0 && refusedAll === targets.length) {
    say(red('全部被以「free tier / within OpenCode」拒绝：上游门禁已变更，这不是配置问题。'))
    say('     等插件更新；拿到新门禁条件后，用它对照 src/upstream.js 的 gatewayHeaders / applyFingerprint。')
    process.exit(1)
  }
}

// egress (informational only — a refusal is a property of the path, not a fault)
const egress = await detectEgress()
console.log(`\n出口：${egress ? `${egress.ip}${egress.country ? ` (${egress.country})` : ''}` : '未知（回显站不可达）'}`)

// The verdict is about the *lane*, not about individual models: an id upstream
// quietly dropped is routine and must not colour the conclusion.
const gateBroken = gate !== null && gateRefused(gate)
if (gateBroken) {
  console.log('\n结论：门禁拒绝 — 上游改了规则，不是配置问题。')
  process.exit(1)
}
console.log(`\n结论：车道可用 — ${targets.filter(model => lastVerdict.get(model.id) === STATE.available).length}/${targets.length} 个模型本轮应答。`)

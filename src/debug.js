/**
 * Diagnostic trace for the outbound lane.
 *
 * When the upstream gate moves — and it has moved at least three times in the
 * two months to 2026-10 (UA gate → tool fingerprint → `x-opencode-*` session
 * headers) — the only thing that tells you *which* leg broke is a record of what
 * actually left the machine. Without it the only signal is a 403 whose message
 * names none of the conditions that caused it.
 *
 * Two ways to turn it on, because DSH Desktop has no shell environment to export
 * a variable into:
 *
 *   OUR_FREE_MODEL_DEBUG=1 dsh …        # shell / headless
 *   touch ~/.dsh/our-free-model/debug   # desktop; takes effect immediately
 *
 * The file is checked per request rather than cached, so creating or deleting it
 * needs no restart — one `stat` against a request that is about to spend
 * seconds on a network round trip is not a measurable cost.
 *
 * What is logged: endpoint, the gate headers, the canonical ids, and the *shape*
 * of the body (model, wire, roles, declared tool names, budgets).
 *
 * What is never logged: message content, system prompts, tool arguments, any
 * credential. The lane's credential is the literal `public`, and it is still not
 * printed — a trace that leaks one secret teaches people to leave tracing on.
 *
 * @module src/debug.js
 */
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR_NAME, resolveDshHome } from './store.js'

const ENV_VAR = 'OUR_FREE_MODEL_DEBUG'
const FLAG_NAME = 'debug'

/** On when the environment variable is `1`, or the flag file exists. */
export function debugEnabled() {
  if (process.env[ENV_VAR] === '1') return true
  try {
    return fs.existsSync(path.join(resolveDshHome(), DATA_DIR_NAME, FLAG_NAME))
  } catch {
    return false
  }
}

/**
 * Write one trace line to stderr.
 *
 * Never throws: a diagnostic that can fail a real turn is worse than no
 * diagnostic at all.
 *
 * @param {string} event - short verb, e.g. `POST`, `RES`, `ERR`
 * @param {object} detail - JSON-serialisable facts, already free of content
 */
export function trace(event, detail) {
  if (!debugEnabled()) return
  try {
    console.error(`[our-free-model] ${new Date().toISOString()} ${event} ${JSON.stringify(detail)}`)
  } catch {
    /* diagnostics must never break a turn */
  }
}

function rolesOf(list) {
  if (!Array.isArray(list)) return undefined
  return list.map(item => (item && typeof item === 'object' ? String(item.role ?? item.type ?? '?') : '?'))
}

function toolNames(tools) {
  if (!Array.isArray(tools)) return undefined
  return tools.map(tool => {
    if (!tool || typeof tool !== 'object') return '?'
    if (typeof tool.name === 'string') return tool.name
    if (tool.function && typeof tool.function.name === 'string') return tool.function.name
    return '?'
  })
}

/**
 * The shape of a request body, with no content in it.
 *
 * Deliberately reports roles rather than text: "system + 1 user" identifies a
 * compaction or title request, which is exactly the case the tool fingerprint
 * has to fill in for, without printing a single word of the conversation.
 *
 * @param {object} body
 * @returns {object}
 */
export function describeBody(body) {
  if (!body || typeof body !== 'object') return {}
  const wire = body.input !== undefined ? 'responses' : Array.isArray(body.messages) ? 'chat' : '?'
  const out = {
    wire,
    model: body.model,
    stream: body.stream,
    roles: rolesOf(wire === 'responses' ? body.input : body.messages),
    tools: toolNames(body.tools),
    toolChoice: body.tool_choice,
    maxTokens: body.max_tokens ?? body.max_output_tokens,
    reasoningEffort: body.reasoning_effort ?? body.reasoning?.effort,
    budgetTokens: body.max_output_tokens !== undefined && body.max_tokens === undefined ? body.max_output_tokens : undefined,
  }
  // A tool-less request is the one the anonymous gate refuses outright, so the
  // absence is the interesting part and must survive serialisation.
  if (body.tools === undefined) out.tools = '(none declared)'
  return Object.fromEntries(Object.entries(out).filter(([, value]) => value !== undefined))
}

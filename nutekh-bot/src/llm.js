
const BASE = process.env.LLM_BASE_URL || 'https://api.imole.app/v1'
const KEY = process.env.LLM_API_KEY || ''
const CHAT_MODEL = process.env.CHAT_MODEL || 'gpt-5.6-luna'

const FALLBACK_MODELS = (process.env.LLM_FALLBACK_MODELS || '')
  .split(',').map((s) => s.trim()).filter((m) => m && m !== CHAT_MODEL)

const ENDPOINTS = [CHAT_MODEL, ...FALLBACK_MODELS].map((model) => ({ base: BASE, key: KEY, model }))
if (process.env.LLM_FALLBACK_KEY) {
  const fbBase = process.env.LLM_FALLBACK_BASE_URL || 'https://api.openai.com/v1'
  const fbKey = process.env.LLM_FALLBACK_KEY
  const fbModels = (process.env.LLM_FALLBACK_MODEL || 'gpt-6-luna').split(',').map((s) => s.trim()).filter(Boolean)
  for (const m of fbModels) ENDPOINTS.push({ base: fbBase, key: fbKey, model: m })
}

if (!KEY) console.warn('LLM: LLM_API_KEY is missing — set it in .env')

const MAX_CONCURRENT = Number(process.env.LLM_CONCURRENCY || 4)
let active = 0
const highWaiters = []
const lowWaiters = []
function acquire(priority = 'low') {
  return new Promise((res) => {
    if (active < MAX_CONCURRENT) { active++; res() }
    else (priority === 'high' ? highWaiters : lowWaiters).push(res)
  })
}
function release() {
  active--
  const w = highWaiters.shift() || lowWaiters.shift()
  if (w) { active++; w() }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const USE_RESPONSES = /imole\.app/i

async function callOnce(messages, max_tokens, ep) {
  const responses = USE_RESPONSES.test(ep.base)
  const url = ep.base + (responses ? '/responses' : '/chat/completions')

  const budget = responses ? max_tokens + 6000 : max_tokens

  const noThink = !responses && /gemini/i.test(ep.model) ? { thinking: false } : {}
  const body = responses
    ? { model: ep.model, input: messages, max_output_tokens: budget }
    : { model: ep.model, messages, max_tokens: budget, ...noThink }
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ep.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const raw = await res.text()
  if (res.status === 429 || res.status >= 500) { const e = new Error(`LLM ${res.status}: ${raw.slice(0, 160)}`); e.retryable = true; e.unavailable = true; throw e }
  let j = {}; try { j = JSON.parse(raw) } catch {}

  if (j && j.error) { const code = (typeof j.error === 'string' ? j.error : (j.error.code || j.error.message || '')).toString(); const e = new Error('LLM: ' + code.slice(0, 60)); e.unavailable = true; throw e }
  if (!res.ok) { const e = new Error(`LLM ${res.status}: ${raw.slice(0, 200)}`); e.unavailable = true; throw e }
  if (responses) {
    let txt = j.output_text
    if (!txt && Array.isArray(j.output)) txt = j.output.flatMap((o) => (Array.isArray(o.content) ? o.content : [])).map((c) => c.text || c.output_text || '').join('')
    return (txt || '').trim()
  }
  return j.choices?.[0]?.message?.content?.trim() || ''
}

const isNetErr = (e) => /fetch failed|network|ECONN|ETIMEDOUT|timeout/i.test(e?.message || '')

async function chat(messages, { max_tokens = 3000, priority = 'low' } = {}) {
  await acquire(priority)
  try {
    let lastErr
    for (const ep of ENDPOINTS) {
      try { return await callOnce(messages, max_tokens, ep) }
      catch (e) {
        lastErr = e
        if (isNetErr(e)) {
          await sleep(300)
          try { return await callOnce(messages, max_tokens, ep) } catch (e2) { lastErr = e2 }
        }
        continue
      }
    }
    throw lastErr
  } finally { release() }
}

const JSON_MIN_TOKENS = Number(process.env.LLM_JSON_MIN_TOKENS || 2400)

function extractJSON(raw) {
  const t = String(raw || '').replace(/```(?:json)?/gi, '')
  const i = t.indexOf('{')
  if (i < 0) return null
  let depth = 0
  let inStr = false
  let esc = false
  for (let j = i; j < t.length; j++) {
    const c = t[j]
    if (esc) { esc = false; continue }
    if (c === '\\') { esc = true; continue }
    if (c === '"') { inStr = !inStr; continue }
    if (inStr) continue
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) {
        try { return JSON.parse(t.slice(i, j + 1)) } catch { return null }
      }
    }
  }
  return null
}

async function chatJSON(messages, opts = {}) {
  const { max_tokens, priority = 'low', label = 'json', retry = true } = opts
  const budget = Math.max(Number(max_tokens) || 0, JSON_MIN_TOKENS)
  let raw
  try {
    raw = await chat(messages, { max_tokens: budget, priority })
  } catch (e) {
    console.log(`chatJSON[${label}]: LLM call failed — ${e && e.message}`)
    return null
  }
  let obj = extractJSON(raw)
  if (obj) return obj

  const txt = String(raw || '')
  const truncated = !/\}\s*$/.test(txt.trim())
  console.log(`chatJSON[${label}]: unreadable JSON (${truncated ? 'TRUNCATED' : 'malformed'}, ${txt.length} chars, budget ${budget}) — raw: ${JSON.stringify(txt.slice(0, 160))}`)
  if (!retry) return null
  try {
    raw = await chat(messages, { max_tokens: budget * 2, priority })
    obj = extractJSON(raw)
    if (obj) {
      console.log(`   ↳ chatJSON[${label}]: OK on second attempt (budget ${budget * 2})`)
      return obj
    }
    console.log(`   ↳ chatJSON[${label}]: second attempt unreadable too — giving up`)
  } catch (e) {
    console.log(`   ↳ chatJSON[${label}]: second attempt failed — ${e && e.message}`)
  }
  return null
}

module.exports = { chat, chatJSON, extractJSON, CHAT_MODEL, BASE, KEY }

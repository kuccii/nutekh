// Group signal detection: cheap pre-filter -> one batched LLM classification
// -> signals rows for the prospecting pipeline (Task 4 consumes them).

const { chatJSON } = require('./llm')
const { isBroadcast } = require('./addressing')
const db = require('./prospectdb')

const LINK_ONLY = /^https?:\/\/\S+$/

// Mirrors prospect.OWNED_CONFIDENCE_RELIEF: persist down to the loosest floor any
// group policy applies, so per-policy confidence gating in prospect.eligibility is
// real rather than vacuous.
const CONFIDENCE_RELIEF = 0.1

function envNumber(name, fallback) {
  const raw = process.env[name]
  if (raw == null || raw === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

// True only for a message that could plausibly contain a business need.
function preFilter(text, ctx = {}) {
  const { fromMe = false, isOwner = false, nTags = 0 } = ctx
  if (fromMe || isOwner) return false

  const t = String(text || '').trim()
  if (!t) return false
  if (LINK_ONLY.test(t)) return false

  const minChars = envNumber('SIGNAL_MIN_CHARS', 25)
  const letters = (t.match(/[a-z]/gi) || []).length
  if (letters < minChars) return false

  // Mass-tag / audience-greeting broadcasts are not one person's need.
  if (isBroadcast(t, nTags)) return false

  return true
}

const SYSTEM_PROMPT = `You screen WhatsApp group messages for Nutekh, a digital transformation agency that builds websites, booking systems, automations and tools.

For EACH numbered message decide whether it reveals a BUSINESS worth a Nutekh conversation. Set is_signal true when the message is a business advertising, promoting, selling or announcing its own products, services, offers, prices or launch — even when it asks for nothing. Also set is_signal true when the message describes a problem, request or growth goal Nutekh could serve. Set is_signal false for personal chatter, greetings, unrelated questions, news, job, recruitment or MLM ads, and forwarded or mass broadcasts.

Messages may be written in any language (English, Kinyarwanda, French, Swahili). Judge the meaning, not the language.

Reply with JSON only, no prose, exactly this shape:
{"results":[{"index":<n>,"is_signal":<bool>,"business":"","need":"","intent":"sales|support","confidence":0-1}]}

Rules:
- index must be the number of the message you are judging.
- business: the sender's business or sector, short ("" if unknown).
- need: the Nutekh service that best fits this business. Infer it from what they sell or do even when the post states no need (e.g. a bakery advertising -> "online ordering / website"; a salon -> "booking system"). Short, "" only if truly no fit.
- intent: "sales" for a business promoting itself or a growth opportunity, "support" for a problem or complaint to fix.
- confidence: 0-1, how sure you are that this is a real business worth a Nutekh conversation.`

// One batched classification call. Returns [] on null/malformed output.
async function classifyBatch(items) {
  const list = (Array.isArray(items) ? items : []).filter(
    (it) => it && it.index != null && typeof it.text === 'string' && it.text.trim()
  )
  if (!list.length) return []

  const known = new Set(list.map((it) => Number(it.index)))

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content:
        'Classify these messages:\n' +
        JSON.stringify(list.map((it) => ({ index: Number(it.index), text: it.text }))),
    },
  ]

  const out = await chatJSON(messages, { max_tokens: 2000, label: 'prospect-scan' })
  if (!out || !Array.isArray(out.results)) return []

  const results = []
  for (const r of out.results) {
    if (!r || typeof r !== 'object') continue

    if (r.index == null || r.index === '') continue
    const index = Number(r.index)
    if (!Number.isFinite(index) || !known.has(index)) continue

    if (typeof r.is_signal !== 'boolean') continue
    if (r.business != null && typeof r.business !== 'string') continue
    if (r.need != null && typeof r.need !== 'string') continue
    if (r.intent != null && typeof r.intent !== 'string') continue

    const confidence = Number(r.confidence)
    if (!Number.isFinite(confidence)) continue

    results.push({
      index,
      is_signal: r.is_signal,
      business: r.business || '',
      need: r.need || '',
      intent: r.intent || '',
      confidence,
    })
  }
  return results
}

// Read pending messages, classify the promising ones, persist qualifying signals.
async function scan({ limit = 200 } = {}) {
  const minConfidence = envNumber('OUTREACH_MIN_CONFIDENCE', 0.6)
  const writeFloor = Math.max(0, minConfidence - CONFIDENCE_RELIEF)

  const rows = db.pendingMessages(limit)
  if (!rows.length) return []

  const eligible = rows.filter((row) => preFilter(row.text))
  const scannedIds = rows.map((row) => row.id)

  if (!eligible.length) {
    db.markMessagesProcessed(scannedIds)
    return []
  }

  const items = eligible.map((row, index) => ({ index, text: row.text }))
  const results = await classifyBatch(items)
  const byIndex = new Map(results.map((r) => [r.index, r]))

  const written = []
  for (let i = 0; i < eligible.length; i++) {
    const r = byIndex.get(i)
    if (!r || !r.is_signal) continue
    if (!(r.confidence >= writeFloor)) continue

    const row = eligible[i]
    const id = db.addSignal({
      groupId: row.group_id,
      senderJid: row.sender_jid,
      msgId: row.msg_id,
      ts: row.ts,
      text: row.text,
      business: r.business,
      need: r.need,
      intent: r.intent,
      confidence: r.confidence,
    })
    // Record the inferred business on the member so /members can show a
    // business guess (spec §7). Guarded so a blank guess never erases one.
    if (r.business && r.business.trim()) db.setMemberBusiness(row.group_id, row.sender_jid, r.business)
    written.push({
      id,
      groupId: row.group_id,
      senderJid: row.sender_jid,
      msgId: row.msg_id,
      ts: row.ts,
      text: row.text,
      business: r.business,
      need: r.need,
      intent: r.intent,
      confidence: r.confidence,
    })
  }

  db.markMessagesProcessed(scannedIds)
  return written
}

module.exports = { preFilter, classifyBatch, scan }

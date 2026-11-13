const fs = require('fs')
const path = require('path')

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data')
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
const LEADS_FILE = path.join(DATA_DIR, 'leads.jsonl')

const RESEND_API_KEY = process.env.RESEND_API_KEY || ''
const RESEND_FROM = process.env.RESEND_FROM || 'Nutekh Assistant <info@nutekh.com>'
const RESEND_TO = (process.env.RESEND_TO || 'hello@nutekh.com')
  .split(',').map((s) => s.trim()).filter(Boolean)

const FIELDS = ['type', 'business', 'contact', 'need', 'location', 'budget', 'timeline', 'notes']

const DEDUPE_MS = Number(process.env.LEAD_DEDUPE_HOURS || 6) * 3600 * 1000
const DEDUPE_SCAN = Number(process.env.LEAD_DEDUPE_SCAN || 200)

function normalize(lead) {
  const out = {}
  for (const k of FIELDS) {
    const v = lead && lead[k]
    out[k] = (v == null ? '' : String(v)).trim().slice(0, 500)
  }
  out.type = /support/i.test(out.type) ? 'support' : 'sales'
  return out
}

function format(entry) {
  const title = entry.type === 'support' ? 'SUPPORT REQUEST' : 'NEW LEAD'
  const lines = [
    `*${title}*`,
    `Business: ${entry.business || 'unknown'}`,
    `Contact: ${entry.contact || entry.fromName || 'unknown'}`,
    `Need: ${entry.need || 'unknown'}`,
    `Location: ${entry.location || 'unknown'}`,
    `Budget: ${entry.budget || 'unknown'}`,
    `Timeline: ${entry.timeline || 'unknown'}`,
  ]
  if (entry.notes) lines.push(`Notes: ${entry.notes}`)
  lines.push(`Channel: ${entry.channel || 'dm'}`)
  if (entry.from) lines.push(`WhatsApp: ${entry.from}`)
  lines.push(`Time: ${entry.at}`)
  return lines.join('\n')
}

async function email(entry, text) {
  if (!RESEND_API_KEY || !RESEND_TO.length) return false
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: RESEND_TO,
        subject: `${entry.type === 'support' ? 'Nutekh support' : 'Nutekh lead'} — ${entry.business || entry.contact || 'WhatsApp'}`,
        text,
      }),
    })
    if (!res.ok) {
      console.log('leads: email failed', res.status, (await res.text()).slice(0, 160))
      return false
    }
    return true
  } catch (e) {
    console.log('leads: email error -', e.message)
    return false
  }
}

function identity(entry) {
  return [entry.from || entry.contact, entry.business, entry.need]
    .map((v) => String(v || '').trim().toLowerCase())
    .join('|')
}

/** The same contact asking the same thing again inside the window is one lead. */
function findDuplicate(entry, rows) {
  const id = identity(entry)
  if (id === '||') return null
  const now = Date.parse(entry.at) || Date.now()
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]
    if (identity(r) !== id) continue
    const t = Date.parse(r.at)
    if (Number.isFinite(t) && now - t <= DEDUPE_MS) return r
  }
  return null
}

/**
 * Persist a qualified lead or support request and alert the owners.
 * Never throws: lead capture must not break the customer conversation.
 */
async function recordLead(lead, ctx = {}) {
  try {
    const entry = {
      at: new Date().toISOString(),
      ...normalize(lead),
      from: ctx.jid || '',
      fromName: ctx.name || '',
      channel: ctx.channel || 'dm',
      source: ctx.source || (lead && lead.source) || 'marker',
    }
    if (Array.isArray(ctx.transcript) && ctx.transcript.length) {
      entry.transcript = ctx.transcript.slice(-6).map((h) => ({
        role: h.role,
        text: String(h.text || '').slice(0, 400),
      }))
    }

    const duplicate = findDuplicate(entry, recent(DEDUPE_SCAN))
    if (duplicate) {
      console.log(`leads: duplicate ${entry.type} from ${entry.from || entry.contact || 'unknown'} — already recorded ${duplicate.at}`)
      return { ...duplicate, deduped: true }
    }

    fs.appendFileSync(LEADS_FILE, JSON.stringify(entry) + '\n')

    const text = format(entry)
    if (typeof ctx.sendOwner === 'function') {
      try { await ctx.sendOwner(text) } catch (e) { console.log('leads: owner alert failed -', e.message) }
    }
    if (RESEND_API_KEY) await email(entry, text)
    console.log(`leads: recorded ${entry.type} from ${entry.from || entry.contact || 'unknown'}`)
    return entry
  } catch (e) {
    console.log('leads: could not record -', e.message)
    return null
  }
}

function recent(limit = 20) {
  try {
    const lines = fs.readFileSync(LEADS_FILE, 'utf8').split('\n').filter(Boolean)
    return lines.slice(-limit).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  } catch { return [] }
}

module.exports = { recordLead, normalize, format, recent, findDuplicate, LEADS_FILE }

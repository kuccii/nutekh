const test = require('node:test')
const assert = require('node:assert/strict')
const { tmpDataDir } = require('./helpers')

process.env.DATA_DIR = tmpDataDir()
process.env.LLM_API_KEY = 'test'
process.env.EMBED_URL = 'http://127.0.0.1:1'

const { parseMarkers, shouldExtract, normalizeLeadCandidate, extractLead, ensureLanguage } = require('../src/brain')

test('parses a lead marker and strips it from the reply', () => {
  const raw = 'Grow starts at RWF 4M. Shall I book the free audit?\n[[LEAD: {"type":"sales","business":"Shop","need":"POS","budget":"4-12M"}]]'
  const out = parseMarkers(raw)
  assert.equal(out.skipped, false)
  assert.equal(out.text, 'Grow starts at RWF 4M. Shall I book the free audit?')
  assert.equal(out.lead.type, 'sales')
  assert.equal(out.lead.business, 'Shop')
  assert.equal(out.lead.budget, '4-12M')
})

test('keeps a reply intact when the lead JSON is malformed', () => {
  const raw = 'Sure, happy to help. [[LEAD: {oops}]]'
  const out = parseMarkers(raw)
  assert.equal(out.lead, null)
  assert.equal(out.text, 'Sure, happy to help.')
})

test('detects the group silence marker', () => {
  const out = parseMarkers('[[SKIP]]')
  assert.equal(out.skipped, true)
  assert.equal(out.text, '')
})

test('ignores an unknown marker without losing the answer', () => {
  const out = parseMarkers('Yes, we do. [[MOOD: happy]]')
  assert.equal(out.text, 'Yes, we do.')
  assert.equal(out.lead, null)
})

test('parses a document marker', () => {
  const out = parseMarkers('Sending the guide now. [[DOC: pricing-guide]]')
  assert.equal(out.doc, 'pricing-guide')
  assert.equal(out.text, 'Sending the guide now.')
})

test('empty input is safe', () => {
  const out = parseMarkers('')
  assert.equal(out.text, '')
  assert.equal(out.lead, null)
  assert.equal(out.skipped, false)
})

const DETAILED = 'I run a hardware shop in Kigali with 12 staff and we want to fix our stock and payments this quarter.'

test('shouldExtract skips a short one-off question', () => {
  assert.equal(shouldExtract('How much is Grow?', []), false)
})

test('shouldExtract runs on a detailed enquiry', () => {
  assert.equal(shouldExtract(DETAILED, []), true)
})

test('shouldExtract runs once the customer has replied twice', () => {
  assert.equal(shouldExtract('yes please', [{ role: 'user', text: 'hi there' }]), true)
})

test('shouldExtract ignores an empty message', () => {
  assert.equal(shouldExtract('', []), false)
})

test('normalizeLeadCandidate rejects a lead with fewer than three known fields', () => {
  assert.equal(normalizeLeadCandidate({ business: 'Shop', need: 'POS' }), null)
})

test('normalizeLeadCandidate keeps a qualified lead and coerces the type', () => {
  const out = normalizeLeadCandidate({
    type: 'Sales',
    business: 'Shop',
    need: 'POS',
    budget: 'RWF 5M',
    location: 'unknown',
  })
  assert.equal(out.type, 'sales')
  assert.equal(out.business, 'Shop')
  assert.equal(out.location, '')
})

test('normalizeLeadCandidate treats unknown placeholders as missing', () => {
  assert.equal(
    normalizeLeadCandidate({ business: 'unknown', need: 'n/a', budget: '-', timeline: 'unknown' }),
    null
  )
})

test('normalizeLeadCandidate is null-safe', () => {
  assert.equal(normalizeLeadCandidate(null), null)
})

test('extractLead does nothing when the message is not worth extracting', async () => {
  let called = false
  const out = await extractLead('Hi', [], {
    json: async () => { called = true; return { business: 'x', need: 'y', budget: 'z' } },
  })
  assert.equal(out, null)
  assert.equal(called, false)
})

test('extractLead recovers a lead the model forgot to mark', async () => {
  const out = await extractLead(DETAILED, [], {
    json: async () => ({
      type: 'sales',
      business: 'hardware shop',
      need: 'stock and POS',
      budget: 'RWF 5M',
      location: 'Kigali',
    }),
  })
  assert.equal(out.business, 'hardware shop')
  assert.equal(out.location, 'Kigali')
})

test('extractLead returns null when the extractor finds nothing usable', async () => {
  const out = await extractLead(DETAILED, [], { json: async () => null })
  assert.equal(out, null)
})

test('extractLead returns null when the extractor throws', async () => {
  const out = await extractLead(DETAILED, [], {
    json: async () => { throw new Error('offline') },
  })
  assert.equal(out, null)
})

const SW_REPLY = 'Habari, bei ya Grow ni ngapi? Asante sana kwa swali lako zuri.'

test('ensureLanguage rewrites a Swahili reply to an English message', async () => {
  let used = null
  const out = await ensureLanguage(SW_REPLY, 'How much is Grow?', {
    chat: async (messages) => { used = messages; return 'Grow starts at RWF 2M. Shall I book the free audit?' },
  })
  assert.match(out, /Grow starts at RWF 2M/)
  assert.match(used[0].content, /English/)
})

test('ensureLanguage leaves a Kinyarwanda reply to a Kinyarwanda message alone', async () => {
  const rw = 'Muraho, igiciro cya Grow ni RWF 2M. Nshaka kubaza byinshi ku bijyanye na serivisi.'
  let called = false
  const out = await ensureLanguage(rw, 'Muraho, igiciro cya Grow ni angahe?', {
    chat: async () => { called = true; return 'x' },
  })
  assert.equal(out, rw)
  assert.equal(called, false)
})

test('ensureLanguage keeps the original reply when the repair call fails', async () => {
  const out = await ensureLanguage(SW_REPLY, 'How much is Grow?', {
    chat: async () => { throw new Error('offline') },
  })
  assert.equal(out, SW_REPLY)
})

test('ensureLanguage is a no-op when the guard is disabled', async () => {
  let called = false
  const out = await ensureLanguage(SW_REPLY, 'How much is Grow?', {
    langGuard: false,
    chat: async () => { called = true; return 'x' },
  })
  assert.equal(out, SW_REPLY)
  assert.equal(called, false)
})

test('ensureLanguage leaves a correct reply alone for a short ambiguous message', async () => {
  const fr = 'Le pack Grow coûte RWF 2M. Voulez-vous réserver un audit gratuit avec notre équipe ?'
  let called = false
  const out = await ensureLanguage(fr, 'Combien?', {
    chat: async () => { called = true; return 'x' },
  })
  assert.equal(out, fr)
  assert.equal(called, false)
})

test('ensureLanguage repairs a Swahili reply to a short English message', async () => {
  const sw = 'Habari, bei ya Grow ni ngapi? Asante sana kwa swali lako zuri.'
  let used = null
  const out = await ensureLanguage(sw, 'How much is Grow?', {
    chat: async (messages) => { used = messages; return 'Grow starts at RWF 2M. Shall I book the free audit?' },
  })
  assert.match(out, /Grow starts at RWF 2M/)
  assert.match(used[0].content, /English/)
})

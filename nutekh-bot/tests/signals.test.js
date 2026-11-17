// tests/signals.test.js
const test = require('node:test')
const assert = require('node:assert/strict')
const { tmpDataDir } = require('./helpers')
process.env.DATA_DIR = tmpDataDir()
process.env.LLM_API_KEY = 'test'
process.env.OUTREACH_MIN_CONFIDENCE = '0.6'

const llmPath = require.resolve('../src/llm')
let jsonReply = null
let jsonCalls = []
require.cache[llmPath] = {
  id: llmPath, filename: llmPath, loaded: true,
  exports: { chat: async () => '', chatJSON: async (messages) => { jsonCalls.push(messages); return jsonReply }, CHAT_MODEL: 'stub', BASE: 'stub', KEY: 'test' },
}

const signals = require('../src/signals')
const db = require('../src/prospectdb')

test('preFilter rejects short, link-only, broadcast and fromMe', () => {
  assert.equal(signals.preFilter('ok thanks'), false)
  assert.equal(signals.preFilter('https://example.com/abc'), false)
  assert.equal(signals.preFilter('good morning everyone, big news today for the whole team'), false)
  assert.equal(signals.preFilter('We need a booking site for our safaris urgently', { fromMe: true }), false)
})

test('preFilter accepts a real business post', () => {
  assert.equal(signals.preFilter('We are launching a Serengeti promo and need a landing page with booking'), true)
})

test('classifyBatch drops malformed output', async () => {
  jsonReply = null
  assert.deepEqual(await signals.classifyBatch([{ index: 0, text: 'x' }]), [])
  jsonReply = { results: [{ index: 0, is_signal: true, business: 'tour', need: 'site', intent: 'sales', confidence: 0.8 }] }
  const out = await signals.classifyBatch([{ index: 0, text: 'x' }])
  assert.equal(out.length, 1)
  assert.equal(out[0].confidence, 0.8)
})

test('scan writes signals once and marks messages processed', async () => {
  db.upsertGroup({ groupId: 'g3@g.us', subject: 'Biz' })
  db.addMessage({ groupId: 'g3@g.us', senderJid: '250788000000@s.whatsapp.net', msgId: 's1', ts: Date.now(), text: 'We are launching a safari promo and need a booking website with payments' })
  jsonReply = { results: [{ index: 0, is_signal: true, business: 'tour operator', need: 'booking website', intent: 'sales', confidence: 0.9 }] }
  const first = await signals.scan()
  const second = await signals.scan()
  assert.equal(first.length, 1)
  assert.equal(second.length, 0, 'processed messages must not be re-classified')
})

test('scan persists signals down to the loosest policy confidence floor', async () => {
  process.env.OUTREACH_MIN_CONFIDENCE = '0.6'
  db.upsertGroup({ groupId: 'g3b@g.us', subject: 'Floor' })
  db.addMessage({ groupId: 'g3b@g.us', senderJid: '250788000001@s.whatsapp.net', msgId: 's2', ts: Date.now(), text: 'We are launching a safari promo and need a booking website with payments' })
  jsonReply = { results: [{ index: 0, is_signal: true, business: 'tour operator', need: 'booking website', intent: 'sales', confidence: 0.55 }] }
  const written = await signals.scan()
  assert.equal(written.length, 1, '0.55 must be persisted: it clears the loosest policy floor (0.5), not the external one (0.6)')
})

test('scan records the inferred business on the member for the roster', async () => {
  process.env.OUTREACH_MIN_CONFIDENCE = '0.6'
  db.upsertGroup({ groupId: 'g3c@g.us', subject: 'Roster' })
  db.upsertMember({ groupId: 'g3c@g.us', jid: '250788000002@s.whatsapp.net', phone: '250788000002', dmable: 1 })
  db.addMessage({ groupId: 'g3c@g.us', senderJid: '250788000002@s.whatsapp.net', msgId: 's3', ts: Date.now(), text: 'We are launching a safari promo and need a booking website with payments' })
  jsonReply = { results: [{ index: 0, is_signal: true, business: 'safari tours', need: 'booking website', intent: 'sales', confidence: 0.9 }] }
  await signals.scan()
  assert.equal(db.getMember('g3c@g.us', '250788000002@s.whatsapp.net').business_guess, 'safari tours')
})

test('preFilter default floor is 25 letters and rejects empty/whitespace', () => {
  process.env.SIGNAL_MIN_CHARS = ''
  assert.equal(signals.preFilter('abcdefghijklmnopqrstuvwx'), false) // 24 letters
  assert.equal(signals.preFilter('abcdefghijklmnopqrstuvwxy'), true) // 25 letters
  assert.equal(signals.preFilter(''), false)
  assert.equal(signals.preFilter('    '), false)
})

test('classifier prompt targets business promotion, infers the service, and is language-agnostic', async () => {
  jsonCalls = []
  jsonReply = { results: [] }
  await signals.classifyBatch([{ index: 0, text: 'x' }])
  const system = jsonCalls[0][0].content
  assert.match(system, /advertis|promot/i)
  assert.match(system, /infer/i)
  assert.match(system, /any language/i)
  assert.match(system, /job|recruitment/i)
  assert.match(system, /MLM/i)
})

test('classifyBatch keeps an inferred need with no explicit request', async () => {
  jsonReply = { results: [{ index: 0, is_signal: true, business: 'bakery', need: 'online ordering / website', intent: 'sales', confidence: 0.7 }] }
  const out = await signals.classifyBatch([{ index: 0, text: 'Fresh bread every morning in Kigali, order on 0788' }])
  assert.equal(out.length, 1)
  assert.equal(out[0].is_signal, true)
  assert.equal(out[0].need, 'online ordering / website')

  // An empty need or business must not drop the signal (both are optional).
  jsonReply = { results: [{ index: 0, is_signal: true, business: '', need: '', intent: 'sales', confidence: 0.7 }] }
  const blank = await signals.classifyBatch([{ index: 0, text: 'x' }])
  assert.equal(blank.length, 1)
  assert.equal(blank[0].need, '')
  assert.equal(blank[0].business, '')
})

test('scan persists a promotion signal with an inferred need', async () => {
  process.env.OUTREACH_MIN_CONFIDENCE = '0.6'
  db.upsertGroup({ groupId: 'g3d@g.us', subject: 'Promo' })
  db.addMessage({ groupId: 'g3d@g.us', senderJid: '250788000003@s.whatsapp.net', msgId: 's4', ts: Date.now(), text: 'Fresh bread every morning in Kigali, order on 0788 000 003' })
  jsonReply = { results: [{ index: 0, is_signal: true, business: 'bakery', need: 'online ordering / website', intent: 'sales', confidence: 0.8 }] }
  const written = await signals.scan()
  assert.equal(written.length, 1)
  assert.equal(written[0].need, 'online ordering / website')
})

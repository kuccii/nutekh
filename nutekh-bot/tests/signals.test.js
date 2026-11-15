// tests/signals.test.js
const test = require('node:test')
const assert = require('node:assert/strict')
const { tmpDataDir } = require('./helpers')
process.env.DATA_DIR = tmpDataDir()
process.env.LLM_API_KEY = 'test'
process.env.OUTREACH_MIN_CONFIDENCE = '0.6'

const llmPath = require.resolve('../src/llm')
let jsonReply = null
require.cache[llmPath] = {
  id: llmPath, filename: llmPath, loaded: true,
  exports: { chat: async () => '', chatJSON: async () => jsonReply, CHAT_MODEL: 'stub', BASE: 'stub', KEY: 'test' },
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

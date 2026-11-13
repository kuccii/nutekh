const test = require('node:test')
const assert = require('node:assert/strict')
const { tmpDataDir } = require('./helpers')

process.env.DATA_DIR = tmpDataDir()
process.env.LLM_API_KEY = 'test'
process.env.EMBED_URL = 'http://127.0.0.1:1'

// Stub the LLM module before the brain loads it, so the wiring can be tested
// without network calls. node --test runs each file in its own process, so this
// cache entry does not leak into the other suites.
const llmPath = require.resolve('../src/llm')
let chatReply = ''
let jsonReply = null
let jsonCalls = 0
require.cache[llmPath] = {
  id: llmPath,
  filename: llmPath,
  loaded: true,
  exports: {
    chat: async () => chatReply,
    chatJSON: async () => { jsonCalls++; return jsonReply },
    CHAT_MODEL: 'stub',
    BASE: 'stub',
    KEY: 'test',
  },
}

const { answerDM } = require('../src/brain')

const DETAILED = 'I run a hardware shop in Kigali and we use Excel plus a POS we do not trust. Budget is around TZS 5 million.'

test('answerDM trusts a lead marker when the model emits one', async () => {
  chatReply = 'Grow fits your budget. Shall I book the audit?\n[[LEAD: {"type":"sales","business":"Hardware shop","need":"POS","budget":"TZS 5M"}]]'
  jsonReply = null
  jsonCalls = 0

  const res = await answerDM(DETAILED, [], '')
  assert.equal(res.leadSource, 'marker')
  assert.equal(res.lead.business, 'Hardware shop')
  assert.equal(jsonCalls, 0, 'the fallback must not run when a marker is present')
})

test('answerDM recovers a lead when the model forgets the marker', async () => {
  chatReply = 'Grow fits your budget. Shall I book the free 30-minute audit?'
  jsonReply = { type: 'sales', business: 'Hardware shop', need: 'POS and stock', budget: 'TZS 5M', location: 'Kigali' }
  jsonCalls = 0

  const res = await answerDM(DETAILED, [], '')
  assert.equal(res.leadSource, 'fallback')
  assert.equal(res.lead.location, 'Kigali')
  assert.equal(jsonCalls, 1)
})

test('answerDM leaves a short question alone', async () => {
  chatReply = 'Grow starts at TZS 4M.'
  jsonReply = { business: 'x', need: 'y', budget: 'z' }
  jsonCalls = 0

  const res = await answerDM('How much is Grow?', [], '')
  assert.equal(res.lead, null)
  assert.equal(res.leadSource, null)
  assert.equal(jsonCalls, 0, 'short questions must not trigger a second LLM pass')
})

const test = require('node:test')
const assert = require('node:assert/strict')
const { tmpDataDir } = require('./helpers')

process.env.DATA_DIR = tmpDataDir()
process.env.LLM_API_KEY = 'test'
process.env.EMBED_URL = 'http://127.0.0.1:1'

const { parseMarkers } = require('../src/brain')

test('parses a lead marker and strips it from the reply', () => {
  const raw = 'Grow starts at TZS 4M. Shall I book the free audit?\n[[LEAD: {"type":"sales","business":"Shop","need":"POS","budget":"4-12M"}]]'
  const out = parseMarkers(raw)
  assert.equal(out.skipped, false)
  assert.equal(out.text, 'Grow starts at TZS 4M. Shall I book the free audit?')
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

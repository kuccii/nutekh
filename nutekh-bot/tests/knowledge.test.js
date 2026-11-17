const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { tmpDataDir } = require('./helpers')

process.env.DATA_DIR = tmpDataDir()

const knowledge = require('../src/knowledge')

test('seeds every published FAQ fact once', () => {
  const rows = knowledge.faq()
  assert.ok(rows.length >= 30)
  const first = knowledge.ensureSeeded()
  assert.equal(first.added, rows.length)
  assert.equal(first.total, rows.length)
})

test('seeding is idempotent', () => {
  const second = knowledge.ensureSeeded()
  assert.equal(second.added, 0)
  assert.equal(second.skipped, second.total)
})

test('seeded rows are pending embeddings until vectors are stored', () => {
  const pending = knowledge.pendingEmbeddings(1000)
  assert.equal(pending.length, knowledge.faq().length)
  assert.ok(pending.every((r) => /^Q: .+ A: /s.test(r.text)))
})

test('brief carries the published price ranges in RWF', () => {
  const brief = knowledge.brief()
  assert.ok(brief.length > 1000)
  assert.match(brief, /RWF 700K – 1\.8M/)
  assert.match(brief, /RWF 2M – 6M/)
  assert.match(brief, /from RWF 8M/)
  assert.match(brief, /Kigali, Rwanda/)
  assert.match(brief, /hello@nutekh\.com/)
  assert.match(brief, /Central Africa Time/)
})

test('faq ids are unique', () => {
  const ids = knowledge.faq().map((f) => f.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('faq file is valid json on disk', () => {
  const raw = fs.readFileSync(path.join(__dirname, '..', 'knowledge', 'faq.json'), 'utf8')
  assert.doesNotThrow(() => JSON.parse(raw))
})

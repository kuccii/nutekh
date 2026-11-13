const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const { tmpDataDir } = require('./helpers')

process.env.DATA_DIR = tmpDataDir()

const leads = require('../src/leads')

test('normalizes a sales lead', () => {
  const out = leads.normalize({
    type: 'Sales',
    business: '  Mlimani Shop ',
    contact: '+255 700 000 000',
    need: 'stock and mobile money',
    budget: 'TZS 4M',
    timeline: 'this month',
    location: 'Dar es Salaam',
  })
  assert.equal(out.type, 'sales')
  assert.equal(out.business, 'Mlimani Shop')
  assert.equal(out.contact, '+255 700 000 000')
  assert.equal(out.location, 'Dar es Salaam')
})

test('marks support cases and fills missing fields with empty strings', () => {
  const out = leads.normalize({ type: 'support', business: 'Hotel A' })
  assert.equal(out.type, 'support')
  assert.equal(out.need, '')
  assert.equal(out.budget, '')
  assert.equal(out.notes, '')
})

test('caps overlong field values', () => {
  const out = leads.normalize({ type: 'sales', notes: 'x'.repeat(900) })
  assert.equal(out.notes.length, 500)
})

test('formats a readable owner alert', () => {
  const text = leads.format({
    type: 'sales',
    business: 'Mlimani Shop',
    contact: '+255 700 000 000',
    need: 'stock control',
    location: 'Dar es Salaam',
    budget: 'TZS 4M',
    timeline: 'this month',
    channel: 'dm',
    from: '255700000000@s.whatsapp.net',
    at: '2026-11-12T10:00:00.000Z',
  })
  assert.match(text, /NEW LEAD/)
  assert.match(text, /Mlimani Shop/)
  assert.match(text, /TZS 4M/)
  assert.match(text, /Channel: dm/)
})

test('records a lead to JSONL even when the owner alert fails', async () => {
  const entry = await leads.recordLead(
    { type: 'sales', business: 'Test Co', need: 'website', budget: '1.2M' },
    {
      jid: '255700000000@s.whatsapp.net',
      name: 'Test Customer',
      channel: 'dm',
      sendOwner: async () => { throw new Error('offline') },
    }
  )
  assert.ok(entry)
  assert.equal(entry.business, 'Test Co')

  const lines = fs.readFileSync(leads.LEADS_FILE, 'utf8').trim().split('\n')
  const saved = JSON.parse(lines[lines.length - 1])
  assert.equal(saved.business, 'Test Co')
  assert.equal(saved.channel, 'dm')
  assert.equal(saved.fromName, 'Test Customer')
})

test('recent() returns recorded leads', () => {
  const rows = leads.recent(5)
  assert.ok(rows.length >= 1)
  assert.equal(rows[rows.length - 1].business, 'Test Co')
})

test('recordLead never throws on bad input', async () => {
  const entry = await leads.recordLead(null, {})
  assert.ok(entry)
  assert.equal(entry.type, 'sales')
})

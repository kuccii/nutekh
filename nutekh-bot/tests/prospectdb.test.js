// tests/prospectdb.test.js
const test = require('node:test')
const assert = require('node:assert/strict')
const { tmpDataDir } = require('./helpers')
process.env.DATA_DIR = tmpDataDir()

const db = require('../src/prospectdb')

test('upsertGroup defaults to external + enabled, and is idempotent', () => {
  db.upsertGroup({ groupId: 'g1@g.us', subject: 'Tour Ops' })
  db.upsertGroup({ groupId: 'g1@g.us', subject: 'Tour Ops TZ' })
  const g = db.getGroup('g1@g.us')
  assert.equal(g.policy, 'external')
  assert.equal(g.enabled, 1)
  assert.equal(g.subject, 'Tour Ops TZ')
  assert.equal(db.listGroups().length, 1)
})

test('addMessage ignores a duplicate msg_id', () => {
  const a = db.addMessage({ groupId: 'g1@g.us', senderJid: 'x@s.whatsapp.net', msgId: 'm1', ts: Date.now(), text: 'hello there' })
  const b = db.addMessage({ groupId: 'g1@g.us', senderJid: 'x@s.whatsapp.net', msgId: 'm1', ts: Date.now(), text: 'hello there' })
  assert.equal(a, true)
  assert.equal(b, false)
  assert.equal(db.pendingMessages().filter((r) => r.msg_id === 'm1').length, 1)
})

test('hasPendingCandidate and countOutreachSince behave', () => {
  const cid = db.createCandidate({ groupId: 'g1@g.us', senderJid: 'x@s.whatsapp.net', business: 'tour', intent: 'sales', signalIds: '1', draft: 'hi' })
  assert.equal(db.hasPendingCandidate('g1@g.us', 'x@s.whatsapp.net'), true)
  db.updateCandidate(cid, { status: 'sent', sentAt: Date.now() })
  assert.equal(db.hasPendingCandidate('g1@g.us', 'x@s.whatsapp.net'), false)
  db.addOutreach({ candidateId: cid, senderJid: 'x@s.whatsapp.net', text: 'hi' })
  assert.equal(db.countOutreachSince(Date.now() - 1000), 1)
})

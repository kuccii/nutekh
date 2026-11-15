// tests/roster.test.js
const test = require('node:test')
const assert = require('node:assert/strict')
const { tmpDataDir } = require('./helpers')
process.env.DATA_DIR = tmpDataDir()

const roster = require('../src/roster')
const db = require('../src/prospectdb')

test('participantToMember resolves a phone JID as dmable', () => {
  const m = roster.participantToMember({ id: '250788000000@s.whatsapp.net', notify: 'Eric' })
  assert.equal(m.phone, '250788000000')
  assert.equal(m.dmable, 1)
  assert.equal(m.pushName, 'Eric')
})

test('participantToMember marks an @lid-only member not dmable', () => {
  const m = roster.participantToMember({ id: '12345@lid', notify: 'Juma' })
  assert.equal(m.dmable, 0)
  assert.equal(m.phone, '')
  assert.equal(m.lid, '12345@lid')
})

test('enrollGroup upserts the group and members idempotently', () => {
  const group = {
    id: 'g2@g.us', subject: 'Biz',
    participants: [
      { id: '250788000000@s.whatsapp.net', notify: 'Eric' },
      { id: '999@lid', notify: 'Juma' },
    ],
  }
  const s1 = roster.enrollGroup(group)
  const s2 = roster.enrollGroup(group)
  assert.equal(s1.members, 2)
  assert.equal(s1.dmable, 1)
  assert.equal(s2.members, 2, 're-enroll must not duplicate members')
  assert.equal(db.getGroup('g2@g.us').policy, 'external')
})

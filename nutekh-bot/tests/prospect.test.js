// tests/prospect.test.js
const test = require('node:test')
const assert = require('node:assert/strict')
const { tmpDataDir } = require('./helpers')
process.env.DATA_DIR = tmpDataDir()
process.env.LLM_API_KEY = 'test'

const llmPath = require.resolve('../src/llm')
let chatReply = 'Hi Juma — Nutekh here. Saw your safari promo...'
let chatCalls = []
require.cache[llmPath] = {
  id: llmPath, filename: llmPath, loaded: true,
  exports: {
    chat: async (messages) => { chatCalls.push(messages); return chatReply },
    chatJSON: async () => null,
    CHAT_MODEL: 'stub', BASE: 'stub', KEY: 'test',
  },
}

const prospect = require('../src/prospect')
const db = require('../src/prospectdb')

const DAY = 86400000
const signal = { group_id: 'g4@g.us', sender_jid: '250788000000@s.whatsapp.net', msg_id: 'p1', text: 'safari promo, need booking site', business: 'tour', intent: 'sales', confidence: 0.9 }
const member = { group_id: 'g4@g.us', jid: '250788000000@s.whatsapp.net', dmable: 1, status: 'member' }
const base = { now: 1_000_000_000_000, groupEnabled: true, dailyCap: 5, cooldownDays: 30, sentToday: 0, lastContactedAt: null, hasPending: false, minConfidence: 0.6 }

function handledFlag(id) {
  return db.db.prepare('SELECT handled FROM signals WHERE id = ?').get(id).handled
}

// The brief's `db.addSignal({ ...signal, ts })` spreads a snake_case fixture,
// but prospectdb.addSignal reads camelCase ({ groupId, senderJid, msgId, ... }).
// Spreading would insert NULL group_id/sender_jid and the row could never match
// a member, so the keys are mapped explicitly here.
function insertSignal(sig, { msgId, confidence } = {}) {
  return db.addSignal({
    groupId: sig.group_id,
    senderJid: sig.sender_jid,
    msgId: msgId || sig.msg_id,
    ts: Date.now(),
    text: sig.text,
    business: sig.business,
    intent: sig.intent,
    confidence: confidence == null ? sig.confidence : confidence,
  })
}

test('eligibility blocks the first failing check', () => {
  assert.equal(prospect.eligibility(signal, { ...member, dmable: 0 }, base).reason, 'not-dmable')
  assert.equal(prospect.eligibility({ ...signal, confidence: 0.1 }, member, base).reason, 'low-confidence')
  assert.equal(prospect.eligibility(signal, member, { ...base, groupEnabled: false }).reason, 'disabled')
  assert.equal(prospect.eligibility(signal, member, { ...base, sentToday: 5 }).reason, 'cap')
  assert.equal(prospect.eligibility(signal, member, { ...base, hasPending: true }).reason, 'pending')
})

// The brief's second timestamp (`base.now - 30 * DAY + 3600_000`) sits *inside*
// the 30-day cooldown window, so it contradicts the first assertion under any
// spec-correct (recent-contact-blocks) reading of the cooldown. Per spec §6 and
// the plan's Review Focus ("just outside -> allowed") the timestamp is one hour
// *beyond* the window: elapsed > cooldownDays means allowed.
test('cooldown boundary: exactly N days blocked, just outside allowed', () => {
  const exactly = base.now - 30 * DAY
  assert.equal(prospect.eligibility(signal, member, { ...base, lastContactedAt: exactly }).reason, 'cooldown')
  assert.equal(prospect.eligibility(signal, member, { ...base, lastContactedAt: base.now - 30 * DAY - 3600_000 }).ok, true)
})

// R3: owned groups get a looser cap and a lower confidence floor; every other
// policy (external included) is unchanged.
test('thresholdsFor loosens the owned cap and confidence floor only', () => {
  assert.deepEqual(prospect.thresholdsFor('owned', { dailyCap: 5, minConfidence: 0.6 }), { dailyCap: 10, minConfidence: 0.5 })
  assert.deepEqual(prospect.thresholdsFor('external', { dailyCap: 5, minConfidence: 0.6 }), { dailyCap: 5, minConfidence: 0.6 })
})

// R4: the draft is grounded in the published facts, and an empty model reply
// yields '' rather than a candidate.
test('draft is grounded in the published brief and returns empty on an empty reply', async () => {
  chatCalls = []
  chatReply = 'Hi Juma — Nutekh here.'
  const out = await prospect.draft(signal, member)
  assert.equal(out, 'Hi Juma — Nutekh here.')
  const joined = chatCalls[0].map((m) => m.content).join('\n')
  const briefSlice = require('../src/knowledge').brief().trim().slice(0, 40)
  assert.ok(briefSlice.length >= 20)
  assert.ok(joined.includes(briefSlice), 'the draft prompt must carry the published brief')
  chatReply = ''
  assert.equal(await prospect.draft(signal, member), '')
})

test('run creates one candidate, seeds status, and calls sendOwner once', async () => {
  chatReply = 'Hi Juma — Nutekh here. Saw your safari promo...'
  db.upsertGroup({ groupId: 'g4@g.us', subject: 'Tour Ops' })
  db.upsertMember({ groupId: 'g4@g.us', jid: '250788000000@s.whatsapp.net', phone: '250788000000', pushName: 'Juma', dmable: 1 })
  const sigId = insertSignal(signal)
  const cards = []
  const created = await prospect.run({ now: Date.now(), sendOwner: async (t) => cards.push(t) })
  assert.equal(created, 1)
  assert.equal(cards.length, 1)
  assert.match(cards[0], /PROSPECT #/)
  assert.match(cards[0], /group: Tour Ops · external/)
  assert.match(cards[0], /Member: Juma \(250788000000\)/)
  assert.equal(db.getMember('g4@g.us', '250788000000@s.whatsapp.net').status, 'drafted')
  assert.equal(handledFlag(sigId), 1, 'a drafted signal is handled')
})

// R2: permanent outcomes close the signal out; transient gates leave it open.
test('run marks permanently ineligible signals handled and leaves transient gates retryable', async () => {
  chatReply = 'draft text'

  db.upsertGroup({ groupId: 'g4c@g.us', subject: 'Low Confidence' })
  db.upsertMember({ groupId: 'g4c@g.us', jid: '250788000001@s.whatsapp.net', phone: '250788000001', pushName: 'Low', dmable: 1 })
  const low = insertSignal(
    { ...signal, group_id: 'g4c@g.us', sender_jid: '250788000001@s.whatsapp.net' },
    { msgId: 'r2a', confidence: 0.55 }
  )

  db.upsertGroup({ groupId: 'g4d@g.us', subject: 'Not Dmable' })
  db.upsertMember({ groupId: 'g4d@g.us', jid: '250788000002@s.whatsapp.net', phone: '', pushName: 'No', dmable: 0 })
  const nd = insertSignal(
    { ...signal, group_id: 'g4d@g.us', sender_jid: '250788000002@s.whatsapp.net' },
    { msgId: 'r2b', confidence: 0.9 }
  )

  db.upsertGroup({ groupId: 'g4e@g.us', subject: 'Cooled' })
  db.upsertMember({ groupId: 'g4e@g.us', jid: '250788000003@s.whatsapp.net', phone: '250788000003', pushName: 'Cool', dmable: 1 })
  db.markContacted('g4e@g.us', '250788000003@s.whatsapp.net', Date.now())
  const cool = insertSignal(
    { ...signal, group_id: 'g4e@g.us', sender_jid: '250788000003@s.whatsapp.net' },
    { msgId: 'r2c', confidence: 0.9 }
  )

  const cards = []
  const created = await prospect.run({ now: Date.now(), sendOwner: async (t) => cards.push(t) })
  assert.equal(created, 0)
  assert.equal(cards.length, 0)
  assert.equal(handledFlag(low), 1, 'low-confidence is permanent')
  assert.equal(handledFlag(nd), 1, 'not-dmable is permanent')
  assert.equal(handledFlag(cool), 0, 'cooldown is transient')
})

// R1: use a fresh group, member and signal so the empty-draft path (not a
// leftover pending candidate) is what returns 0.
test('run makes no candidate when the draft is empty', async () => {
  chatReply = ''
  db.upsertGroup({ groupId: 'g4b@g.us', subject: 'Empty Draft' })
  db.upsertMember({ groupId: 'g4b@g.us', jid: '250788000009@s.whatsapp.net', phone: '250788000009', pushName: 'Empty', dmable: 1 })
  const sigId = insertSignal(
    { ...signal, group_id: 'g4b@g.us', sender_jid: '250788000009@s.whatsapp.net' },
    { msgId: 'p2', confidence: 0.9 }
  )
  const cards = []
  const created = await prospect.run({ now: Date.now(), sendOwner: async (t) => cards.push(t) })
  assert.equal(created, 0)
  assert.equal(cards.length, 0)
  assert.equal(handledFlag(sigId), 1, 'an empty draft is permanent')
})

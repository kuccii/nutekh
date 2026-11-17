// tests/prospect.test.js
const test = require('node:test')
const assert = require('node:assert/strict')
const { tmpDataDir } = require('./helpers')
process.env.DATA_DIR = tmpDataDir()
process.env.LLM_API_KEY = 'test'

const llmPath = require.resolve('../src/llm')
let chatReply = 'Hi Juma — Nutekh here. Saw your safari promo...'
let chatThrows = false
let chatCalls = []
require.cache[llmPath] = {
  id: llmPath, filename: llmPath, loaded: true,
  exports: {
    chat: async (messages) => {
      chatCalls.push(messages)
      if (chatThrows) { chatThrows = false; throw new Error('transient LLM failure') }
      return chatReply
    },
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

// R18: a thrown draft call is transient — the signal stays retryable.
test('run leaves the signal unhandled when the draft call throws', async () => {
  chatReply = 'a draft that must never be used'
  chatThrows = true
  db.upsertGroup({ groupId: 'g4f@g.us', subject: 'Flaky LLM' })
  db.upsertMember({ groupId: 'g4f@g.us', jid: '250788000010@s.whatsapp.net', phone: '250788000010', pushName: 'Flaky', dmable: 1 })
  const sigId = insertSignal(
    { ...signal, group_id: 'g4f@g.us', sender_jid: '250788000010@s.whatsapp.net' },
    { msgId: 'r18a', confidence: 0.9 }
  )
  const cards = []
  const created = await prospect.run({ now: Date.now(), sendOwner: async (t) => cards.push(t) })
  assert.equal(created, 0)
  assert.equal(cards.length, 0, 'sendOwner must not be called for a failed draft')
  assert.equal(handledFlag(sigId), 0, 'a failed draft is transient: the signal stays retryable')
})

// R18: a genuinely empty reply is permanent — the signal is closed.
test('run closes the signal when the model returns an empty draft', async () => {
  chatThrows = false
  chatReply = ''
  db.upsertGroup({ groupId: 'g4g@g.us', subject: 'Empty Reply' })
  db.upsertMember({ groupId: 'g4g@g.us', jid: '250788000011@s.whatsapp.net', phone: '250788000011', pushName: 'Silent', dmable: 1 })
  const sigId = insertSignal(
    { ...signal, group_id: 'g4g@g.us', sender_jid: '250788000011@s.whatsapp.net' },
    { msgId: 'r18b', confidence: 0.9 }
  )
  const cards = []
  const created = await prospect.run({ now: Date.now(), sendOwner: async (t) => cards.push(t) })
  assert.equal(created, 0)
  assert.equal(cards.length, 0)
  assert.equal(handledFlag(sigId), 1, 'a genuinely empty draft is permanent')
})

test('the draft prompt pitches the business and offers the free audit', async () => {
  chatCalls = []
  chatReply = 'Hi — Nutekh here.'
  await prospect.draft(signal, member)
  const system = chatCalls[0][0].content
  assert.match(system, /promot|advertis|running a business/i)
  assert.match(system, /best fits their business/i)
  assert.match(system, /free 30-minute audit/i)
})

test('draft still forms when the signal carries no business name', async () => {
  chatCalls = []
  chatReply = 'Hi — Nutekh here.'
  const out = await prospect.draft({ ...signal, business: '' }, member)
  assert.equal(out, 'Hi — Nutekh here.')
})

test('run dedupes a repeat promotion from the same member to one pending candidate', async () => {
  chatReply = 'Hi — Nutekh here.'
  db.upsertGroup({ groupId: 'g4h@g.us', subject: 'Repeat' })
  db.upsertMember({ groupId: 'g4h@g.us', jid: '250788000012@s.whatsapp.net', phone: '250788000012', pushName: 'Repeat', dmable: 1 })
  const cards = []
  insertSignal({ ...signal, group_id: 'g4h@g.us', sender_jid: '250788000012@s.whatsapp.net' }, { msgId: 'r5a', confidence: 0.9 })
  const first = await prospect.run({ now: Date.now(), sendOwner: async (t) => cards.push(t) })
  insertSignal({ ...signal, group_id: 'g4h@g.us', sender_jid: '250788000012@s.whatsapp.net' }, { msgId: 'r5b', confidence: 0.9 })
  const second = await prospect.run({ now: Date.now(), sendOwner: async (t) => cards.push(t) })
  assert.equal(first, 1)
  assert.equal(second, 0, 'a member with a pending candidate is not drafted again')
  assert.equal(cards.length, 1)
})

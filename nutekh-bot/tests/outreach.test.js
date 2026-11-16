// tests/outreach.test.js
process.env.LLM_API_KEY = process.env.LLM_API_KEY || 'test' // silence llm.js's missing-key warning
const test = require('node:test')
const assert = require('node:assert/strict')
const { tmpDataDir } = require('./helpers')
process.env.DATA_DIR = tmpDataDir()

const outreach = require('../src/outreach')
const db = require('../src/prospectdb')

function fakeSock() { const sent = []; return { sent, sendMessage: async (jid, m) => { sent.push([jid, m.text]); return {} } } }

test('parseCommand recognises the prospect commands', () => {
  assert.deepEqual(outreach.parseCommand('/send 12'), { cmd: 'send', args: ['12'] })
  assert.deepEqual(outreach.parseCommand('/edit 12 hello there'), { cmd: 'edit', args: ['12', 'hello there'] })
  assert.deepEqual(outreach.parseCommand('/prospect off g1@g.us'), { cmd: 'prospect', args: ['off', 'g1@g.us'] })
  assert.equal(outreach.parseCommand('/ping'), null)
})

test('capCheck blocks at the cap', () => {
  assert.equal(outreach.capCheck({ sentToday: 5, dailyCap: 5 }).reason, 'cap')
  assert.equal(outreach.capCheck({ sentToday: 4, dailyCap: 5 }).ok, true)
})

test('/skip suppresses the member and closes the candidate', async () => {
  db.upsertGroup({ groupId: 'g5@g.us', subject: 'Biz' })
  db.upsertMember({ groupId: 'g5@g.us', jid: '250788000000@s.whatsapp.net', phone: '250788000000', dmable: 1 })
  const id = db.createCandidate({ groupId: 'g5@g.us', senderJid: '250788000000@s.whatsapp.net', business: 'tour', intent: 'sales', signalIds: '1', draft: 'hi' })
  const sock = fakeSock()
  const handled = await outreach.handleCommand(sock, '250782718957@s.whatsapp.net', `/skip ${id}`, { sendOwner: async () => {} })
  assert.equal(handled, true)
  assert.equal(db.getCandidate(id).status, 'skipped')
  assert.equal(db.getMember('g5@g.us', '250788000000@s.whatsapp.net').status, 'suppressed')
})

test('/send enforces the daily cap and does not message the member', async () => {
  process.env.OUTREACH_DAILY_CAP = '0'
  const id = db.createCandidate({ groupId: 'g5@g.us', senderJid: '250788000000@s.whatsapp.net', business: 'tour', intent: 'sales', signalIds: '2', draft: 'hello' })
  const sock = fakeSock()
  await outreach.handleCommand(sock, '250782718957@s.whatsapp.net', `/send ${id}`, { sendOwner: async () => {} })
  assert.equal(sock.sent.some(([jid]) => jid.startsWith('250788000000')), false)
})

// ---------------------------------------------------------------------------
// Focused coverage beyond the brief
// ---------------------------------------------------------------------------

const usermem = require('../src/usermem')
const OWNER = '250782718957@s.whatsapp.net'
const memberSent = (sock, prefix) => sock.sent.some(([jid]) => jid.startsWith(prefix))

test('/send delivers the draft, records the outreach and marks the member sent', async () => {
  process.env.OUTREACH_DAILY_CAP = '5'
  db.upsertGroup({ groupId: 'g6@g.us', subject: 'Tour Ops' })
  db.upsertMember({ groupId: 'g6@g.us', jid: '250788111111@s.whatsapp.net', phone: '250788111111', pushName: 'Juma', dmable: 1 })
  const id = db.createCandidate({ groupId: 'g6@g.us', senderJid: '250788111111@s.whatsapp.net', business: 'tour', intent: 'sales', signalIds: '9', draft: 'Hello Juma' })

  const before = db.countOutreachSince(0)
  const sock = fakeSock()
  const handled = await outreach.handleCommand(sock, OWNER, `/send ${id}`, { sendOwner: async () => {} })

  assert.equal(handled, true)
  assert.ok(
    sock.sent.some(([jid, text]) => jid === '250788111111@s.whatsapp.net' && text === 'Hello Juma'),
    'the draft must go to the member JID'
  )
  assert.equal(db.getCandidate(id).status, 'sent')
  assert.equal(db.getMember('g6@g.us', '250788111111@s.whatsapp.net').status, 'sent')
  assert.ok(db.getMember('g6@g.us', '250788111111@s.whatsapp.net').last_contacted > 0)
  assert.equal(db.countOutreachSince(0), before + 1)
  const hist = usermem.history('250788111111@s.whatsapp.net')
  assert.deepEqual(hist[hist.length - 1], { role: 'assistant', text: 'Hello Juma' })
})

test('/send refuses a candidate that is not pending', async () => {
  process.env.OUTREACH_DAILY_CAP = '5'
  db.upsertGroup({ groupId: 'g7@g.us', subject: 'Retail' })
  db.upsertMember({ groupId: 'g7@g.us', jid: '250788222222@s.whatsapp.net', phone: '250788222222', dmable: 1 })
  const id = db.createCandidate({ groupId: 'g7@g.us', senderJid: '250788222222@s.whatsapp.net', business: 'shop', intent: 'sales', signalIds: '10', draft: 'hi there' })
  db.updateCandidate(id, { status: 'sent' })

  const sock = fakeSock()
  const handled = await outreach.handleCommand(sock, OWNER, `/send ${id}`, {})

  assert.equal(handled, true)
  assert.equal(memberSent(sock, '250788222222'), false)
  assert.equal(sock.sent.length, 1, 'only the owner reply is sent')
})

test('/send refuses a member that is not reachable and leaves the candidate pending', async () => {
  process.env.OUTREACH_DAILY_CAP = '5'
  db.upsertGroup({ groupId: 'g9@g.us', subject: 'Logistics' })
  db.upsertMember({ groupId: 'g9@g.us', jid: '250788333333@s.whatsapp.net', phone: '', dmable: 0 })
  const id = db.createCandidate({ groupId: 'g9@g.us', senderJid: '250788333333@s.whatsapp.net', business: 'trucking', intent: 'sales', signalIds: '11', draft: 'yo' })

  const sock = fakeSock()
  const handled = await outreach.handleCommand(sock, OWNER, `/send ${id}`, {})

  assert.equal(handled, true)
  assert.equal(memberSent(sock, '250788333333'), false)
  assert.equal(db.getCandidate(id).status, 'pending')
})

test('/send with an unknown id is handled without sending', async () => {
  const sock = fakeSock()
  const handled = await outreach.handleCommand(sock, OWNER, '/send 999999', {})
  assert.equal(handled, true)
  assert.equal(sock.sent.length, 1)
})

test('/skip refuses an already-sent candidate and leaves the send record intact', async () => {
  db.upsertGroup({ groupId: 'g12@g.us', subject: 'Wholesale' })
  db.upsertMember({ groupId: 'g12@g.us', jid: '250788666666@s.whatsapp.net', phone: '250788666666', dmable: 1 })
  const id = db.createCandidate({ groupId: 'g12@g.us', senderJid: '250788666666@s.whatsapp.net', business: 'wholesale', intent: 'sales', signalIds: '14', draft: 'already out' })
  db.updateCandidate(id, { status: 'sent', sentAt: Date.now(), decided: Date.now() })
  db.setMemberStatus('g12@g.us', '250788666666@s.whatsapp.net', 'sent')

  const sock = fakeSock()
  const handled = await outreach.handleCommand(sock, OWNER, `/skip ${id}`, {})

  assert.equal(handled, true)
  assert.equal(sock.sent.length, 1, 'only the owner reply is sent')
  assert.match(sock.sent[0][1], /cannot be skipped/)
  assert.equal(db.getCandidate(id).status, 'sent')
  assert.equal(db.getMember('g12@g.us', '250788666666@s.whatsapp.net').status, 'sent')
})

test('/edit replaces the draft and sends the new text unsplit', async () => {
  process.env.OUTREACH_DAILY_CAP = '5'
  db.upsertGroup({ groupId: 'g10@g.us', subject: 'Hospitality' })
  db.upsertMember({ groupId: 'g10@g.us', jid: '250788444444@s.whatsapp.net', phone: '250788444444', dmable: 1 })
  const id = db.createCandidate({ groupId: 'g10@g.us', senderJid: '250788444444@s.whatsapp.net', business: 'hotel', intent: 'sales', signalIds: '12', draft: 'old draft' })

  const sock = fakeSock()
  const handled = await outreach.handleCommand(sock, OWNER, `/edit ${id} hello there`, {})

  assert.equal(handled, true)
  assert.ok(sock.sent.some(([jid, text]) => jid === '250788444444@s.whatsapp.net' && text === 'hello there'))
  const c = db.getCandidate(id)
  assert.equal(c.draft, 'hello there')
  assert.equal(c.status, 'sent')
})

test('/prospect off disables the group and /prospect own sets owned policy', async () => {
  db.upsertGroup({ groupId: 'g8@g.us', subject: 'Retail' })
  const sock = fakeSock()

  const handled = await outreach.handleCommand(sock, OWNER, '/prospect off g8@g.us', {})
  assert.equal(handled, true)
  assert.equal(db.getGroup('g8@g.us').enabled, 0)

  await outreach.handleCommand(sock, OWNER, '/prospect own g8@g.us', {})
  assert.equal(db.getGroup('g8@g.us').policy, 'owned')

  await outreach.handleCommand(sock, OWNER, '/prospect on g8@g.us', {})
  assert.equal(db.getGroup('g8@g.us').enabled, 1)
})

test('listings render rows and a friendly line when empty', async () => {
  db.upsertGroup({ groupId: 'g11@g.us', subject: 'Printing' })
  db.upsertMember({ groupId: 'g11@g.us', jid: '250788555555@s.whatsapp.net', phone: '250788555555', pushName: 'Asha', dmable: 1 })
  db.setMemberBusiness('g11@g.us', '250788555555@s.whatsapp.net', 'printing shop')
  const id = db.createCandidate({ groupId: 'g11@g.us', senderJid: '250788555555@s.whatsapp.net', business: 'print', intent: 'sales', signalIds: '13', draft: 'Karibu Asha' })
  const sock = fakeSock()

  await outreach.handleCommand(sock, OWNER, '/groups', {})
  assert.match(sock.sent[0][1], /g11@g\.us/)

  await outreach.handleCommand(sock, OWNER, '/members g11@g.us', {})
  assert.match(sock.sent[1][1], /250788555555/)
  assert.match(sock.sent[1][1], /printing shop/, '/members must show the business guess')

  await outreach.handleCommand(sock, OWNER, '/prospects', {})
  assert.match(sock.sent[2][1], new RegExp(`#${id} `))

  await outreach.handleCommand(sock, OWNER, '/members nope@g.us', {})
  assert.match(sock.sent[3][1], /No members/)
})

test('/skip starts the cooldown clock and a later /send is blocked by it', async () => {
  process.env.OUTREACH_DAILY_CAP = '5'
  process.env.OUTREACH_COOLDOWN_DAYS = '30'
  db.upsertGroup({ groupId: 'g13@g.us', subject: 'Cool' })
  db.upsertMember({ groupId: 'g13@g.us', jid: '250788777777@s.whatsapp.net', phone: '250788777777', dmable: 1 })

  const skipId = db.createCandidate({ groupId: 'g13@g.us', senderJid: '250788777777@s.whatsapp.net', business: 'cool', intent: 'sales', signalIds: '20', draft: 'first' })
  const sock = fakeSock()
  await outreach.handleCommand(sock, OWNER, `/skip ${skipId}`, {})
  assert.ok(
    db.lastContactedAt('g13@g.us', '250788777777@s.whatsapp.net') > 0,
    '/skip must start the cooldown clock so the member is not re-drafted'
  )

  const sendId = db.createCandidate({ groupId: 'g13@g.us', senderJid: '250788777777@s.whatsapp.net', business: 'cool', intent: 'sales', signalIds: '21', draft: 'second' })
  const sock2 = fakeSock()
  await outreach.handleCommand(sock2, OWNER, `/send ${sendId}`, {})
  assert.equal(memberSent(sock2, '250788777777'), false, 'a member in cooldown must not be messaged')
  assert.equal(db.getCandidate(sendId).status, 'pending', 'the blocked candidate stays pending')
})

test('handleCommand returns false for commands it does not own', async () => {
  const sock = fakeSock()
  assert.equal(await outreach.handleCommand(sock, OWNER, '/ping', {}), false)
  assert.equal(sock.sent.length, 0)
})

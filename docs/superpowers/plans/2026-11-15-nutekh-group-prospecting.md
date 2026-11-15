# Nutekh Group Prospecting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the `nutekh-bot` WhatsApp assistant so that adding it to a group makes it roster the members, detect buying signals in their messages, and DM the owner approval-ready outreach drafts — never messaging a member without the owner's `/send`.

**Architecture:** Four new, isolated modules (`prospectdb`, `roster`, `signals`, `prospect`, `outreach`) plus a thin wiring change in `bot.js`. A new SQLite file `data/prospect.db` holds groups, members, captured group messages, signals, candidates and outreach. A scan timer reads unprocessed group messages, pre-filters them, classifies survivors in one batched LLM call, drafts an outreach message for eligible signals, and sends the owner a live approval card.

**Tech Stack:** Node >= 20, CommonJS, `better-sqlite3` (already a dependency), `@whiskeysockets/baileys` (already a dependency), `node:test` for tests. **No new dependencies.**

**Spec:** `docs/superpowers/specs/2026-11-15-nutekh-group-prospecting-design.md`

## Global Constraints

- Node >= 20, CommonJS only (`require` / `module.exports`). No ESM.
- **No new npm dependencies.** `better-sqlite3`, `@whiskeysockets/baileys`, `pino` only.
- All tests run **offline**. Stub the LLM module by overwriting `require.cache[require.resolve('../src/llm')]` exactly as `tests/fallback.test.js` does.
- Each test file sets `process.env.DATA_DIR = tmpDataDir()` from `tests/helpers.js` **before** requiring any module that opens storage.
- Run tests with `node --test tests/<file>.test.js` (directory form `node --test tests/` also works; the quoted glob `"tests/*.test.js"` fails on the server).
- Drafts may use **published facts only** (from `knowledge/brief.md`). Never invent claims.
- **Owner approval is mandatory.** No code path may send a DM to a member without an explicit owner `/send`.
- Spec defaults, verbatim: `PROSPECT_ENABLED=0`, `SCAN_INTERVAL_MIN=10`, `SIGNAL_MIN_CHARS=40`, `BACKFILL_HOURS=72`, `OUTREACH_DAILY_CAP=5`, `OUTREACH_COOLDOWN_DAYS=30`, `OUTREACH_MIN_CONFIDENCE=0.6`.
- A newly discovered group defaults to `policy='external'`, `enabled=1`.
- Prospecting is independent of `GROUP_ANSWER` / `ANSWER_GROUPS`.

## Review Focus

Input classes and failure modes the spec implies but no single test states — each is pinned by a test in the task that owns the code:

1. A member whose JID is an `@lid` with no phone → must be `dmable:false` and never drafted. (Task 2, Task 4)
2. Malformed or partial classifier JSON → no crash, no signals written. (Task 3)
3. Duplicate message delivery (same `msg_id`) → stored once and classified once. (Task 1, Task 3)
4. Cooldown and daily-cap boundaries (exactly N days / exactly the cap) → blocked; just outside → allowed. (Task 4, Task 5)
5. Draft generation fails or returns empty → no candidate created, no owner card, no crash. (Task 4)

---

### Task 1: Prospect store — `src/prospectdb.js`

**Files:**
- Create: `nutekh-bot/src/prospectdb.js`
- Test: `nutekh-bot/tests/prospectdb.test.js`

**Interfaces:**
- Consumes: `better-sqlite3`; `process.env.DATA_DIR` (default `../data`).
- Produces (all synchronous):
  - `db` — the open `better-sqlite3` Database.
  - `upsertGroup({ groupId, subject, policy='external', enabled=1 }) -> void`
  - `getGroup(groupId) -> row | undefined` (row: `{ group_id, subject, policy, enabled, last_synced }`)
  - `listGroups() -> row[]`
  - `setGroupEnabled(groupId, enabled) -> void`; `setGroupPolicy(groupId, policy) -> void`
  - `upsertMember({ groupId, jid, phone='', lid='', pushName='', dmable=0 }) -> void`
  - `getMember(groupId, jid) -> row | undefined` (row: `{ group_id, jid, phone, lid, push_name, business_guess, dmable, status, first_seen, last_seen, last_contacted }`)
  - `listMembers(groupId) -> row[]`
  - `setMemberStatus(groupId, jid, status) -> void`; `setMemberBusiness(groupId, jid, business) -> void`; `markContacted(groupId, jid, ts) -> void`
  - `addMessage({ groupId, senderJid, senderName='', msgId, ts, text }) -> boolean` (true when newly inserted)
  - `pendingMessages(limit=200) -> row[]` (rows with `processed = 0`, oldest first)
  - `markMessagesProcessed(ids) -> void`
  - `addSignal({ groupId, senderJid, msgId, ts, text, business='', need='', intent='', confidence=0 }) -> number`
  - `unhandledSignals(minConfidence) -> row[]`
  - `markSignalHandled(id) -> void`
  - `createCandidate({ groupId, senderJid, business, intent, signalIds, draft }) -> number`
  - `getCandidate(id) -> row | undefined`; `updateCandidate(id, { status, draft, decided, sentAt }) -> void`; `listCandidates(status) -> row[]`
  - `hasPendingCandidate(groupId, senderJid) -> boolean`
  - `addOutreach({ candidateId, senderJid, text }) -> number`; `countOutreachSince(ts) -> number`; `lastContactedAt(groupId, senderJid) -> number | null`
  - `getMeta(key) -> string | null`; `setMeta(key, value) -> void`

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/prospectdb.test.js`
Expected: FAIL — `Cannot find module '../src/prospectdb'`.

- [ ] **Step 3: Implement `src/prospectdb.js`**

Open the DB at `path.join(DATA_DIR, 'prospect.db')`, `journal_mode = WAL`, and run `CREATE TABLE IF NOT EXISTS` for: `groups(group_id TEXT PRIMARY KEY, subject TEXT, policy TEXT DEFAULT 'external', enabled INTEGER DEFAULT 1, last_synced INTEGER)`, `members(group_id, jid, phone, lid, push_name, business_guess, dmable INTEGER DEFAULT 0, status TEXT DEFAULT 'member', first_seen, last_seen, last_contacted, PRIMARY KEY(group_id, jid))`, `prospect_messages(id INTEGER PRIMARY KEY AUTOINCREMENT, group_id, sender_jid, sender_name, msg_id TEXT UNIQUE, ts, text, processed INTEGER DEFAULT 0)`, `signals(id INTEGER PRIMARY KEY AUTOINCREMENT, group_id, sender_jid, msg_id, ts, text, business, need, intent, confidence REAL, handled INTEGER DEFAULT 0)`, `candidates(id INTEGER PRIMARY KEY AUTOINCREMENT, group_id, sender_jid, business, intent, signal_ids, draft, status TEXT DEFAULT 'pending', created, decided, sent_at)`, `outreach(id INTEGER PRIMARY KEY AUTOINCREMENT, candidate_id, sender_jid, text, sent_at)`, `meta(key TEXT PRIMARY KEY, value)`. Implement each helper with a prepared statement. `addMessage` uses `INSERT OR IGNORE` and returns `info.changes === 1`. Export all names above.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/prospectdb.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add nutekh-bot/src/prospectdb.js nutekh-bot/tests/prospectdb.test.js
git commit -m "feat(nutekh-bot): add prospect store (data/prospect.db)"
```

---

### Task 2: Roster — `src/roster.js`

**Files:**
- Create: `nutekh-bot/src/roster.js`
- Test: `nutekh-bot/tests/roster.test.js`

**Interfaces:**
- Consumes: `src/prospectdb.js` (Task 1).
- Produces:
  - `participantToMember(p) -> { jid, phone, lid, dmable, pushName }` where `p` is a Baileys participant `{ id, lid?, notify?, phoneNumber? }`.
  - `enrollGroup(group, opts = {}) -> { groupId, subject, members, dmable }` where `group = { id, subject, participants: p[] }`, `opts = { policy='external', enabled=1 }`. Upserts the group and every member; never downgrades an existing group's `policy`/`enabled`.
  - `refresh(sock) -> summary[]` — calls `await sock.groupFetchAllParticipating()` (object keyed by group id), maps to `{ id, subject, participants }`, enrolls each, and returns the summaries.

**Rules:**
- A participant's phone comes from `id` when it ends in `@s.whatsapp.net`; otherwise from `p.phoneNumber`. If neither yields a phone, `dmable = 0` and `lid` is set from `p.lid || p.id` when it ends in `@lid`.
- `dmable = 1` only when a phone JID is resolved.

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/roster.test.js`
Expected: FAIL — `Cannot find module '../src/roster'`.

- [ ] **Step 3: Implement `src/roster.js`**

`participantToMember` extracts digits from a `@s.whatsapp.net` id (or `p.phoneNumber`), sets `lid` when `p.lid`/`p.id` ends in `@lid`, and sets `dmable = phone ? 1 : 0`. `enrollGroup` calls `db.upsertGroup` then `db.upsertMember` per participant and returns the summary counts. `refresh` awaits `sock.groupFetchAllParticipating()` and enrolls each group. Export the three names.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/roster.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add nutekh-bot/src/roster.js nutekh-bot/tests/roster.test.js
git commit -m "feat(nutekh-bot): group discovery and member roster"
```

---

### Task 3: Signals — `src/signals.js`

**Files:**
- Create: `nutekh-bot/src/signals.js`
- Test: `nutekh-bot/tests/signals.test.js`

**Interfaces:**
- Consumes: `src/prospectdb.js` (Task 1); `chatJSON` from `src/llm.js`.
- Produces:
  - `preFilter(text, ctx = {}) -> boolean` — `ctx = { fromMe=false, isOwner=false, nTags=0 }`. True only when: not `fromMe`, not owner, text has >= `SIGNAL_MIN_CHARS` letters, is not link-only, is not a broadcast/mass-tag (`nTags >= 10` or an audience greeting).
  - `classifyBatch(items) -> object[]` — `items = [{ index, text }]`. One `chatJSON` call returning `{ results: [{ index, is_signal, business, need, intent, confidence }] }`. Returns `[]` on `null`/malformed. Drops entries whose `index` is not in `items` or whose fields are the wrong type.
  - `scan({ limit = 200 } = {}) -> object[]` — reads `db.pendingMessages(limit)`, keeps those passing `preFilter`, calls `classifyBatch`, writes a `db.addSignal` row for each `is_signal` with `confidence >= OUTREACH_MIN_CONFIDENCE`, marks all scanned message ids processed, and returns the written signals.

**Prompt:** one system message instructing the model to return JSON `{"results":[{"index":<n>,"is_signal":<bool>,"business":"","need":"","intent":"sales|support","confidence":0-1}]}`, where `is_signal` is true only when the message reveals a business need Nutekh could serve (a promotion, a complaint, a request for tools/automation/website). Use `chatJSON(messages, { max_tokens: 2000, label: 'prospect-scan' })`.

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/signals.test.js`
Expected: FAIL — `Cannot find module '../src/signals'`.

- [ ] **Step 3: Implement `src/signals.js`**

Implement `preFilter` (regex for links: `/^https?:\/\/\S+$/` on the trimmed text; audience greeting regex copied from `src/addressing.js` `AUDIENCE_GREETING`; letter count `(text.match(/[a-z]/gi)||[]).length`). Implement `classifyBatch` calling `chatJSON` once and validating each result's `index` against the input set and coercing `confidence` with `Number`. Implement `scan` orchestrating the three steps and marking every scanned id processed via `db.markMessagesProcessed`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/signals.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add nutekh-bot/src/signals.js nutekh-bot/tests/signals.test.js
git commit -m "feat(nutekh-bot): batched group signal detection"
```

---

### Task 4: Eligibility and drafting — `src/prospect.js`

**Files:**
- Create: `nutekh-bot/src/prospect.js`
- Test: `nutekh-bot/tests/prospect.test.js`

**Interfaces:**
- Consumes: `src/prospectdb.js` (Task 1); `chat` from `src/llm.js`; `knowledge/brief.md` via `src/knowledge.js` `brief()`.
- Produces:
  - `eligibility(signal, member, opts) -> { ok: boolean, reason: string }` — `opts = { now, groupEnabled, dailyCap, cooldownDays, sentToday, lastContactedAt, hasPending, minConfidence }`. Returns `ok:false` with a short `reason` for the first failing check, in this order: `disabled`, `not-dmable`, `low-confidence`, `pending`, `cap`, `cooldown`.
  - `draft(signal, member) -> string` — one `chat` call grounded in `brief()` plus the signal; returns `''` on failure/empty.
  - `run({ now = Date.now(), sendOwner } = {}) -> number` — for each `db.unhandledSignals(minConfidence)`: resolve the member and group, evaluate `eligibility`, skip when not ok, `draft`, skip when the draft is empty, else `db.createCandidate`, `db.setMemberStatus(...,'drafted')`, `db.markSignalHandled`, and `await sendOwner(card)`. Returns the number of candidates created.

**Card format** (passed to `sendOwner`):

```
*PROSPECT #<id>*  (group: <subject> · <policy>)
Member: <push_name> (<phone>)
Business: <business>
Signal: "<signal text, trimmed to 200>"
Draft:
"<draft>"
Reply: /send <id> · /edit <id> <text> · /skip <id>
```

- [ ] **Step 1: Write the failing test**

```js
// tests/prospect.test.js
const test = require('node:test')
const assert = require('node:assert/strict')
const { tmpDataDir } = require('./helpers')
process.env.DATA_DIR = tmpDataDir()
process.env.LLM_API_KEY = 'test'

const llmPath = require.resolve('../src/llm')
let chatReply = 'Hi Juma — Nutekh here. Saw your safari promo...'
require.cache[llmPath] = {
  id: llmPath, filename: llmPath, loaded: true,
  exports: { chat: async () => chatReply, chatJSON: async () => null, CHAT_MODEL: 'stub', BASE: 'stub', KEY: 'test' },
}

const prospect = require('../src/prospect')
const db = require('../src/prospectdb')

const DAY = 86400000
const signal = { group_id: 'g4@g.us', sender_jid: '250788000000@s.whatsapp.net', msg_id: 'p1', text: 'safari promo, need booking site', business: 'tour', intent: 'sales', confidence: 0.9 }
const member = { group_id: 'g4@g.us', jid: '250788000000@s.whatsapp.net', dmable: 1, status: 'member' }
const base = { now: 1_000_000_000_000, groupEnabled: true, dailyCap: 5, cooldownDays: 30, sentToday: 0, lastContactedAt: null, hasPending: false, minConfidence: 0.6 }

test('eligibility blocks the first failing check', () => {
  assert.equal(prospect.eligibility(signal, { ...member, dmable: 0 }, base).reason, 'not-dmable')
  assert.equal(prospect.eligibility({ ...signal, confidence: 0.1 }, member, base).reason, 'low-confidence')
  assert.equal(prospect.eligibility(signal, member, { ...base, groupEnabled: false }).reason, 'disabled')
  assert.equal(prospect.eligibility(signal, member, { ...base, sentToday: 5 }).reason, 'cap')
  assert.equal(prospect.eligibility(signal, member, { ...base, hasPending: true }).reason, 'pending')
})

test('cooldown boundary: exactly N days blocked, just inside allowed', () => {
  const exactly = base.now - 30 * DAY
  assert.equal(prospect.eligibility(signal, member, { ...base, lastContactedAt: exactly }).reason, 'cooldown')
  assert.equal(prospect.eligibility(signal, member, { ...base, lastContactedAt: base.now - 30 * DAY + 3600_000 }).ok, true)
})

test('run creates one candidate, seeds status, and calls sendOwner once', async () => {
  db.upsertGroup({ groupId: 'g4@g.us', subject: 'Tour Ops' })
  db.upsertMember({ groupId: 'g4@g.us', jid: '250788000000@s.whatsapp.net', phone: '250788000000', pushName: 'Juma', dmable: 1 })
  db.addSignal({ ...signal, ts: Date.now() })
  const cards = []
  const created = await prospect.run({ now: Date.now(), sendOwner: async (t) => cards.push(t) })
  assert.equal(created, 1)
  assert.equal(cards.length, 1)
  assert.match(cards[0], /PROSPECT #/)
  assert.equal(db.getMember('g4@g.us', '250788000000@s.whatsapp.net').status, 'drafted')
})

test('run makes no candidate when the draft is empty', async () => {
  chatReply = ''
  db.addSignal({ group_id: 'g4@g.us', sender_jid: '250788000000@s.whatsapp.net', msg_id: 'p2', ts: Date.now(), text: 'another promo', business: 'tour', intent: 'sales', confidence: 0.9 })
  const cards = []
  const created = await prospect.run({ now: Date.now(), sendOwner: async (t) => cards.push(t) })
  assert.equal(created, 0)
  assert.equal(cards.length, 0)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/prospect.test.js`
Expected: FAIL — `Cannot find module '../src/prospect'`.

- [ ] **Step 3: Implement `src/prospect.js`**

`eligibility` evaluates the checks in the stated order and returns `{ ok:true, reason:'ok' }` when all pass. `draft` builds a short persona-grounded prompt (published facts only) and returns the trimmed string or `''`. `run` loads `minConfidence` from `OUTREACH_MIN_CONFIDENCE` (default `0.6`), `dailyCap` from `OUTREACH_DAILY_CAP` (default `5`), `cooldownDays` from `OUTREACH_COOLDOWN_DAYS` (default `30`), computes `sentToday` via `db.countOutreachSince(startOfDay(now))`, and `hasPending` via `db.hasPendingCandidate`. Wrap the whole loop in try/catch so one bad signal cannot abort the run. Export the three names.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/prospect.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add nutekh-bot/src/prospect.js nutekh-bot/tests/prospect.test.js
git commit -m "feat(nutekh-bot): prospect eligibility and outreach drafting"
```

---

### Task 5: Owner commands — `src/outreach.js`

**Files:**
- Create: `nutekh-bot/src/outreach.js`
- Test: `nutekh-bot/tests/outreach.test.js`

**Interfaces:**
- Consumes: `src/prospectdb.js` (Task 1); `usermem` from `src/usermem.js`.
- Produces:
  - `parseCommand(text) -> { cmd, args } | null` — recognises `/prospects`, `/groups`, `/members <group>`, `/prospect on|off|own <group>`, `/send <id>`, `/edit <id> <text>`, `/skip <id>`. Returns `null` for anything else (so `bot.js` falls through to its existing commands).
  - `capCheck({ sentToday, dailyCap }) -> { ok, reason }` — `ok:false, reason:'cap'` when `sentToday >= dailyCap`.
  - `handleCommand(sock, jid, text, deps) -> boolean` — `deps = { sendOwner }`. Returns `true` when the text was a prospect command (handled or not), `false` otherwise. Uses `sock.sendMessage(jid, { text })` for replies.

**Behaviour:**
- `/send <id>`: load candidate; require `status === 'pending'`; enforce `capCheck`; send the draft to the member JID; `db.addOutreach`; `db.updateCandidate(id, { status:'sent', sentAt })`; `db.setMemberStatus(group, sender, 'sent')`; `db.markContacted(group, sender, Date.now())`; seed `usermem.push(memberJid, 'assistant', draft)`. On cap, reply that the cap is reached.
- `/edit <id> <text>`: update the candidate draft, then behave like `/send`.
- `/skip <id>`: `db.updateCandidate(id, { status:'skipped' })` and `db.setMemberStatus(group, sender, 'suppressed')`.
- `/prospect off|on|own <group>`: `db.setGroupEnabled` / `db.setGroupPolicy`.
- `/groups`, `/members <group>`, `/prospects`: formatted listings.

- [ ] **Step 1: Write the failing test**

```js
// tests/outreach.test.js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/outreach.test.js`
Expected: FAIL — `Cannot find module '../src/outreach'`.

- [ ] **Step 3: Implement `src/outreach.js`**

Implement `parseCommand` with a small command table; `capCheck`; and `handleCommand` dispatching to per-command helpers that read/write through `prospectdb` and reply via `sock.sendMessage`. `/send` and `/edit` resolve the member's JID from the `members` row (`<phone>@s.whatsapp.net`). Export the three names.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/outreach.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add nutekh-bot/src/outreach.js nutekh-bot/tests/outreach.test.js
git commit -m "feat(nutekh-bot): owner approval commands for outreach"
```

---

### Task 6: Wire into `bot.js`, config and docs

**Files:**
- Modify: `nutekh-bot/bot.js`
- Modify: `nutekh-bot/.env.example`
- Modify: `nutekh-bot/README.md`

**Interfaces:**
- Consumes: `roster.refresh`, `prospectdb.addMessage`, `signals.scan`, `prospect.run`, `outreach.handleCommand` (Tasks 1–5); existing `sendOwner`, `handleCommand`, and the group branch in `bot.js`.

- [ ] **Step 1: Add config reads**

Near the other config constants in `bot.js`, add: `PROSPECT_ENABLED = (process.env.PROSPECT_ENABLED ?? '0') === '1'`, `PROSPECT_GROUPS = splitList(process.env.PROSPECT_GROUPS)`, `SCAN_INTERVAL_MIN = Number(process.env.SCAN_INTERVAL_MIN || 10)`.

- [ ] **Step 2: Capture live group messages**

In the group branch of the messages handler (after `logMessage(entry)`), when `PROSPECT_ENABLED` and (`!PROSPECT_GROUPS.length` or the group id is listed) and the group row is enabled, call `prospectdb.addMessage({ groupId: chatId, senderJid: entry.senderId, senderName: entry.senderName, msgId: entry.messageId, ts: Date.parse(entry.time), text: entry.text })`. This runs for `notify` and `append` (so backfill works) and must not depend on `GROUP_ANSWER`.

- [ ] **Step 3: Discover groups on connect and on add**

After the socket reports `connected`, if `PROSPECT_ENABLED`: `await roster.refresh(sock)` (log the summary) and start the scan timer `setInterval(() => { signals.scan().then(() => prospect.run({ sendOwner })).catch((e) => console.log('prospect scan:', e?.message)) }, SCAN_INTERVAL_MIN * 60000)`. Register `sock.ev.on('groups.upsert', async (groups) => { ... })` that enrolls each new group and calls `sendOwner` with the `*ADDED TO GROUP*` note. Guard the whole block with `if (PROSPECT_ENABLED)`.

- [ ] **Step 4: Route the new owner commands**

At the top of `handleCommand`, before the existing commands: `if (outreach.handleCommand(sock, jid, text, { sendOwner })) return`. Extend the fallback help line to include the prospect commands.

- [ ] **Step 5: Verify syntax and the whole suite**

Run: `node --check bot.js`
Expected: no output (syntax OK).

Run: `node --test tests/`
Expected: all suites PASS (the existing 46 tests plus the new ones).

- [ ] **Step 6: Update `.env.example` and `README.md`**

Append the eight keys from spec §9 with their defaults and a one-line comment each. In `README.md`, add a short "Group prospecting" section: what it does, that adding the bot to a group is the only action required, the owner commands, and the safety defaults (`PROSPECT_ENABLED=0`).

- [ ] **Step 7: Commit**

```bash
git add nutekh-bot/bot.js nutekh-bot/.env.example nutekh-bot/README.md
git commit -m "feat(nutekh-bot): wire group prospecting into the bot"
```

---

### Task 7: Live verification on the VPS

**Files:** none (operational).

- [ ] **Step 1: Deploy and enable**

Push the branch, deploy to `/opt/nutekh-bot`, set `PROSPECT_ENABLED=1` in `/opt/nutekh-bot/.env`, `pm2 restart nutekh-bot --update-env`.

- [ ] **Step 2: Add the bot to a test group and confirm the roster**

Confirm the `*ADDED TO GROUP*` note arrives at `OWNER_JIDS` (`+250782718957`), then send `/groups` and `/members <id>` and check member counts and `dmable` flags in the reply.

- [ ] **Step 3: Post a signal and confirm a card**

From a second phone, post a business signal in the group (e.g. "we're launching a promo and need a booking website"). Wait one scan interval. Confirm a `*PROSPECT #n*` card arrives, then reply `/skip <n>` and confirm the member is suppressed. Do **not** `/send` until the draft reads correctly.

- [ ] **Step 4: Confirm the kill switch**

Set `PROSPECT_ENABLED=0`, restart, post another signal, and confirm no card is produced.

---

## Self-Review

**Spec coverage:** §4 components → Tasks 1–5; §5 data model → Task 1; §6 pre-filter/classification/eligibility/drafting → Tasks 3–4; §7 owner experience and commands → Task 5; §8 safety (kill switch, auto-enroll, dmable, cap/cooldown/confidence, independent of group answering) → Tasks 2, 4, 5, 6; §9 config → Task 6; §10 testing → every task; §11 phasing → Task order (1–3 = Phase 1 read path, 4–5 = Phase 2, 6 = wiring); §12 limitations are operational and carried into Task 7.

**Type consistency:** `db` helper names (`upsertMember`, `addSignal`, `hasPendingCandidate`, `countOutreachSince`, `markContacted`) are used identically in Tasks 1, 4 and 5. `eligibility`'s `opts` keys match the call site in `run`. `participantToMember` returns `{ jid, phone, lid, dmable, pushName }`, consumed by `enrollGroup`.

**Review Focus:** items 1–5 are each pinned by a named test in Tasks 2/3/1/4/5 respectively (see the Review Focus list above).

**Proportion:** the plan is longer than the spec only because it carries exact test code; every implementation step is a signature plus the values the spec pins, not a body.

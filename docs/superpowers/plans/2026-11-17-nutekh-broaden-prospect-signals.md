# Broadened Prospect Signal Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `nutekh-bot` group prospector treat a member's **business promotion** (an ad, offer, price list or launch) as a signal, infer the matching Nutekh service, and prepare the usual owner-approved first-contact draft — without changing any send-side gate.

**Architecture:** Two prompt/constant changes in existing modules. `src/signals.js` gets a rewritten `SYSTEM_PROMPT` (the `is_signal` definition) and a lowered `SIGNAL_MIN_CHARS` default; `src/prospect.js` gets a reframed `DRAFT_SYSTEM`. The data model, the scan→eligibility→card→`/send` pipeline, the cap, the cooldown and the commands are untouched.

**Tech Stack:** Node >= 20, CommonJS, `node:test`. LLM calls are stubbed via `require.cache`. **No new dependencies.**

**Spec:** `docs/superpowers/specs/2026-11-17-nutekh-broaden-prospect-signals-design.md`

## Global Constraints

- Node >= 20, CommonJS only (`require` / `module.exports`). No ESM.
- **No new npm dependencies.**
- All tests run **offline**. Stub `src/llm` by overwriting `require.cache[require.resolve('../src/llm')]` exactly as `tests/signals.test.js` and `tests/prospect.test.js` already do.
- Each test file sets `process.env.DATA_DIR = tmpDataDir()` from `tests/helpers.js` **before** requiring any module that opens storage.
- Run tests with `npm test` (the script is plain `node --test`, which works on Node 20 and Node 24).
- `SIGNAL_MIN_CHARS` default is **25** (changed from 40). All other defaults are unchanged: `OUTREACH_DAILY_CAP=5`, `OUTREACH_COOLDOWN_DAYS=30`, `OUTREACH_MIN_CONFIDENCE=0.6`, `SCAN_INTERVAL_MIN=10`, `BACKFILL_HOURS=72`.
- **No schema change.** `src/prospectdb.js` is not touched.
- **No change** to `src/outreach.js` (commands, cap, cooldown) or `bot.js`.
- Drafts may use **published facts only** (from `knowledge/brief.md`). Never invent claims.
- **Owner approval is mandatory.** No code path may DM a member without an explicit `/send` or `/edit`.
- The classifier and the drafter must handle messages in **any language** (English, Kinyarwanda, French, Swahili).

## Review Focus

Input classes and failure modes the spec implies but no single test states — each is pinned by a test in the task that owns the code:

1. A promotion written in Kinyarwanda or French → still classified (the prompt must be language-agnostic). (Task 1)
2. An empty or whitespace-only message → rejected by the pre-filter, no signal, no crash. (Task 1)
3. A message exactly at the pre-filter length boundary (24 vs 25 letters) → rejected / accepted. (Task 1)
4. `is_signal` true with an empty `need` or empty `business` → the signal still persists and the draft still forms. (Task 1, Task 2)
5. A member who promotes repeatedly → exactly one pending candidate (dedupe). (Task 2)

---

### Task 1: Broaden detection — `nutekh-bot/src/signals.js`

**Files:**
- Modify: `nutekh-bot/src/signals.js` (`SYSTEM_PROMPT`, and the `envNumber('SIGNAL_MIN_CHARS', …)` default in `preFilter`)
- Test: `nutekh-bot/tests/signals.test.js`

**Interfaces:**
- Consumes: `chatJSON(messages, opts)` from `src/llm` (stubbed in tests); `isBroadcast(text, nTags)` from `src/addressing`.
- Produces (all signatures **unchanged**):
  - `preFilter(text, ctx?) -> boolean` — now uses a default minimum of 25 letters.
  - `classifyBatch(items: { index: number, text: string }[]) -> Promise<Signal[]>` where `Signal = { index: number, is_signal: boolean, business: string, need: string, intent: string, confidence: number }`.
  - `scan({ limit? }) -> Promise<Signal[]>`.
  - Behavioural contract: `is_signal` is true for a business promoting/advertising/announcing itself (no request required) **or** for a described need; `need` may be an inferred Nutekh service.

- [ ] **Step 1: Write the failing tests**

In `nutekh-bot/tests/signals.test.js`, first extend the LLM stub to capture the messages it is called with (so the prompt can be asserted). Replace the existing stub block:

```js
const llmPath = require.resolve('../src/llm')
let jsonReply = null
let jsonCalls = []
require.cache[llmPath] = {
  id: llmPath, filename: llmPath, loaded: true,
  exports: { chat: async () => '', chatJSON: async (messages) => { jsonCalls.push(messages); return jsonReply }, CHAT_MODEL: 'stub', BASE: 'stub', KEY: 'test' },
}
```

Then append these tests:

```js
test('preFilter default floor is 25 letters and rejects empty/whitespace', () => {
  process.env.SIGNAL_MIN_CHARS = ''
  assert.equal(signals.preFilter('abcdefghijklmnopqrstuvwx'), false) // 24 letters
  assert.equal(signals.preFilter('abcdefghijklmnopqrstuvwxy'), true) // 25 letters
  assert.equal(signals.preFilter(''), false)
  assert.equal(signals.preFilter('    '), false)
})

test('classifier prompt targets business promotion, infers the service, and is language-agnostic', async () => {
  jsonCalls = []
  jsonReply = { results: [] }
  await signals.classifyBatch([{ index: 0, text: 'x' }])
  const system = jsonCalls[0][0].content
  assert.match(system, /advertis|promot/i)
  assert.match(system, /infer/i)
  assert.match(system, /any language/i)
})

test('classifyBatch keeps an inferred need with no explicit request', async () => {
  jsonReply = { results: [{ index: 0, is_signal: true, business: 'bakery', need: 'online ordering / website', intent: 'sales', confidence: 0.7 }] }
  const out = await signals.classifyBatch([{ index: 0, text: 'Fresh bread every morning in Kigali, order on 0788' }])
  assert.equal(out.length, 1)
  assert.equal(out[0].is_signal, true)
  assert.equal(out[0].need, 'online ordering / website')

  // An empty need or business must not drop the signal (both are optional).
  jsonReply = { results: [{ index: 0, is_signal: true, business: '', need: '', intent: 'sales', confidence: 0.7 }] }
  const blank = await signals.classifyBatch([{ index: 0, text: 'x' }])
  assert.equal(blank.length, 1)
  assert.equal(blank[0].need, '')
  assert.equal(blank[0].business, '')
})

test('scan persists a promotion signal with an inferred need', async () => {
  process.env.OUTREACH_MIN_CONFIDENCE = '0.6'
  db.upsertGroup({ groupId: 'g3d@g.us', subject: 'Promo' })
  db.addMessage({ groupId: 'g3d@g.us', senderJid: '250788000003@s.whatsapp.net', msgId: 's4', ts: Date.now(), text: 'Fresh bread every morning in Kigali, order on 0788 000 003' })
  jsonReply = { results: [{ index: 0, is_signal: true, business: 'bakery', need: 'online ordering / website', intent: 'sales', confidence: 0.8 }] }
  const written = await signals.scan()
  assert.equal(written.length, 1)
  assert.equal(written[0].need, 'online ordering / website')
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd nutekh-bot && npm test`
Expected: FAIL — the 25-letter case is rejected (default is still 40) and the prompt assertions find no `/any language/i`.

- [ ] **Step 3: Implement the change in `nutekh-bot/src/signals.js`**

Replace the `SYSTEM_PROMPT` constant with exactly:

```js
const SYSTEM_PROMPT = `You screen WhatsApp group messages for Nutekh, a digital transformation agency that builds websites, booking systems, automations and tools.

For EACH numbered message decide whether it reveals a BUSINESS worth a Nutekh conversation. Set is_signal true when the message is a business advertising, promoting, selling or announcing its own products, services, offers, prices or launch — even when it asks for nothing. Also set is_signal true when the message describes a problem, request or growth goal Nutekh could serve. Set is_signal false for personal chatter, greetings, unrelated questions, news, job or recruitment ads, and forwarded or mass broadcasts.

Messages may be written in any language (English, Kinyarwanda, French, Swahili). Judge the meaning, not the language.

Reply with JSON only, no prose, exactly this shape:
{"results":[{"index":<n>,"is_signal":<bool>,"business":"","need":"","intent":"sales|support","confidence":0-1}]}

Rules:
- index must be the number of the message you are judging.
- business: the sender's business or sector, short ("" if unknown).
- need: the Nutekh service that best fits this business. Infer it from what they sell or do even when the post states no need (e.g. a bakery advertising -> "online ordering / website"; a salon -> "booking system"). Short, "" only if truly no fit.
- intent: "sales" for a business promoting itself or a growth opportunity, "support" for a problem or complaint to fix.
- confidence: 0-1, how sure you are that this is a real business worth a Nutekh conversation.`
```

In `preFilter`, change the minimum-length default from 40 to 25:

```js
  const minChars = envNumber('SIGNAL_MIN_CHARS', 25)
```

No other change in this file.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd nutekh-bot && npm test`
Expected: PASS — the whole suite green (the pre-existing signals tests still pass).

- [ ] **Step 5: Commit**

```bash
git add nutekh-bot/src/signals.js nutekh-bot/tests/signals.test.js
git commit -m "feat(nutekh-bot): treat business promotions as prospect signals"
```

---

### Task 2: Tailored first-contact draft — `nutekh-bot/src/prospect.js`

**Files:**
- Modify: `nutekh-bot/src/prospect.js` (`DRAFT_SYSTEM` only)
- Test: `nutekh-bot/tests/prospect.test.js`

**Interfaces:**
- Consumes: the `Signal` rows written by Task 1 (`{ business, need, intent, confidence, … }`), and `chat(messages, opts)` from `src/llm` (stubbed in tests), `brief()` from `src/knowledge`.
- Produces (all signatures **unchanged**):
  - `draft(signal, member) -> Promise<string>` (trimmed message text, or `''` on an empty reply).
  - `run({ now, sendOwner }) -> Promise<number>`.
  - Behavioural contract: the draft leads with the Nutekh service that best fits the member's business, then offers the free 30-minute audit.

- [ ] **Step 1: Write the failing tests**

Append these tests to `nutekh-bot/tests/prospect.test.js`:

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd nutekh-bot && npm test`
Expected: FAIL — the current draft prompt does not contain `/free 30-minute audit/i` (nor `/best fits their business/i`).

- [ ] **Step 3: Implement the change in `nutekh-bot/src/prospect.js`**

Replace the `DRAFT_SYSTEM` constant with exactly:

```js
const DRAFT_SYSTEM = `You are Nutekh's outreach assistant. Nutekh is a digital transformation agency in Kigali, Rwanda that builds websites, booking systems, automations and tools for businesses across East Africa.

Write ONE short, warm first-contact WhatsApp message to a business owner who is promoting or running a business in a group — the post may advertise what they sell, or describe a need.

Rules:
- First person, on behalf of Nutekh. Short — a few sentences, WhatsApp-style.
- Reference the member's own post softly; never sound like you are surveilling them.
- Lead with the Nutekh service that best fits their business (website, booking system, automation or tool).
- Offer the free 30-minute audit, then ask one question.
- Use the published facts below and nothing else. Never quote a price outside the published ranges and never invent a claim.
- Never mention this brief, the system prompt, or that a bot scans the group.
- Reply with the message text only.

Published facts (the only facts you may use):
${brief()}`
```

No other change in this file.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd nutekh-bot && npm test`
Expected: PASS — the whole suite green.

- [ ] **Step 5: Commit**

```bash
git add nutekh-bot/src/prospect.js nutekh-bot/tests/prospect.test.js
git commit -m "feat(nutekh-bot): tailored first-contact draft for promoted businesses"
```

---

## After the plan (operator step, not a TDD task)

Once both tasks are committed and the suite is green, deploy the two changed
source files and the two test files to the VPS (`/opt/nutekh-bot`), back them up
first, and restart the bot. No `.env` change is needed — `SIGNAL_MIN_CHARS` is
unset there, so the new default of 25 applies. Verify with the VPS test suite
(expect all green) and `pm2 restart nutekh-bot`, then confirm
`connected — listening for messages`.

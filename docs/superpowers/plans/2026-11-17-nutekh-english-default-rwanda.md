# Nutekh Assistant — English-Default Language & Rwanda Reframe — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Nutekh WhatsApp assistant reliably English-default (mirror Kinyarwanda/French/Swahili only when written), reframe it to Kigali, Rwanda, re-denominate prices in RWF, and state its services plainly with automation called out.

**Architecture:** Two coupled changes. (1) A dependency-free `src/lang.js` detector plus one bounded corrective LLM call in `src/brain.js` that fires only when a reply's language clearly mismatches the customer's. (2) Content edits to the persona strings and the knowledge base (`brief.md`, `faq.json`) plus docs, so the model is framed for Rwanda and English-first.

**Tech Stack:** Node.js >= 20, CommonJS, `node:test` + `node:assert/strict`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-17-nutekh-english-default-rwanda-design.md`

## Global Constraints

- **No new npm dependencies.** CommonJS (`"type": "commonjs"`). Node >= 20.
- **Tests run offline** — no network. Run from `nutekh-bot/` with `npm test` (`node --test "tests/*.test.js"`).
- **English is the default language.** An English message must never get a Swahili reply.
- **Mirror** Kinyarwanda / French / Swahili only when the customer clearly writes in that language.
- **Rwanda facts (exact values):** location **Kigali, Rwanda**; contact **+250 787 398 363** (`wa.me/250787398363`); hours **Monday to Friday, 9:00–18:00 Central Africa Time (CAT)**.
- **Published prices (RWF, owner-approved):** Launch setup **RWF 700K – 1.8M (USD 500 – 1,300)**, retainer **from RWF 120K/mo**; Grow setup **RWF 2M – 6M (USD 1,500 – 4,500)**, retainer **from RWF 350K/mo**; Scale **from RWF 8M (USD 5,700+)**.
- **Detection thresholds:** a language wins only at score **>= 2** and **strictly greater** than all others; otherwise `en`. The repair guard fires only for replies **>= 40 characters** whose detected language differs from the customer's.
- Do not touch the WhatsApp, memory, retrieval, lead-capture or prospecting logic beyond the wording/guard described here.

## Review Focus

Failure modes the spec implies that are easy to get wrong — each has a test in the task that owns the code:

1. **Kinyarwanda/French must be mirrored, not forced to English.** A Kinyarwanda message answered in Kinyarwanda must be left alone. *(Task 1 + Task 2)*
2. **Short non-English replies must not trigger a rewrite.** A model reply under 40 chars in another language is left as-is. *(Task 1)*
3. **A failing repair call must not crash or drop the reply.** If the repair LLM call throws, the original reply is returned. *(Task 2)*
4. **A language mismatch must not destroy lead capture.** The guard runs after marker parsing, so a `[[LEAD:...]]` marker still becomes a lead. *(Task 2)*
5. **Ambiguous/mixed input defaults to English, never guesses.** A tie or a single marker word returns `en`. *(Task 1)*

---

### Task 1: Language detector (`src/lang.js`)

**Files:**
- Create: `nutekh-bot/src/lang.js`
- Test: `nutekh-bot/tests/lang.test.js`

**Interfaces:**
- Produces: `detectLang(text: string) -> 'en'|'rw'|'fr'|'sw'`; `needsRepair(expected: string, replyText: string) -> boolean`; `LANG_NAMES: { en: 'English', rw: 'Kinyarwanda', fr: 'French', sw: 'Swahili' }`.
- Consumes: nothing.

- [ ] **Step 1: Write the failing test**

Create `nutekh-bot/tests/lang.test.js`:

```js
const test = require('node:test')
const assert = require('node:assert/strict')

const { detectLang, needsRepair, LANG_NAMES } = require('../src/lang')

test('detectLang defaults to English', () => {
  assert.equal(detectLang(''), 'en')
  assert.equal(detectLang('How much does the Grow package cost?'), 'en')
})

test('detectLang recognises French', () => {
  assert.equal(detectLang('Bonjour, combien coûte le pack Grow ? Merci beaucoup'), 'fr')
})

test('detectLang recognises Kinyarwanda', () => {
  assert.equal(detectLang('Muraho, igiciro cya Grow ni angahe? Murakoze'), 'rw')
})

test('detectLang recognises Swahili', () => {
  assert.equal(detectLang('Habari, bei ya Grow ni ngapi? Asante sana'), 'sw')
})

test('detectLang returns English on a tie or a single marker', () => {
  assert.equal(detectLang('Bonjour, hello'), 'en')
  assert.equal(detectLang('merci'), 'en')
})

test('needsRepair ignores a short reply', () => {
  assert.equal(needsRepair('en', 'Asante sana'), false)
})

test('needsRepair flags a clearly Swahili reply to an English message', () => {
  const sw = 'Habari, bei ya Grow ni ngapi? Asante sana kwa swali lako zuri.'
  assert.ok(sw.length >= 40)
  assert.equal(needsRepair('en', sw), true)
})

test('needsRepair leaves an English reply alone', () => {
  assert.equal(needsRepair('en', 'Grow starts at RWF 2M. Shall I book the free audit?'), false)
})

test('LANG_NAMES covers every detected language', () => {
  for (const l of ['en', 'rw', 'fr', 'sw']) assert.equal(typeof LANG_NAMES[l], 'string')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="detectLang|needsRepair|LANG_NAMES"` (from `nutekh-bot/`)
Expected: FAIL — `Cannot find module '../src/lang'`.

- [ ] **Step 3: Implement `src/lang.js`**

Create `nutekh-bot/src/lang.js`. Markers are function/common words; count **distinct** markers present (each marker contributes at most 1). Use a word-boundary regex on the lowercased text.

```js
const MARKERS = {
  fr: ['bonjour', 'merci', 'vous', 'nous', 'je', 'est', 'pour', 'avec', 'prix', 'combien', "s'il", 'la', 'les', 'des', 'une'],
  rw: ['muraho', 'mwaramutse', 'amakuru', 'murakoze', 'yego', 'oya', 'kandi', 'cyane', 'ufite', 'nshaka', 'ndashaka', 'igiciro', 'amafaranga', 'kuki', 'gute'],
  sw: ['habari', 'jambo', 'mambo', 'karibu', 'asante', 'ndiyo', 'hapana', 'naomba', 'bei', 'gani', 'ngapi', 'vipi', 'nzuri', 'sana', 'ninataka', 'tunataka', 'pesa', 'shilingi'],
}

const LANG_NAMES = { en: 'English', rw: 'Kinyarwanda', fr: 'French', sw: 'Swahili' }
const MIN_SCORE = 2
const MIN_REPAIR_CHARS = 40

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

function score(text, markers) {
  const t = String(text || '').toLowerCase()
  let n = 0
  for (const m of markers) {
    if (new RegExp(`(^|[^a-zà-ÿ])${escapeRe(m)}([^a-zà-ÿ]|$)`).test(t)) n++
  }
  return n
}

function detectLang(text) {
  let best = 'en'
  let bestScore = 0
  let tie = false
  for (const lang of ['rw', 'fr', 'sw']) {
    const s = score(text, MARKERS[lang])
    if (s > bestScore) { best = lang; bestScore = s; tie = false }
    else if (s === bestScore && s > 0) tie = true
  }
  if (bestScore < MIN_SCORE || tie) return 'en'
  return best
}

function needsRepair(expected, replyText) {
  const body = String(replyText || '')
  if (body.length < MIN_REPAIR_CHARS) return false
  return detectLang(body) !== expected
}

module.exports = { detectLang, needsRepair, LANG_NAMES }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="detectLang|needsRepair|LANG_NAMES"`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add nutekh-bot/src/lang.js nutekh-bot/tests/lang.test.js
git commit -m "feat(nutekh-bot): add language detector and repair guard"
```

---

### Task 2: Wire the guard into `src/brain.js`

**Files:**
- Modify: `nutekh-bot/src/brain.js` (imports ~line 1-5; `tidy`/`answerDM` ~234-263; `answerAuto` ~265-292; `module.exports` ~294-303)
- Test: `nutekh-bot/tests/brain.test.js` (append), `nutekh-bot/tests/fallback.test.js` (append + stub tweak)

**Interfaces:**
- Consumes: `detectLang`, `needsRepair`, `LANG_NAMES` from `./lang` (Task 1).
- Produces: `ensureLanguage(reply: string, customerText: string, opts?: { chat?: Function, langGuard?: boolean }) -> Promise<string>`, exported from `src/brain.js`. `opts.chat` overrides the LLM call (defaults to the module `chat`); `opts.langGuard === false` disables the guard.

- [ ] **Step 1: Write the failing unit tests**

Append to `nutekh-bot/tests/brain.test.js`. Update the existing import line (line 9) to also pull `ensureLanguage`:

```js
const { parseMarkers, shouldExtract, normalizeLeadCandidate, extractLead, ensureLanguage } = require('../src/brain')
```

Then append:

```js
const SW_REPLY = 'Habari, bei ya Grow ni ngapi? Asante sana kwa swali lako zuri.'

test('ensureLanguage rewrites a Swahili reply to an English message', async () => {
  let used = null
  const out = await ensureLanguage(SW_REPLY, 'How much is Grow?', {
    chat: async (messages) => { used = messages; return 'Grow starts at RWF 2M. Shall I book the free audit?' },
  })
  assert.match(out, /Grow starts at RWF 2M/)
  assert.match(used[0].content, /English/)
})

test('ensureLanguage leaves a Kinyarwanda reply to a Kinyarwanda message alone', async () => {
  const rw = 'Muraho, igiciro cya Grow ni RWF 2M. Nshaka kubaza byinshi ku bijyanye na serivisi.'
  let called = false
  const out = await ensureLanguage(rw, 'Muraho, igiciro cya Grow ni angahe?', {
    chat: async () => { called = true; return 'x' },
  })
  assert.equal(out, rw)
  assert.equal(called, false)
})

test('ensureLanguage keeps the original reply when the repair call fails', async () => {
  const out = await ensureLanguage(SW_REPLY, 'How much is Grow?', {
    chat: async () => { throw new Error('offline') },
  })
  assert.equal(out, SW_REPLY)
})

test('ensureLanguage is a no-op when the guard is disabled', async () => {
  let called = false
  const out = await ensureLanguage(SW_REPLY, 'How much is Grow?', {
    langGuard: false,
    chat: async () => { called = true; return 'x' },
  })
  assert.equal(out, SW_REPLY)
  assert.equal(called, false)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern="ensureLanguage"`
Expected: FAIL — `ensureLanguage is not a function`.

- [ ] **Step 3: Implement the guard in `src/brain.js`**

Add the import near the top (after the `./sanitize` import):

```js
const { detectLang, needsRepair, LANG_NAMES } = require('./lang')
```

Add these two functions just above `answerDM` (after `tidy`):

```js
async function repairLanguage(text, lang, chatFn) {
  const messages = [
    { role: 'system', content: `Rewrite the message below in ${LANG_NAMES[lang] || 'English'} only. Keep the meaning and the short WhatsApp style. Output only the rewritten message.` },
    { role: 'user', content: text },
  ]
  try {
    const out = await chatFn(messages, { max_tokens: 500 })
    const cleaned = String(out || '').trim()
    return cleaned || text
  } catch (e) {
    console.log('brain: language repair failed -', e.message)
    return text
  }
}

async function ensureLanguage(reply, customerText, opts = {}) {
  if (opts.langGuard === false) return reply
  const expected = detectLang(customerText)
  if (!needsRepair(expected, reply)) return reply
  return repairLanguage(reply, expected, opts.chat || chat)
}
```

In `answerDM`, change the reply line so the guard runs after `tidy`:

```js
  let reply = tidy(parsed.text, { stripIntro: !opts.firstContact })
  if (!reply) reply = "I'm here to help with Nutekh's services, packages, and support. What would you like to know?"
  reply = await ensureLanguage(reply, text, opts)
```

In `answerAuto`, change `const reply = tidy(parsed.text)` to:

```js
  let reply = tidy(parsed.text)
  reply = await ensureLanguage(reply, text, opts)
```

Add `ensureLanguage` to `module.exports`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern="ensureLanguage"`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing end-to-end test (marker preserved)**

In `nutekh-bot/tests/fallback.test.js`, first extend the stub so a queued reply can be returned (keeps existing behaviour when the queue is empty). Replace the `chat` line in the `require.cache` stub (around line 20-27):

```js
let chatReply = ''
let chatQueue = []
```

and

```js
    chat: async () => (chatQueue.length ? chatQueue.shift() : chatReply),
```

Then append:

```js
test('answerDM repairs a Swahili reply and still captures the lead marker', async () => {
  chatQueue = [
    'Habari, bei ya Grow ni ngapi? Asante sana kwa swali lako zuri.\n[[LEAD: {"type":"sales","business":"Hardware shop","need":"POS","budget":"RWF 5M"}]]',
    'Grow starts at RWF 2M. Shall I book the free audit?',
  ]
  jsonReply = null
  jsonCalls = 0

  const res = await answerDM(DETAILED, [], '')
  assert.match(res.reply, /Grow starts at RWF 2M/)
  assert.equal(res.leadSource, 'marker')
  assert.equal(res.lead.business, 'Hardware shop')
  chatQueue = []
})
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern="answerDM"`
Expected: PASS — the new test plus the three existing `answerDM` tests.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS, no regressions.

- [ ] **Step 8: Commit**

```bash
git add nutekh-bot/src/brain.js nutekh-bot/tests/brain.test.js nutekh-bot/tests/fallback.test.js
git commit -m "feat(nutekh-bot): english-default language guard in the brain"
```

---

### Task 3: Reframe the runtime prompts (Rwanda + English-first + name the service)

**Files:**
- Modify: `nutekh-bot/src/brain.js` (`PERSONA` ~line 10 and the language rule ~43-46; `EXTRACT_SYSTEM` ~line 153)
- Modify: `nutekh-bot/src/prospect.js` (`DRAFT_SYSTEM` ~line 73)
- Test: `nutekh-bot/tests/persona.test.js` (create)

**Interfaces:**
- Consumes: `PERSONA` exported from `src/brain.js` (already exported).
- Produces: nothing new — wording only.

- [ ] **Step 1: Write the failing test**

Create `nutekh-bot/tests/persona.test.js`:

```js
const test = require('node:test')
const assert = require('node:assert/strict')
const { tmpDataDir } = require('./helpers')

process.env.DATA_DIR = tmpDataDir()
process.env.LLM_API_KEY = 'test'
process.env.EMBED_URL = 'http://127.0.0.1:1'

const { PERSONA } = require('../src/brain')

test('persona is framed for Rwanda, not Tanzania', () => {
  assert.match(PERSONA, /Kigali, Rwanda/)
  assert.doesNotMatch(PERSONA, /Dar es Salaam|Tanzania/)
})

test('persona makes English the default and demotes Swahili', () => {
  assert.match(PERSONA, /English is the default/i)
  assert.doesNotMatch(PERSONA, /Kiswahili stays\s+Kiswahili/)
  assert.doesNotMatch(PERSONA, /first-class/)
})

test('persona tells the bot to name the relevant service', () => {
  assert.match(PERSONA, /name the relevant Nutekh service/i)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="persona"`
Expected: FAIL — persona still says "Dar es Salaam, Tanzania" / "Kiswahili stays".

- [ ] **Step 3: Edit the persona and extractor in `src/brain.js`**

Replace the first line of `PERSONA` (line 10):

```
const PERSONA = `You are *Nutekh Assistant*, the official WhatsApp assistant for Nutekh — a digital transformation agency in Kigali, Rwanda, working across East Africa.
```

Add a service-naming bullet in the `WHAT YOU CAN DO` list (after the "Explain Nutekh's services…" bullet):

```
- When you answer, name the relevant Nutekh service plainly (for example: websites and
  Google presence, WhatsApp automation, payments and reconciliation, ImaliCloud, Hresa,
  VUKA, CRM and lead pipeline, dashboards and reporting).
```

Replace the language rule (currently lines 43-46) with:

```
- Language: reply in the customer's language, but *English is the default*. An English
  message always gets an English reply — never answer an English message in Swahili or
  any other language. Mirror *Kinyarwanda*, *French*, or *Swahili* only when the
  customer clearly writes in that language; if they mix, mirror the mix. Never open
  with a greeting in a different language from the message.
```

Replace `EXTRACT_SYSTEM`'s first line (line 153) so it reads:

```
const EXTRACT_SYSTEM = `You extract structured lead data from a WhatsApp conversation for Nutekh, a digital transformation agency in Kigali, Rwanda.
```

- [ ] **Step 4: Edit `DRAFT_SYSTEM` in `src/prospect.js`**

Replace the first line of `DRAFT_SYSTEM` (line 73):

```
const DRAFT_SYSTEM = `You are Nutekh's outreach assistant. Nutekh is a digital transformation agency in Kigali, Rwanda that builds websites, booking systems, automations and tools for businesses across East Africa.
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="persona"`
Expected: PASS (3 tests).

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add nutekh-bot/src/brain.js nutekh-bot/src/prospect.js nutekh-bot/tests/persona.test.js
git commit -m "feat(nutekh-bot): reframe persona to rwanda, english-first"
```

---

### Task 4: Reframe the knowledge base (`brief.md`, `faq.json`)

**Files:**
- Modify: `nutekh-bot/knowledge/brief.md`
- Modify: `nutekh-bot/knowledge/faq.json`
- Test: `nutekh-bot/tests/knowledge.test.js`

**Interfaces:**
- Consumes: `knowledge.brief()` (reads `brief.md`), `knowledge.faq()` (reads `faq.json`).
- Produces: the brief/FAQ now carry RWF prices, Rwanda facts, and a services list. No code interface changes.

- [ ] **Step 1: Update the failing assertions in `tests/knowledge.test.js`**

Replace the `brief carries the published price ranges` test (lines 31-39) with:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="price ranges"`
Expected: FAIL — brief still has TZS ranges.

- [ ] **Step 3: Edit `knowledge/brief.md`**

- **Who we are** (line 9): `Nutekh is a digital transformation agency headquartered in Kigali, Rwanda,` `serving businesses across East Africa. …` (keep the rest of the sentence).
- Add a new section **immediately after** the "Who we are" paragraph (before `## How we help`):

```markdown
## What we do (services)

- **Websites & presence** — a fast website plus verified Google and social profiles.
- **WhatsApp automation (Rainmaker)** — greetings, FAQs, lead capture, qualification,
  polite follow-ups, and warm-prospect hand-off to staff.
- **Business-process automation** — invoicing, stock checks, approvals, reminders, and
  payout alerts.
- **Payments & reconciliation** — MTN/Airtel mobile money, POS/card readers, and bank
  feeds matched in the background.
- **ImaliCloud** — cash, payroll, and inventory in one cloud.
- **Hresa** — QR ordering, kitchen tickets, and fast check-out for venues.
- **VUKA** — Hresa guest flow plus ImaliCloud books for hotels and property.
- **CRM & lead pipeline** — one pipeline, with one paid channel (Meta or Google).
- **Dashboards & reporting** — owner/funder dashboards, spending controls, and
  investor/lender reporting (Scale).
```

- **Packages and published pricing** (line 49): `All figures are planning ranges in RWF with USD equivalents. Never quote a price outside these ranges and never invent a discount.`
- **Launch** (lines 53-54): `Setup: RWF 700K – 1.8M (USD 500 – 1,300)` and `Support/retainer: from RWF 120K per month`.
- **Grow** (lines 61-62): `Setup: RWF 2M – 6M (USD 1,500 – 4,500)` and `Support/retainer: from RWF 350K per month`.
- **Scale** (line 70): `Setup: from RWF 8M (USD 5,700+), once the scorecard is agreed.`
- **Package → services mapping** (the `Includes:` line of each package): keep these explicit and aligned with §6.2 — Launch `Includes:` names website + Google visibility, Hresa **or** ImaliCloud go-live, and WhatsApp lead flow; Grow `Includes:` names **WhatsApp automation** + mobile money wired in, CRM + lead pipeline, and one paid channel; Scale `Includes:` names dashboards, spending controls, and investor/lender reporting. Change the Grow line's `WhatsApp + mobile money wired in` to `WhatsApp automation + mobile money wired in`.
- **Contact** (lines 93-95): phone `+250 787 398 363 (wa.me/250787398363)`; location `Kigali, Rwanda — East Africa`; hours `Monday to Friday, 9:00–18:00 Central Africa Time (CAT)`.

- [ ] **Step 4: Edit `knowledge/faq.json`**

Update these `text` values (keep ids unchanged):

- `who-is-nutekh`: `"Q: Who is Nutekh? A: Nutekh is a digital transformation agency based in Kigali, Rwanda, serving businesses across East Africa. We help teams deploy, integrate, and scale practical systems for online presence, operations, marketing, and payments."`
- `industries`: `"Q: Which industries does Nutekh work with? A: Retail, hospitality, healthcare, logistics, schools, and NGOs across Rwanda and the wider East Africa region."`
- `location`: `"Q: Where is Nutekh located? A: Nutekh is headquartered in Kigali, Rwanda, and works with clients across East Africa."`
- `hours`: `"Q: What are Nutekh's opening hours? A: Monday to Friday, 9:00 to 18:00 Central Africa Time (CAT)."`
- `contact`: `"Q: How can I contact Nutekh? A: Email hello@nutekh.com or info@nutekh.com, call or WhatsApp +250 787 398 363, or use the contact form on nutekh.com."`
- `launch-price`: `"Q: How much does the Launch package cost? A: Launch setup is RWF 700K to 1.8M (USD 500 to 1,300). Support starts from RWF 120K per month."`
- `grow-price`: `"Q: How much does the Grow package cost? A: Grow setup is RWF 2M to 6M (USD 1,500 to 4,500). Support starts from RWF 350K per month."`
- `scale-price`: `"Q: How much does the Scale package cost? A: Scale starts from RWF 8M (USD 5,700 and above). The final figure is quoted after we agree the scorecard and scope."`
- `support`: `"Q: Do you offer ongoing support? A: Yes. Launch retainers start from RWF 120K per month and Grow retainers from RWF 350K per month. Scale support is quoted with the scope."`
- `languages`: `"Q: Which languages does Nutekh support? A: Nutekh works in English, Kinyarwanda and French, and the assistant replies in the language the customer uses, with English as the default."`
- `remote-work`: `"Q: Do you work with businesses outside Kigali? A: Yes. Nutekh works across Rwanda and the wider East Africa region, with remote discovery and on-site work where the rollout needs it."`
- `grow-includes`: change `"WhatsApp and mobile money wired in"` to `"WhatsApp automation and mobile money wired in"`.

Add one new entry (at the end of the array, before the closing `]`):

```json
  {
    "id": "services",
    "text": "Q: What services does Nutekh offer? A: Websites and Google presence; WhatsApp automation (greetings, FAQs, lead capture, qualification, follow-ups); business-process automation (invoicing, stock checks, approvals, reminders, payout alerts); payments and reconciliation (MTN/Airtel mobile money, POS/card readers, bank feeds); ImaliCloud (cash, payroll, inventory); Hresa (venue guest flow); VUKA (hotels and property); CRM and lead pipeline; and dashboards and reporting."
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="brief|faq|seeds|seeding|pending"`
Expected: PASS (including the new services entry — `rows.length >= 30` and unique ids still hold).

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add nutekh-bot/knowledge/brief.md nutekh-bot/knowledge/faq.json nutekh-bot/tests/knowledge.test.js
git commit -m "feat(nutekh-bot): rwanda knowledge base, rwf prices, services list"
```

---

### Task 5: Docs and remaining fixtures; repo-wide consistency

**Files:**
- Modify: `nutekh-bot/README.md`
- Modify: `nutekh-bot/docs/HOW-IT-WORKS.md`
- Modify: `nutekh-bot/docs/LEAD-GENERATION.md`
- Modify: `nutekh-bot/tests/brain.test.js`, `nutekh-bot/tests/fallback.test.js` (TZS fixtures → RWF)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing — documentation and fixture consistency.

- [ ] **Step 1: Edit `README.md`**

- Expected-answer block (lines 67-68): `Grow quoted as **RWF 2M – 6M (USD 1,500 – 4,500)**, retainer from **RWF 350K/month**, with a question back.`
- Languages bullet (lines 107-108): `- **Languages** — replies in the customer's language, with **English as the default**; Kinyarwanda and French are mirrored when the customer uses them.`
- Example env (lines 56-57): use Rwanda-style placeholders: `PHONE=2507XXXXXXXX` and `OWNER_JIDS=2507XXXXXXXX`.

- [ ] **Step 2: Edit `docs/HOW-IT-WORKS.md` §7 Language (lines 169-174)**

```markdown
## 7. Language

The bot replies in the customer's language, with **English as the default**: an
English message always gets an English reply. Kinyarwanda, French, or Swahili are
mirrored only when the customer clearly writes in them. A dependency-free detector
(`src/lang.js`) checks each reply, and a clearly wrong-language reply is rewritten
once. Retrieval is multilingual because the embedding model is.
```

- [ ] **Step 3: Edit `docs/LEAD-GENERATION.md`**

Replace the `TZS` figures with the RWF equivalents (lines 103, 142, 222, 225, 238): `RWF 5 million` → keep the "5 million" narrative but in RWF, and update the package reference `TZS 4M–12M` → `RWF 2M–6M`. Use `RWF 5 million` and `RWF 2M–6M` consistently.

- [ ] **Step 4: Update TZS fixtures in tests**

In `nutekh-bot/tests/brain.test.js` and `nutekh-bot/tests/fallback.test.js`, replace `TZS` with `RWF` in fixture strings and assertions (lines such as `brain.test.js:12,15,80,114`; `fallback.test.js:31,34,46,56`). This is cosmetic consistency; assertions stay otherwise unchanged.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Verify no stale Tanzania/Swahili/TZS wording remains in shipped content**

Run (from repo root):

```bash
git grep -n -i -E "dar es salaam|tanzania|kiswahili" -- nutekh-bot/src nutekh-bot/knowledge nutekh-bot/README.md nutekh-bot/docs
git grep -n "TZS" -- nutekh-bot/knowledge nutekh-bot/README.md nutekh-bot/docs
```

Expected: the first command returns **no** `Dar es Salaam` or `Tanzania` matches, and the only `kiswahili` matches are the intentional `src/docs.js` document-request classifier lines (lines ~54 and ~60, which map a request for a *Swahili document* and are not reply-language behaviour). The second command returns **no** matches (exit code 1 is expected and fine).

- [ ] **Step 7: Commit**

```bash
git add nutekh-bot/README.md nutekh-bot/docs/HOW-IT-WORKS.md nutekh-bot/docs/LEAD-GENERATION.md nutekh-bot/tests/brain.test.js nutekh-bot/tests/fallback.test.js
git commit -m "docs(nutekh-bot): rwanda + english-default wording and rwf fixtures"
```

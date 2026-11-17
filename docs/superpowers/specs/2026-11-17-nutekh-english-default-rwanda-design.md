# Nutekh Assistant — English-Default Language & Rwanda Reframe — Design

- **Status:** Approved (design), pending implementation plan
- **Date:** 2026-11-17
- **Scope:** a behaviour + knowledge change to the existing `nutekh-bot` WhatsApp assistant
- **Related:** `docs/superpowers/specs/2026-11-12-nutekh-whatsapp-assistant-design.md`,
  `docs/superpowers/specs/2026-11-15-nutekh-group-prospecting-design.md`

## 1. Context

`nutekh-bot` is a live WhatsApp sales + support assistant whose behaviour is driven
by a persona in `src/brain.js` plus a knowledge base (`knowledge/brief.md`,
`knowledge/faq.json`).

A live incident: the bot replied in **Swahili to a customer writing in English**.
The owner reports the bot is for the **Rwandan market** and must be **English-first**.

Root cause, in `src/brain.js` `PERSONA` and the knowledge base:

- The persona says *"Mirror the customer's language exactly: English stays English,
  Kiswahili stays Kiswahili"* and calls *"English and Kiswahili … first-class"* —
  this primes Swahili.
- The persona, brief, FAQ and docs are **Tanzania-framed** ("Dar es Salaam,
  Tanzania"), so the model leans Swahili and Tanzanian facts.
- The same framing repeats in `src/prospect.js` (`DRAFT_SYSTEM`), `src/brain.js`
  (`EXTRACT_SYSTEM`), `README.md`, `docs/HOW-IT-WORKS.md`, `docs/LEAD-GENERATION.md`.

Note: `src/sanitize.js` exposes `cleanReply(text, lang)`, but `brain.js` calls
`cleanReply(text)` with no `lang`, so the `fixLeadWord` language logic is dead code
today. This change does not rely on it.

## 2. Goal and non-goals

**Goal.** Make the assistant reliably reply in the customer's language with
**English as the default**, eliminate Swahili drift on English messages, reframe
the assistant to Rwanda (Kigali), re-denominate published prices in RWF, and state
Nutekh's services plainly (including automation).

**Non-goals.**

- No new npm dependencies. CommonJS. Tests run offline.
- No change to the WhatsApp, memory, retrieval, lead-capture, or prospecting logic.
- No new languages beyond detection for `en` / `rw` / `fr` / `sw`.
- No invented prices beyond the owner-approved ranges in §6.
- No change to owner commands or the prospecting pipeline.

## 3. Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Language policy | **Mirror them, English default.** English message → English reply, always. Mirror Kinyarwanda / French / Swahili only when the customer clearly writes in it. |
| Swahili status | **Demoted.** Used only when the customer writes Swahili; never leaked into an English reply. |
| Enforcement | **Prompt rewrite + deterministic guard.** A testable `src/lang.js` detector, plus one corrective regeneration when the reply language clearly mismatches. |
| Persona framing | **Nutekh is in Rwanda** — Kigali, Rwanda. |
| Reframe scope | Location + language + contact + currency; other content stays. |
| Contact | The **bot number**: `+250 787 398 363` (`wa.me/250787398363`). |
| Services | **Make them specific**, with **automation** as its own group; add a services FAQ and a package→services mapping. |
| Pricing | Owner-delegated: **RWF ranges** anchored to the existing USD equivalents (§6). |

## 4. Language policy and enforcement

### 4.1 Policy (persona wording)

Replace the current language rule in `PERSONA` with, in substance:

> Language: reply in the customer's language, but **English is the default**.
> - An English message always gets an English reply. Never reply in Swahili (or any
>   other language) to an English message.
> - Mirror **Kinyarwanda**, **French**, or **Swahili** only when the customer clearly
>   writes in that language; if they mix, mirror the mix.
> - Never open with a greeting in a different language from the message.

The same intent is reflected in `knowledge/faq.json` (`languages`) and
`docs/HOW-IT-WORKS.md` (§7 Language).

### 4.2 `src/lang.js` (new, no dependencies)

Pure, synchronous detection. Exports:

- `detectLang(text) -> 'en' | 'rw' | 'fr' | 'sw'` — default `'en'`.
  Lowercases, tokenises on non-letters, and counts marker-word hits per language.
  Returns the top language only when its score is **>= 2** and **strictly greater**
  than every other language's score; ties or lower scores return `'en'`. Markers are
  function/common words, e.g.:
  - **fr:** `bonjour, merci, vous, nous, je, est, pour, avec, prix, combien, s'il, la, les, des, une`
  - **rw:** `muraho, mwaramutse, amakuru, murakoze, yego, oya, kandi, cyane, ufite, nshaka, ndashaka, igiciro, amafaranga, kuki, gute`
  - **sw:** `habari, jambo, mambo, karibu, asante, ndiyo, hapana, naomba, bei, gani, vipi, nzuri, sana, ninataka, tunataka, pesa, shilingi`
- `LANG_NAMES = { en: 'English', rw: 'Kinyarwanda', fr: 'French', sw: 'Swahili' }`
- `needsRepair(expected, replyText) -> boolean` — true only when the reply is
  **long enough to trust** (>= 40 characters) **and** `detectLang(replyText)` differs
  from `expected`. This makes the reported bug (expected `en`, reply `sw`) fire, while
  a stray marker word in a short reply does not.

### 4.3 Guard in `src/brain.js`

In `answerDM` and `answerAuto`, **after** `parseMarkers` (so lead capture is
untouched) and after `tidy`, run:

```
expected = detectLang(customerText)
if (needsRepair(expected, reply)):
    reply = await rewriteInLanguage(reply, expected)   // ONE extra chat call
```

`rewriteInLanguage(text, lang)` sends a single repair call:

- system: "Rewrite the message below in {LANG_NAMES[lang]} only. Keep the meaning
  and the short WhatsApp style. Output only the rewritten message."
- user: the reply text.

If the repair call throws or returns empty, keep the original reply (no loops, no
corruption). The guard can be disabled in tests via `opts.langGuard === false`.

This keeps the change small: detection is pure and unit-tested; the repair is a
single, bounded LLM call that only fires on a confident mismatch.

## 5. Rwanda reframe

| Item | From | To |
|---|---|---|
| Location | Dar es Salaam, Tanzania | **Kigali, Rwanda** |
| Region | Tanzania / East Africa | **Rwanda / East Africa** |
| Contact | +255 748 000 000 (wa.me/255748000000) | **+250 787 398 363 (wa.me/250787398363)** |
| Hours | 9:00–18:00 East Africa Time (EAT) | **9:00–18:00 CAT (Rwanda)** |
| Currency | TZS (+ USD) | **RWF (+ USD)** |

Payment rails stay **MTN / Airtel mobile money** (both operate in Rwanda).

Applied in: `src/brain.js` (`PERSONA`, `EXTRACT_SYSTEM`), `src/prospect.js`
(`DRAFT_SYSTEM`), `knowledge/brief.md`, `knowledge/faq.json`, `README.md`,
`docs/HOW-IT-WORKS.md`, `docs/LEAD-GENERATION.md`.

## 6. Services (specific, with automation) and pricing

### 6.1 Services list (grounded in the brief/FAQ — nothing invented)

**Presence** — fast website + verified **Google Business Profile** and social profiles.

**Automation**
- **WhatsApp automation** (Rainmaker): greetings, FAQs, lead capture,
  qualification, polite follow-ups, warm-prospect hand-off to staff.
- **Business-process automation**: invoicing, stock checks, approvals, reminders,
  payout alerts.

**Payments & reconciliation** — **MTN / Airtel mobile money**, POS/card readers,
**bank feeds** matched in the background.

**Systems & products**
- **ImaliCloud** — cash, payroll, inventory in one cloud.
- **Hresa** — QR ordering, kitchen tickets, fast check-out for venues.
- **VUKA** — Hresa guest flow + ImaliCloud books for hotels/property.

**Growth & reporting** — **CRM + lead pipeline**, one paid channel (Meta or Google),
**dashboards, spending controls, investor/lender reporting** (Scale).

Delivered as:
- a plain "What Nutekh does" list in `knowledge/brief.md`,
- a new FAQ entry **"What services does Nutekh offer?"** in `knowledge/faq.json`,
- a package→services mapping (below) in the brief and the existing includes-FAQs,
- a persona line instructing the bot to **name the relevant service plainly**.

### 6.2 Package → services mapping

- **Launch** (about 7 days): website + Google visibility, Hresa **or** ImaliCloud
  go-live, WhatsApp lead flow.
- **Grow** (about 30 days): WhatsApp automation + mobile money wired in, CRM/lead
  pipeline, one paid channel.
- **Scale**: dashboards, spending controls, investor/lender reporting, for
  multi-branch or backed businesses.

### 6.3 Published pricing (RWF; owner-approved)

Anchored to the existing USD equivalents (assumed ~1,400 RWF/USD):

| Package | Was (TZS) | Now (RWF) |
|---|---|---|
| Launch setup | 1.2M – 3.5M | **700K – 1.8M (USD 500 – 1,300)** |
| Launch retainer | from 180K/mo | **from 120K/mo** |
| Grow setup | 4M – 12M | **2M – 6M (USD 1,500 – 4,500)** |
| Grow retainer | from 600K/mo | **from 350K/mo** |
| Scale | from 15M | **from 8M (USD 5,700+)** |

Timelines ("about 7 days" Launch, "about 30 days" Grow) are unchanged.

## 7. Files touched

| File | Change |
|---|---|
| `src/lang.js` | **new** — `detectLang`, `LANG_NAMES`, `needsRepair` |
| `src/brain.js` | persona language rule; Rwanda/EXTRACT framing; guard wiring; persona "name the service" line |
| `src/prospect.js` | `DRAFT_SYSTEM` → Kigali, Rwanda |
| `knowledge/brief.md` | Kigali/Rwanda, bot number, CAT, RWF pricing, services list + mapping |
| `knowledge/faq.json` | location/contact/hours/industries/languages/prices; new services entry; Rwanda wording |
| `README.md` | languages line; expected-answer prices; example env numbers |
| `docs/HOW-IT-WORKS.md` | §7 Language paragraph |
| `docs/LEAD-GENERATION.md` | TZS examples → RWF |
| `tests/lang.test.js` | **new** — detection + repair-decision tests |
| `tests/brain.test.js` | guard path with injected fake `chat`; RWF fixtures |
| `tests/knowledge.test.js` | assert RWF ranges instead of TZS |
| `tests/fallback.test.js` | RWF fixtures (consistency) |

## 8. Acceptance criteria

1. An English customer message produces an English reply; a Swahili reply is
   detected and rewritten once.
2. A Kinyarwanda or French message is mirrored (not forced to English).
3. `detectLang` returns `en` for plain English and for empty/ambiguous text.
4. Persona, brief, FAQ and docs consistently say **Kigali, Rwanda**, the **bot
   number**, **CAT** hours, and **RWF** prices.
5. The services list and package→services mapping are present, specific, and
   include **automation**.
6. `npm test` passes offline; no new dependencies; CommonJS.

## 9. Risks

- **Heuristic false positives.** Conservative thresholds; the guard only triggers a
  rewrite, never edits content directly, and falls back to the original on failure.
- **Extra LLM call.** Only on a confident mismatch (one bounded call).
- **Owner-delegated prices.** The RWF figures are approved by the owner and recorded
  here as the published ranges; the brief remains the source of truth.

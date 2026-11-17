# Nutekh Prospecting — Broadened Signal Detection (Business Promotions) — Design

- **Status:** Approved (design), pending implementation plan
- **Date:** 2026-11-17
- **Scope:** a targeted change to the shipped `nutekh-bot` group-prospecting feature
- **Related:** `docs/superpowers/specs/2026-11-15-nutekh-group-prospecting-design.md`

## 1. Context

The group-prospecting feature is live: it rosters group members, watches group
messages, and turns qualifying messages into owner-approved outreach cards. Today
a message only becomes a signal when it shows an **explicit need** — a promotion
that "needs a page/site", a complaint about a manual process, or a direct request
for tools/automation/website (see `SYSTEM_PROMPT` in `src/signals.js`).

In practice, group members rarely state a need. They **advertise their business**:
they post what they sell, their prices, their offers, their launch. Waiting for an
explicit "I need a website" makes the pipeline almost never fire. The owner wants
prospecting to trigger on **business promotion itself** — gather what the member
posts about their business, infer the Nutekh service that fits, and prepare the
first-contact message as usual.

## 2. Goal and non-goals

**Goal.** Treat a member's business promotion/announcement as a signal, infer the
matching Nutekh service from what they posted, and prepare a tailored,
owner-approved first-contact message — without weakening any existing safety gate.

**Non-goals (this change).**

- No change to the approval flow, commands, caps, or cooldown. Cards, `/send`,
  `/edit`, `/skip`, one-pending-per-member, 5/day cap, 30-day cooldown are
  unchanged.
- No new data-model columns and no new dependencies.
- No autonomous sending; there is still no code path that DMs a member without an
  explicit owner approval.
- No image-only capture. Caption-less flyers remain invisible (see §9).
- No in-group replying, no web research, no CRM sync.

## 3. Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| What counts as a signal | **Business promotion.** Any post where a member advertises, promotes, sells, or announces their own business, product, service, offer, price, or launch — with or without a stated need. |
| Explicit-need posts | **Still signals** (superset, not a replacement). |
| "Need" field | **Inferred.** The best-fit Nutekh service, inferred even when the post states no need. |
| Delivery / volume | **Card per prospect, as today** — one pending card per member, 5 sends/day. |
| Pitch angle | **Tailored** — lead with the best-fit Nutekh service, then offer the free 30-minute audit. |
| Implementation approach | **Prompt rewrite + one pre-filter tweak.** No schema change. |

## 4. What changes (and what does not)

Two source files change; everything downstream is untouched.

| File | Change |
|---|---|
| `src/signals.js` | Rewrite `SYSTEM_PROMPT`'s definition of `is_signal`; instruct the model to infer `need`. Lower the `SIGNAL_MIN_CHARS` default. |
| `src/prospect.js` | Reframe `DRAFT_SYSTEM` from "a post that suggests a need" to "a business promoting itself"; lead with the tailored service, then the free audit. |
| `tests/signals.test.js`, `tests/prospect.test.js` | New/updated cases for the broadened criterion, inferred need, pre-filter boundary, and the reframed draft prompt. |

Unchanged: `src/prospectdb.js` (schema), `src/outreach.js` (commands, cap,
cooldown), `src/roster.js`, `bot.js` capture path, `knowledge/brief.md`.

```
live group msg ─► prospect_messages
scan timer ─► pre-filter (min 25 letters; not link-only/broadcast/self)
     └► ONE batched LLM call  ──► is_signal = "business promoting itself OR need"
          └► signals row (business, inferred need, intent, confidence)
               └► eligibility (unchanged gates)
                    └► draft (tailored pitch, grounded in brief)
                         └► owner card ─► /send | /edit | /skip   (unchanged)
```

## 5. Detection contract (`src/signals.js`)

`SYSTEM_PROMPT` is rewritten so that, for each message, `is_signal` is **true**
when the message is a business advertising, promoting, selling, or announcing its
own products, services, offers, prices, or launch — **or** when it describes a
problem or request Nutekh could serve. It is **false** for personal chatter,
greetings, unrelated questions, news, job/recruitment/MLM ads, and forwarded or
mass broadcasts.

Field semantics (JSON shape is unchanged):

```json
{ "index": 3, "is_signal": true, "business": "bakery",
  "need": "online ordering / website", "intent": "sales", "confidence": 0.8 }
```

- `business`: the sender's business or sector, short (`""` if unknown).
- `need`: the **best-fit Nutekh service, inferred even when the post states no
  need** (e.g. a bakery advertising → "online ordering / website"; a salon →
  "booking system"). Short.
- `intent`: `sales` for a business promoting itself or a growth opportunity;
  `support` for a problem/complaint to fix.
- `confidence`: 0–1, how sure the model is that this is a real business worth a
  Nutekh conversation.

The JSON parsing, validation, confidence write-floor, `setMemberBusiness`
enrichment, and per-message marking in `classifyBatch`/`scan` are unchanged.

## 6. Pre-filter (`src/signals.js`)

Only the minimum-length default changes: `SIGNAL_MIN_CHARS` **40 → 25**, so short
ads ("We sell quality cakes, order on 0788…") survive to classification.

Unchanged pre-filter rules: reject `fromMe`/owner messages, empty text, link-only
messages, mass-tag/audience-greeting broadcasts, and messages already classified.
The pre-filter stays a cheap gate; the batched LLM call remains the real filter.

## 7. Drafting (`src/prospect.js`)

`DRAFT_SYSTEM` is reframed from a member "whose post suggests a need" to a member
**who is promoting or running a business** Nutekh could help. New behaviour:
lead with the Nutekh service that best fits their business, then offer the
**free 30-minute audit** and ask one question.

Every existing draft guardrail is retained verbatim in spirit: first person, on
behalf of Nutekh; short and WhatsApp-style; reference the member's own post
*softly*; never sound like surveillance; **published facts only** (never a price
outside the published ranges, never an invented claim); never mention the brief,
the system prompt, or that a bot scans the group; reply with the message text
only.

## 8. Safety envelope (unchanged)

Broadening detection raises the number of candidates, but the send-side gates are
untouched and remain the binding constraint:

- Owner approval is still mandatory; no auto-send path exists.
- One pending card per member; daily cap (`OUTREACH_DAILY_CAP`, default 5; 10 for
  `owned`); per-member cooldown (`OUTREACH_COOLDOWN_DAYS`, default 30); confidence
  floor (`OUTREACH_MIN_CONFIDENCE`, default 0.6; 0.5 for `owned`).
- `dmable:false` members are shown but never drafted.
- `PROSPECT_ENABLED` remains the hard kill switch; per-group `on`/`off` and
  `external`/`owned` policy are unchanged.
- Every send still appends to `data/outreach.jsonl`.

Note: because promotions are common, a chatty group will produce more cards. The
one-pending-per-member rule and the confidence floor bound this; the owner can
`/prospect off` any group or tune `OUTREACH_MIN_CONFIDENCE`.

## 9. Configuration

No new keys. One default changes:

| Key | Old default | New default | Purpose |
|---|---|---|---|
| `SIGNAL_MIN_CHARS` | `40` | `25` | Pre-filter minimum letters in a message. |

All other keys (`PROSPECT_ENABLED`, `PROSPECT_GROUPS`, `SCAN_INTERVAL_MIN`,
`BACKFILL_HOURS`, `OUTREACH_DAILY_CAP`, `OUTREACH_COOLDOWN_DAYS`,
`OUTREACH_MIN_CONFIDENCE`) are unchanged.

## 10. Testing

Unit tests with a stubbed LLM (no network):

- `signals.test.js`:
  - A promotion with no stated request → `is_signal` true, with an inferred
    non-empty `need`.
  - Personal chatter and a job/recruitment ad → `is_signal` false.
  - `preFilter` boundary at the new `SIGNAL_MIN_CHARS` (a short ad passes; a
    sub-threshold line fails); link-only and broadcast still rejected.
- `prospect.test.js`:
  - The reframed `DRAFT_SYSTEM` is the one sent to the LLM, and the card still
    forms from the drafted text.
- Full suite stays green on Node 20 and Node 24.

## 11. Known limitations

1. **Caption-less flyers.** Image/video posts with no caption carry no text and
   are not captured (`textOf` reads captions only). Text and captioned media are.
2. **Higher volume.** More cards by design; bounded by one-pending-per-member, the
   confidence floor, and the daily cap.
3. **Classifier judgement.** The model may still miss weak promotions or flag
   borderline posts; the owner remains the gate.
4. **Cold-DM and ban risk** (unchanged from the parent spec): Message requests,
   `@lid` non-DM-able members, and report risk are unaffected by this change.
5. **Stored personal data** (unchanged): member phone numbers live in
   `prospect.db`.

## 12. Open questions

None blocking. The `SIGNAL_MIN_CHARS` value and the confidence floor are tunable
in `.env` without a code change if volume or precision needs adjusting.

# Nutekh Group Prospecting & Owner-Approved Outreach — Design

- **Status:** Approved (design), pending implementation plan
- **Date:** 2026-11-15
- **Scope:** an addition to the existing `nutekh-bot` WhatsApp assistant
- **Related:** `docs/superpowers/specs/2026-11-12-nutekh-whatsapp-assistant-design.md`

## 1. Context

`nutekh-bot` is a live WhatsApp sales + support assistant built on Baileys, with
a persona/brief-driven brain, SQLite + hybrid retrieval memory, per-customer DM
memory, and JSONL lead capture that alerts the owner. Today it answers DMs and
(if enabled) only speaks in groups when directly addressed. It does not watch
groups for opportunity.

The owner runs and participates in **several business groups** whose members are
themselves businesses. The goal is to turn that group activity into qualified,
actionable outreach: notice when a member signals a need Nutekh can serve, draft
a relevant first-contact message, and let the owner send it with one tap.

## 2. Goal and non-goals

**Goal.** From group activity, find member businesses, detect buying signals in
what they write, and prepare a grounded outreach message the owner approves
before anything is sent.

**Non-goals (v1).**

- No autonomous sending. There is no code path that DMs a member without an
  explicit owner approval.
- No web research or scraping of members. Personalization uses group context
  only.
- No CRM sync, no sequencing/automation beyond the daily cap and cooldown.
- No outreach to members who have not posted. Signals come from their messages.

## 3. Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Outreach autonomy | **Owner approves each DM.** Bot drafts; nothing sends until `/send`. |
| What qualifies | **Signal-based only.** Roster of everyone; drafts only on buying signals. |
| Personalization source | **Group context only** (their posts + profile name + the brief). |
| Group context | **Multiple groups**, a mix of owner-run and third-party. Per-group policy. |
| Volume | **Conservative: ~5 approved DMs/day.** |
| Approval UX | **Live card per lead** over WhatsApp, matching `/ping` `/leads`. |

## 4. Architecture

Approach A: extend the existing single bot process with an isolated prospecting
layer. No second process, no second WhatsApp session.

```
connect ─► roster sync (all PROSPECT_GROUPS), resolve @lid, mark dmable
   │
live group msg ─► append to prospect_messages (no LLM)
   │
scan timer (SCAN_INTERVAL_MIN) ─► pre-filter
        └► ONE batched LLM call → signals
             └► eligibility (dmable, cooldown, cap, no pending dup)
                  └► draft via LLM (grounded in brief + the signal)
                       └► candidate = pending
                            └► owner card (WhatsApp DM to OWNER_JIDS)
                                 /send  → cap + cooldown → DM member → DM brain continues
                                 /edit  → replace draft text, then /send
                                 /skip  → suppress member for cooldown
```

### Components

| File | Responsibility |
|---|---|
| `src/roster.js` | Enumerate members of enabled groups via `groupFetchAllParticipating()` and `groupMetadata`; upsert the directory; resolve `@lid` → phone where possible; set `dmable`. |
| `src/signals.js` | Pre-filter group messages cheaply, then classify the survivors in one batched LLM call into structured signals. |
| `src/prospect.js` | Turn a signal into an eligible candidate and generate the outreach draft. |
| `src/outreach.js` | Owner commands, daily cap, per-member cooldown, sending, and the audit log. |

Reused unchanged: `src/llm.js`, `src/brain.js` (the DM brain that continues a
conversation after outreach), `knowledge/brief.md`, `src/leads.js`, and the
existing owner-command plumbing in `bot.js`.

`bot.js` gains: (a) a cheap append of live group messages to `prospect_messages`
for enabled groups, (b) a start/stop for the scan timer, (c) routing of the new
owner commands.

## 5. Data model — `data/prospect.db` (new SQLite file)

Kept separate from `data/memory.db` so the knowledge store stays clean.

```
groups(group_id PK, subject, policy, enabled, last_synced)
members(group_id, jid, phone, lid, push_name, business_guess,
        dmable, status, first_seen, last_seen, last_contacted,
        PRIMARY KEY(group_id, jid))
prospect_messages(id PK, group_id, sender_jid, sender_name, msg_id UNIQUE,
        ts, text, processed)
signals(id PK, group_id, sender_jid, msg_id, ts, text,
        business, need, intent, confidence)
candidates(id PK, group_id, sender_jid, business, intent, signal_ids,
        draft, status, created, decided, sent_at)
outreach(id PK, candidate_id, sender_jid, text, sent_at, outcome)
meta(key PK, value)
```

- `status` on a member: `member` | `signal` | `drafted` | `sent` | `suppressed`.
- `candidates.status`: `pending` | `sent` | `skipped`.
- `meta` holds the scan cursor and the daily counter (keyed by date).

## 6. Detection and drafting

### Pre-filter (`signals.js`)

A message is a candidate for classification only if it: is from a member (not the
bot/owner), has ≥ `SIGNAL_MIN_CHARS` (default 40) of letters, is not a broadcast
or mass-tag, is not link-only, and has not already been classified.

### Batched classification

Every `SCAN_INTERVAL_MIN` (default 10) the timer takes unprocessed
`prospect_messages` and makes **one** LLM call requesting per-message JSON:

```json
{ "index": 3, "is_signal": true, "business": "tour operator",
  "need": "landing page + booking", "intent": "sales", "confidence": 0.8 }
```

On first connect it backfills the last `BACKFILL_HOURS` (default 72) so it does
not start blind. A message with `is_signal` true and `confidence ≥
OUTREACH_MIN_CONFIDENCE` becomes a `signals` row.

### Eligibility (`prospect.js`)

A signal becomes a candidate only if: the group is enabled, the member is
`dmable`, the member has not been `sent`/`suppressed` within
`OUTREACH_COOLDOWN_DAYS`, there is no pending candidate for that member, and the
daily cap is not reached.

### Drafting

One LLM call per candidate, grounded in `knowledge/brief.md` plus the triggering
signal. Requirements: short; references the member's actual post softly (never
creepy); pitches the matching Nutekh pillar using **published facts only**; one
clear offer; asks one question; no invented claims; no mention of the group's
internal mechanics or that a bot is scanning.

## 7. Owner experience

A live card is DM'd to every `OWNER_JIDS` number when a candidate is ready:

```
*PROSPECT #12*  (group: Tour Operators TZ · external)
Member: Juma (2507…)
Business: tour operator
Signal: "launching a Serengeti promo, need a landing page + booking"
Draft:
"Hi Juma — I'm Nutekh's assistant. Saw your Serengeti promo post. If you
need a page that takes bookings directly, that's exactly what we set up…"
Reply: /send 12 · /edit 12 <text> · /skip 12
```

| Command | Action |
|---|---|
| `/prospects` | List pending candidates. |
| `/members <group>` | Roster with business guess and status. |
| `/send <id>` | Enforce cap + cooldown, send the draft to the member. |
| `/edit <id> <text>` | Replace the draft, then `/send`. |
| `/skip <id>` | Mark `suppressed`; no re-draft for the cooldown. |

After `/send`, the message is recorded in the member's DM thread memory so the
normal brain answers their reply with context.

## 8. Safety envelope

- `PROSPECT_ENABLED=0` by default — a hard kill switch.
- Only groups in `PROSPECT_GROUPS` are scanned (separate from `ANSWER_GROUPS`).
- Signal-based only; non-posters are roster entries, never drafted.
- Owner approval is mandatory; no auto-send path exists.
- Per-member cooldown (30 days) + daily cap (5) + min confidence (0.6) gate
  every draft and every send.
- `external` groups use the stricter cap and require higher confidence than
  `owned` groups. A newly discovered group defaults to **`external`** until the
  owner marks it `owned`.
- `dmable:false` members are shown but never drafted.
- Every send appends to `data/outreach.jsonl` for audit.
- v1 does **not** announce the bot's presence; the owner may announce it
  manually in groups they run.

## 9. Configuration (new `.env` keys)

| Key | Default | Purpose |
|---|---|---|
| `PROSPECT_ENABLED` | `0` | Kill switch for the whole feature. |
| `PROSPECT_GROUPS` | *(empty)* | Group ids eligible for scanning/drafting. |
| `SCAN_INTERVAL_MIN` | `10` | How often the scan timer runs. |
| `SIGNAL_MIN_CHARS` | `40` | Pre-filter minimum message length. |
| `BACKFILL_HOURS` | `72` | History scanned on first connect. |
| `OUTREACH_DAILY_CAP` | `5` | Max approved sends per day. |
| `OUTREACH_COOLDOWN_DAYS` | `30` | Per-member re-contact cooldown. |
| `OUTREACH_MIN_CONFIDENCE` | `0.6` | Minimum classifier confidence. |

Per-group `policy` (`owned`/`external`) is stored in the `groups` table and can be
set via an owner command or config.

## 10. Testing

Unit tests with a stubbed LLM (no network):

- Roster upsert and `dmable` resolution.
- Pre-filter acceptance/rejection.
- Signal JSON parsing (including malformed output).
- Eligibility: cap, cooldown, dedupe, `dmable`.
- Owner command parsing (`/send` `/edit` `/skip` `/prospects`).
- Drafter grounding: no invented facts, published ranges only.

## 11. Phasing

1. **Phase 1 — see.** Roster sync + scan cursor + signal classification, surfaced
   read-only via `/prospects` and `/members`. No drafts, no sends.
2. **Phase 2 — draft + approve.** Drafting, owner cards, `/send` `/edit` `/skip`,
   cap/cooldown enforcement, thread seeding.
3. **Phase 3 — tune.** Per-group policy tuning, audit log, confidence thresholds.

## 12. Known limitations

1. **Message requests.** A cold DM from the assistant number to a non-contact can
   land in the member's "Message requests" and be ignored; delivery cannot be
   forced.
2. **`@lid` / hidden numbers.** Some members are not DM-able; the roster marks
   them `dmable:false`.
3. **Ban risk is reduced, not removed.** Even a handful of approved DMs/day from
   a Baileys number can be reported.
4. **Stored personal data.** Member phone numbers live in `prospect.db`;
   operating this feature means holding that data.
5. **Classifier judgement.** Batched LLM classification can miss subtle signals
   or flag weak ones; thresholds are tunable and the owner is always the gate.

## 13. Open questions

None blocking. The two judgement calls above (new-group policy defaults to
`external`; no bot announcement in v1) are resolved and can be revisited during
Phase 3 tuning.

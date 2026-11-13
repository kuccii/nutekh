# How the bot generates leads

The assistant's commercial job is to turn a WhatsApp conversation into a
**qualified, actionable lead** — or a support case — and hand it to a human,
without the customer feeling like they filled in a form.

A "lead" here is a JSON record with a business, a contact, and a stated need. It
is captured in two ways: the model marks it, and a second pass catches it when
the model forgets. Then it is stored, deduped, and sent to the owner.

---

## 1. The funnel the bot is instructed to run

This lives in the `SALES FLOW` and `SUPPORT FLOW` sections of the persona in
`src/brain.js`.

**Sales (new enquiry):**

1. Answer what was actually asked, first.
2. Ask **one** useful qualifying question at a time — business type, current
   tools, what is slowing them down, budget range, or timeline.
3. Once at least three of those are known, offer the **free 30-minute audit**
   and confirm the best way to reach them.
4. Capture the lead.

**Support (existing client):**

1. Be brief and useful.
2. Collect: business name, what is happening, how urgent, and the best contact.
3. Promise a human follow-up during working hours (Mon–Fri, 9:00–18:00 EAT).
   Never promise an exact response time.
4. Mark it as a support hand-off.

The bot qualifies; it does not quote custom work. Anything outside the published
packages is handed to a human.

---

## 2. How a lead is actually captured — two paths

### Path A — the model marks it (preferred)

The persona tells the model that when — and only when — a conversation has
enough detail, it must append one final line:

```
[[LEAD: {"type":"sales","business":"...","contact":"...","need":"...","location":"...","budget":"...","timeline":"...","notes":"..."}]]
```

with these rules:

- `type` is `sales` for a new enquiry, `support` for an existing-client issue.
- Use **only** facts the customer actually gave; write `"unknown"` for anything
  missing.
- At least three fields must be genuinely known.
- Never mention the line or the tag to the customer.

`parseMarkers()` in `src/brain.js` strips the line out of the reply, parses the
JSON, and returns the lead alongside the customer-facing text.

### Path B — the second pass (fallback)

Models are not perfectly obedient. In live testing the model answered a
fully-qualified enquiry correctly but **omitted the marker**, which would have
silently dropped the lead.

So when no marker is present, the bot runs a small second pass:

```
answerDM()
  └─ no [[LEAD]] in the reply?
       └─ shouldExtract(text, history) ?
            ├─ message ≥ LEAD_EXTRACT_MIN_CHARS (default 50), or
            └─ customer has taken ≥ 2 turns
                 └─ extractLead() → chatJSON() re-reads the conversation
                      └─ normalizeLeadCandidate() → needs ≥ 3 known fields
```

- `shouldExtract()` keeps this cheap: short one-off questions ("How much is
  Grow?") never trigger a second LLM call.
- `extractLead()` asks a strict extractor prompt for the same JSON shape.
- `normalizeLeadCandidate()` treats `""`, `unknown`, `n/a`, `-`, `none` and
  similar placeholders as **missing**, and returns nothing unless at least three
  real fields survive.

If the model did its job, Path A is used and no extra call happens.

---

## 3. The lead record

Each lead is one JSON line appended to `data/leads.jsonl`:

```json
{
  "at": "2026-11-13T11:01:28.431Z",
  "type": "sales",
  "business": "hardware shop",
  "contact": "+250788000000",
  "need": "reliable stock and POS, moving off Excel",
  "location": "Kigali",
  "budget": "TZS 5 million",
  "timeline": "next month",
  "notes": "Wants to talk.",
  "from": "250788000000@s.whatsapp.net",
  "fromName": "Eric",
  "channel": "dm",
  "source": "fallback",
  "transcript": [
    { "role": "user", "text": "Hi, I run a hardware shop in Kigali..." },
    { "role": "assistant", "text": "Hi Eric! ..." }
  ]
}
```

| Field | Meaning |
|---|---|
| `type` | `sales` or `support`. |
| `business`, `contact`, `need`, `location`, `budget`, `timeline` | The qualified fields. Empty string when not given. |
| `notes` | One line of extra context. |
| `from`, `fromName` | The WhatsApp JID and push name. |
| `channel` | `dm` or `group`. |
| `source` | **`marker`** if the model emitted it, **`fallback`** if the second pass recovered it. |
| `transcript` | The last few turns, so the owner has context. |

Field values are trimmed and capped at 500 characters. Writing the file is
best-effort: a failure to record never breaks the customer conversation.

---

## 4. What the owner receives

Every captured lead is sent on WhatsApp to each number in `OWNER_JIDS`:

```
*NEW LEAD*
Business: hardware shop
Contact: +250788000000
Need: reliable stock and POS, moving off Excel
Location: Kigali
Budget: TZS 5 million
Timeline: next month
Notes: Wants to talk.
Channel: dm
WhatsApp: 250788000000@s.whatsapp.net
Time: 2026-11-13T11:01:28.431Z
```

Support cases use the same layout with a `*SUPPORT REQUEST*` heading. If
`RESEND_API_KEY` is set, the same text is also emailed to `RESEND_TO`.

Owner commands (DM from an `OWNER_JIDS` number):

| Command | Action |
|---|---|
| `/ping` | uptime check |
| `/stats` | knowledge rows, groups, DM mode |
| `/leads` | the last 5 leads / support requests |

> **If the assistant number is also the owner number:** alerts land in that
> phone's own "Message yourself" chat, and owner commands will **not** work from
> it (messages from the bot's own phone arrive as `fromMe` and are ignored —
> which is also what prevents a self-reply loop). Add a separate personal number
> to `OWNER_JIDS` to get alerts *and* commands there.

---

## 5. Dedupe — one lead, not five

A real conversation often re-states the same need across several messages. To
avoid five alerts for one opportunity:

- A new lead is compared against recent records on **`from` + `business` +
  `need`**.
- If a match exists within `LEAD_DEDUPE_HOURS` (default **6**), the new attempt
  is dropped: nothing is appended, and the owner is **not** re-alerted.
- A genuinely **different** need from the same contact is a new lead.

The duplicate check returns the original record (flagged `deduped: true`), so
callers can still see what was already captured.

---

## 6. Reading and tuning

```bash
# everything, newest last
cat /opt/nutekh-bot/data/leads.jsonl

# just sales leads
jq -c 'select(.type=="sales")' /opt/nutekh-bot/data/leads.jsonl

# how many were recovered by the fallback rather than the marker
jq -r '.source' /opt/nutekh-bot/data/leads.jsonl | sort | uniq -c

# from WhatsApp, as an owner
/leads
```

| Knob | Default | Effect |
|---|---|---|
| `LEAD_EXTRACT_MIN_CHARS` | `50` | Lower = the fallback runs on shorter messages (more catches, more LLM calls). |
| `LEAD_DEDUPE_HOURS` | `6` | How long a repeat of the same need is suppressed. |
| `SALES FLOW` / `LEAD CAPTURE` in `src/brain.js` | — | What the bot asks and when it decides a lead is ready. |
| `knowledge/brief.md` | — | The facts the bot may quote while qualifying. |

### A useful health signal

Watch the `marker` vs `fallback` split. If most leads are `fallback`, the model
is ignoring the marker instruction and the persona wording should be tightened.
If it is mostly `marker`, Path A is doing the work and the fallback is a safety
net — which is exactly the intent.

---

## 7. Worked example (real, from the live bot)

**Customer:**

> Hi, I run a hardware shop in Kigali. We use Excel and a POS we don't trust.
> Budget is around TZS 5 million and we want to start next month. I am Eric,
> reach me on +250788000000. Which package fits and can we talk?

**Bot reply:** recommends **Grow** (budget fits the TZS 4M–12M range), explains
it connects WhatsApp, mobile money and existing tools, and offers the free
30-minute audit.

**Capture:** the model answered well but **omitted the marker**, so the second
pass ran and produced:

```
source: fallback
business: hardware shop
contact:  +250788000000
need:     reliable stock and POS, moving off Excel
location: Kigali
budget:   TZS 5 million
timeline: next month
```

→ one line in `data/leads.jsonl`, one owner alert, and a repeat of the same
enquiry deduped to nothing.

---

## 8. Limits and what could come next

**Today (v1):**

- Leads live in a JSONL file. There is **no CRM sync**.
- Alerting is WhatsApp (+ optional Resend email). No ticketing.
- The bot qualifies and hands off; it does not book the audit itself.

**Natural next steps, if wanted:**

- Push leads into a CRM or Google Sheet instead of (or as well as) JSONL.
- Capture the audit booking (calendar link or slot picking) instead of just
  offering it.
- Follow-up nudges for leads that went quiet, and a daily digest to the owner.
- A small dashboard over `leads.jsonl` (counts by source, package, and
  conversion).

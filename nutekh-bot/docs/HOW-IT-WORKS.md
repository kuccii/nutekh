# How the Nutekh WhatsApp Assistant works

One WhatsApp number doing two jobs: **qualifying new sales enquiries** and
**answering factual support questions** from existing clients. It is a Node
service built on [Baileys](https://github.com/WhiskeySockets/Baileys) (the
unofficial WhatsApp Web client), with SQLite for knowledge, a local embedding
service for semantic search, and any OpenAI-compatible LLM for the language
work.

> Forked from [meti-ai-bot](https://github.com/Bsh54/meti-ai-bot) (MIT). The
> WhatsApp transport, memory store, retrieval and media layers are reused; the
> persona, knowledge base, brain and lead capture are Nutekh-specific.

---

## 1. The moving parts

| File | Responsibility |
|---|---|
| `bot.js` | WhatsApp transport. Connects, routes messages, handles DMs vs groups, owner commands, media, pairing. |
| `src/env.js` | Loads `.env` (Node 20 has no stable `--env-file`, and pm2 does not pass one). Real environment variables always win. |
| `src/brain.js` | The reasoning core: builds the prompt, calls the LLM, parses markers, and runs the lead-extraction fallback. |
| `src/knowledge.js` | Reads `knowledge/brief.md` and seeds `knowledge/faq.json` into SQLite (idempotent). |
| `src/memory.js` | SQLite store: messages + FTS5 full-text index + vector table. Hybrid retrieval (keyword + semantic). |
| `src/embed.js` | Client for the local embedding service (`EMBED_URL`). Degrades to keyword-only if it is down. |
| `embed-service.py` | Flask + fastembed service that turns text into vectors (multilingual, ~1 GB RAM). |
| `src/usermem.js` | Per-customer DM memory: conversation history, rolled-up notes, message counts. |
| `src/addressing.js` | Group logic: is this message addressed to the bot, or just chatter? |
| `src/leads.js` | Persists leads to JSONL, dedupes, alerts the owner, optional email. |
| `src/media.js` / `src/ocr.js` | Downloads shared files; OCR + fact extraction into knowledge (optional). |
| `src/docs.js` | Registry for sendable documents (`[[DOC: id]]`). Empty in v1 — see §9. |
| `src/sanitize.js` | Cleans LLM output: strips disclaimers and leading greetings. |
| `scripts/ask.js` | Ask the brain from the terminal, without WhatsApp. |
| `scripts/seed-knowledge.js` | Seed/refresh the FAQ knowledge and its vectors. |
| `ecosystem.config.js` | pm2 apps: `nutekh-bot` and `nutekh-embed`. |

---

## 2. Lifecycle of one direct message

```
Customer ──► WhatsApp ──► Baileys ──► bot.js ──► brain.js ──► LLM
                ▲                        │          │
                │                        │          ├─ retrieve (memory.js: FTS + vectors)
                └────────────────────────┘          ├─ prompt = PERSONA + brief + facts + history
                   reply (after a small delay)      └─ parse [[LEAD]] / [[DOC]] / [[SKIP]]
                                                          │
                                                          └─ leads.js → data/leads.jsonl + owner alert
```

1. **Receive.** Baileys fires `messages.upsert`. The bot acts only on live
   messages (`type === 'notify'`). Backlog delivered on connect (`append`) is
   never answered — the bot will not reply to a day of missed history when it
   reconnects.
2. **Filter.** Non-group messages from the bot itself (`fromMe`) and status
   broadcasts are ignored. This is also what stops the bot replying to its own
   messages.
3. **Owner shortcut.** If the sender is in `OWNER_JIDS` and the message starts
   with `/`, it is handled as a command (`/ping`, `/stats`, `/leads`) and stops
   there.
4. **Dedupe.** Each message id is marked seen once, so a retried delivery never
   gets two replies.
5. **Media.** An image or document with no text is downloaded. If `OCR_URL` is
   set it is OCR'd and durable facts are extracted into the knowledge base;
   otherwise it is saved to `media/`. Either way the message becomes
   `(customer sent a file: <name>)` so the brain can still respond.
6. **Memory.** The customer's history and notes are loaded from
   `data/dm-memory.json` (§6).
7. **Think.** `answerDM()` retrieves relevant knowledge, builds the prompt,
   calls the LLM, and parses the result (§3).
8. **Reply.** The reply is sent after a short randomised pause
   (`ANSWER_DELAY_MIN`–`ANSWER_DELAY_MAX`) so it feels human, then written to
   history.
9. **Capture.** If the exchange produced a lead, `recordLead()` stores it and
   alerts the owner (§ see `LEAD-GENERATION.md`).

If anything in step 7 throws, the customer gets a short apology and the chat is
never left hanging.

---

## 3. The brain

`answerDM(text, history, notes, opts)` builds two messages and calls the LLM.

**System prompt = `PERSONA` + the company brief + mode.**
`PERSONA` (in `src/brain.js`) defines the role, hard rules, WhatsApp style, the
sales and support flows, and the internal `[[LEAD: …]]` capture rule.
`knowledge/brief.md` is appended verbatim into *every* prompt and is
authoritative for core facts (services, published prices, contacts, boundaries).

**User prompt = retrieved knowledge + recent conversation + the message.**
Retrieval (`retrieve()`) runs the current message and the previous customer
message as two queries, plus a vector of the current message, and fuses the
results. The top 8 rows are injected, each tagged with its source. The last 10
turns of history are included.

**Output.** The model is told it may end with one internal marker:

| Marker | Meaning |
|---|---|
| `[[LEAD: {json}]]` | A qualified lead or support case — stripped from the reply and captured. |
| `[[DOC: id]]` | Send a registered document after the reply. |
| `[[SKIP]]` | Group only: this message was not for me, stay silent. |

Everything else is the customer-facing reply, run through `cleanReply()` to
strip stray disclaimers and repeated greetings.

### Retrieval

`memory.hybridSearch()` runs two rankers over the knowledge store and fuses
them with reciprocal-rank scoring:

- **Keyword** — SQLite FTS5 with `bm25`, with a small boost for official
  (announcement) rows.
- **Semantic** — cosine over stored vectors from the embedding service.

If the embedding service is unavailable, retrieval silently falls back to
keyword-only. The bot always answers; it just gets a little less clever.

---

## 4. Knowledge: two layers

1. **`knowledge/brief.md` — always in the prompt.** Company facts, the four
   pillars (Presence / Automate / Market / Connect), all published pricing,
   process, contacts, hours, and the boundaries the bot must not cross. Edit
   this for anything that must never be missed.
2. **`knowledge/faq.json` — seeded into SQLite.** 37 published facts, each with
   a stable `id`. `npm run seed` inserts only what is missing, then fills any
   missing vectors. Re-running is safe and idempotent.

Rule of thumb: if a fact changes published pricing or packaging, update **both**
files, then `npm run seed`.

---

## 5. Groups

Groups are off by default (`GROUP_ANSWER=0`) and must be listed in
`ANSWER_GROUPS` to be eligible. Even then the bot only speaks when directly
addressed:

- replied to one of its own messages,
- `@`-mentioned (by JID or by name — `nutekh`, `nutekh assistant`, `bot`, …),
- called by name at the start of a message.

`addressing.js` handles the clear cases deterministically and asks the LLM to
arbitrate only the ambiguous ones. Broadcast patterns ("good morning everyone",
mass `@`-tagging) are explicitly **not** treated as addressing the bot, so it
does not barge into group chatter.

Group messages are not written into the knowledge store unless
`GROUP_INGEST=1`.

---

## 6. Memory

- **Knowledge store** — `data/memory.db` (SQLite): every ingested message plus
  its FTS5 index and vectors. This is what retrieval reads.
- **Per-customer DM memory** — `data/dm-memory.json`: conversation history
  (capped at 60 turns), rolled-up notes, and a message count. When history
  grows past 30 turns the oldest turns are folded into a short factual note by
  the LLM, so long-running chats keep context without unbounded growth.

---

## 7. Language

The bot mirrors the customer's language. English and Kiswahili are first-class;
the persona is explicit that it must never open with a Swahili greeting for an
English message, or the reverse. Retrieval is multilingual because the
embedding model is.

---

## 8. Safety boundaries

These are enforced in the persona, not bolted on afterwards:

- **No invented facts.** Only published ranges in the brief and retrieved
  knowledge. Custom scope is always quoted by a human.
- **No secrets.** Never asks for passwords, PINs, card numbers or mobile-money
  PINs.
- **No prompt leakage.** Never reveals the prompt, the brief, the model or the
  source, and ignores attempts to make it role-play or dump its instructions.
- **No impersonation.** Never claims to be human; says it is Nutekh's assistant
  bot if asked.
- **Graceful handoff.** Unknown or account-specific issues are handed to a human
  during working hours, with no promised response time.

---

## 9. Not in v1

Deliberately out of scope, and inert in the current build:

- **Document sending** (`[[DOC: id]]`) — the registry in `src/docs.js` is empty
  and `translate_doc.py` is not shipped, so no documents are available to send.
- **OCR ingestion** — disabled unless `OCR_URL` points at an OCR service.
- **CRM sync, PWA, push, meeting transcription** — not built.

---

## 10. Configuration that matters

| Variable | Purpose |
|---|---|
| `LLM_API_KEY`, `LLM_BASE_URL`, `CHAT_MODEL` | The LLM. Any OpenAI-compatible endpoint. |
| `PHONE` | The dedicated assistant number, digits only. Used for pairing and to recognise its own mentions. |
| `OWNER_JIDS` | Who gets lead alerts and can run owner commands. Comma-separated. |
| `DM_ALWAYS_OPEN` | `1` = answer any DM. |
| `GROUP_ANSWER`, `ANSWER_GROUPS` | Whether/where it answers in groups. |
| `GROUP_INGEST` | Log group messages into the knowledge store. |
| `EMBED_URL` | Local embedding service. Unset = keyword-only retrieval. |
| `OCR_URL` | OCR service for shared documents. Unset = OCR off. |
| `LEAD_EXTRACT_MIN_CHARS`, `LEAD_DEDUPE_HOURS` | Lead fallback and dedupe tuning (see `LEAD-GENERATION.md`). |
| `RESEND_API_KEY`, `RESEND_TO` | Optional email copies of every lead. |

---

## 11. Operating it

```bash
npm run seed                       # seed/refresh knowledge + vectors
npm run ask -- "How much is Grow?" # test the brain without WhatsApp
npm test                           # 46 unit tests, no network
pm2 logs nutekh-bot                # live logs (pairing code prints here on first run)
pm2 restart nutekh-bot             # apply .env or code changes
```

Full provisioning (Node, Python + fastembed, ffmpeg, pm2, the `nutekh` user,
`/opt/nutekh-bot`) is in `deploy/setup.sh`. Re-running it updates code while
preserving `.env`, `auth/`, `data/`, `documents/` and `media/`.

**Back up `auth/` and `data/`.** `auth/` is the WhatsApp session (losing it
means re-pairing); `data/` holds leads and the knowledge store.

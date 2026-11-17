# Nutekh WhatsApp Assistant

A WhatsApp assistant for Nutekh that does two jobs on one number:

- **Sales** — explains Nutekh's services, products, packages and published prices,
  qualifies prospects, and books the free 30-minute audit.
- **Support** — answers factual questions from existing clients and hands account,
  custom, legal or complaint issues to a human.

It is built on the open-source [meti-ai-bot](https://github.com/Bsh54/meti-ai-bot)
whatsapp-bot (MIT). The WhatsApp, memory, retrieval and media layers are reused;
the persona, brain, knowledge base and lead capture are Nutekh-specific.

## Documentation

- **[How it works](docs/HOW-IT-WORKS.md)** — architecture, the lifecycle of a
  message, the brain and retrieval, knowledge, memory, groups, safety, and
  operations.
- **[How it generates leads](docs/LEAD-GENERATION.md)** — the qualification
  funnel, the two capture paths, the lead record, owner alerts, dedupe, and how
  to read and tune it.

---

## Requirements

| Piece | Version | Notes |
|---|---|---|
| Node.js | 20+ | runs the bot |
| Python | 3.10+ | optional embed service |
| SQLite | bundled | via `better-sqlite3` |
| WhatsApp number | dedicated | **not** the main business line |
| LLM | any OpenAI-compatible API | key + base URL + model |

> **Use a dedicated SIM.** The connection uses Baileys, an unofficial WhatsApp
> client. Ban risk is real, and it is the reason this must never run on the main
> business number. If that risk is unacceptable, use the official WhatsApp Cloud
> API instead — it is a different build.

---

## Quick start (local)

```bash
cd nutekh-bot
npm install
cp .env.example .env        # then edit LLM_API_KEY, PHONE, OWNER_JIDS
```

Set at minimum:

```ini
LLM_API_KEY=sk-...
LLM_BASE_URL=https://api.openai.com/v1
CHAT_MODEL=gpt-4.1-mini
PHONE=2507XXXXXXXX
OWNER_JIDS=2507XXXXXXXX
```

Seed the knowledge base and test an answer **without** WhatsApp:

```bash
npm run seed
npm run ask -- "How much is the Grow package?"
```

Expected: Grow quoted as **RWF 2M – 6M (USD 1,500 – 4,500)**, retainer from
**RWF 350K/month**, with a question back.

### Optional: embeddings

Hybrid search falls back to keyword search when no vectors exist. To enable
semantic retrieval:

```bash
python -m venv .venv
.venv/bin/pip install flask fastembed numpy
.venv/bin/python embed-service.py      # listens on 127.0.0.1:7867
npm run seed                           # now fills embeddings
```

On Windows use `.venv\Scripts\python`.

### Start the bot

```bash
npm start
```

First run prints a pairing code:

1. Open WhatsApp on the dedicated phone.
2. **Linked devices → Link with phone number.**
3. Enter the printed code.

Credentials are stored in `auth/`. Once paired, restarts reconnect without a
new code. Deleting `auth/` forces a fresh pairing.

---

## Behaviour

- **DMs** — answers anyone by default (`DM_ALWAYS_OPEN=1`). History and notes are
  kept per customer in `data/dm-memory.json`.
- **Groups** — silent unless directly addressed (name, `@mention`, or a reply to
  one of its messages). `GROUP_ANSWER=0` disables group replies entirely.
- **Languages** — replies in the customer's language, with **English as the
  default**; Kinyarwanda, French and Swahili are mirrored when the customer uses them.
- **Prices** — only the published ranges. Custom scope goes to a human.
- **Timelines** — "about 7 days" (Launch) and "about 30 days" (Grow) are typical
  figures, never promises.

Owner commands (DM only, from an `OWNER_JIDS` number):

| Command | Action |
|---|---|
| `/ping` | uptime check |
| `/stats` | knowledge rows, groups, DM mode |
| `/leads` | last 5 leads/support requests |

---

## Group prospecting

Off by default (`PROSPECT_ENABLED=0`). When enabled, the bot watches the groups
it is in for messages that reveal a business need Nutekh could serve (a promo
that needs a page, a process that could be automated), drafts a short
first-contact message, and DMs **you** an approval card. Nothing is ever sent to
a member until you approve it with `/send`, and a daily cap, a per-member
cooldown and a confidence floor gate every draft and every send.

Once `PROSPECT_ENABLED=1`, **adding the bot to a group is the only action
required** — the group auto-enrols and prospecting starts. It works even where
the bot stays silent, because prospecting is independent of group answering
(`GROUP_ANSWER` / `ANSWER_GROUPS`).

Owner commands (DM only, from an `OWNER_JIDS` number):

| Command | Action |
|---|---|
| `/prospects` | list pending candidates |
| `/groups` | list discovered groups (subject, members, policy, on/off) |
| `/members <group>` | roster with business guess and status |
| `/prospect on\|off\|own <group>` | enable, disable, or mark a group `owned` (looser limits) |
| `/send <id>` | enforce cap + cooldown, send the draft to the member |
| `/edit <id> <text>` | replace the draft, then send |
| `/skip <id>` | suppress the candidate (no re-draft during the cooldown) |

Config lives in `.env` (`PROSPECT_GROUPS`, `SCAN_INTERVAL_MIN`,
`SIGNAL_MIN_CHARS`, `BACKFILL_HOURS`, `OUTREACH_DAILY_CAP`,
`OUTREACH_COOLDOWN_DAYS`, `OUTREACH_MIN_CONFIDENCE`). Leave `PROSPECT_ENABLED=0`
unless you intend to prospect; every send is recorded in `data/outreach.jsonl`.
`PROSPECT_ENABLED=0` stops the automatic pipeline (watching, drafting and
cards); the owner commands above still work, so you can always act on a card you
already have — nothing is ever sent to a member without an explicit owner
command (`/send` or `/edit`).

---

## Knowledge

Two layers keep answers correct:

1. `knowledge/brief.md` — injected into **every** prompt. Company facts, four
   focus areas, all published pricing, process, contacts, boundaries.
2. `knowledge/faq.json` — seeded into SQLite and used by hybrid search for
   detail. Each entry has a stable `id`; re-seeding updates nothing and
   duplicates nothing.

Editing rules:

- Change published facts in **both** files if they affect pricing or packages.
- Run `npm run seed` after editing `faq.json`.
- Keep the assistant's hard rules in `src/brain.js` (`PERSONA`).
- Never put customer-specific or secret data in these files.

Documents shared in allowed groups can be OCR'd into knowledge if `OCR_URL` is
set (`GROUP_INGEST=1` for message logging). Document delivery to customers is
available through the `[[DOC: id]]` marker and the registry in `src/docs.js`.

---

## Leads

When a conversation qualifies, the brain appends a `[[LEAD: {...}]]` marker to
its reply. If the model answers a substantial enquiry (50+ characters, or after
the customer has replied at least twice) **without** that marker, a small second
pass re-reads the conversation and extracts the same fields, so a genuine lead is
not lost. A second-pass lead needs at least three known fields to count.

Every lead or support request is then:

1. appended to `data/leads.jsonl`;
2. sent to every `OWNER_JIDS` number on WhatsApp;
3. emailed through Resend if `RESEND_API_KEY` is set.

Each record carries a `source` (`marker` or `fallback`) so you can see how it was
captured. The same contact asking the same thing again within
`LEAD_DEDUPE_HOURS` (default 6) is treated as one lead: no duplicate record and
no second alert.

Lead capture is best-effort: a failure to notify never breaks the customer chat.

---

## Deploy (Ubuntu 22.04 / 24.04)

No inbound ports, domain or TLS are needed — the bot connects outbound.

```bash
# on the server, from the nutekh-bot folder
sudo bash deploy/setup.sh
sudo nano /opt/nutekh-bot/.env        # secrets
sudo -u nutekh -H bash -lc 'cd /opt/nutekh-bot && npm run seed'
sudo -u nutekh -H bash -lc 'cd /opt/nutekh-bot && npm run ask -- "How much is Launch?"'
sudo -u nutekh -H env PATH="$PATH" pm2 logs nutekh-bot   # pairing code
```

The script installs Node 20, Python + fastembed, ffmpeg and pm2, creates the
`nutekh` user, copies the app to `/opt/nutekh-bot`, and starts:

- `nutekh-bot` — the WhatsApp client
- `nutekh-embed` — the embedding service

Re-running the script updates code while preserving `.env`, `auth/`, `data/`,
`documents/` and `media/`.

Back up `auth/` and `data/` regularly (they contain the session and leads).

---

## Tests

```bash
npm test
```

Covers marker parsing, the lead-extraction fallback, lead normalisation,
deduplication and recording, group addressing rules, knowledge seeding
idempotency, and the published-price guard in the brief. Tests use a temporary
data directory and never call the LLM.

To exercise the real model, use `npm run ask`.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `Missing LLM_API_KEY` | `.env` not created or not filled |
| Replies are generic | `npm run seed` not run, or embed service down |
| `pairing code error` | number not in international format (digits only) |
| Disconnects with `loggedOut` | session revoked; delete `auth/` and pair again |
| Bot silent in a group | not addressed, or `GROUP_ANSWER=0`, or group not in `ANSWER_GROUPS` |
| No lead alerts | `OWNER_JIDS` empty or wrong format |
| SQLite build error | install build tools; Node 20+ is required |

Logs: `logs/messages.txt`, `logs/messages.jsonl`, and pm2 logs on the server.

---

## Licence

MIT. The reused WhatsApp/memory/media modules come from
[meti-ai-bot](https://github.com/Bsh54/meti-ai-bot); the original licence is kept
in `LICENSE-UPSTREAM`.

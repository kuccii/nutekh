# Nutekh WhatsApp Assistant

A WhatsApp assistant for Nutekh that does two jobs on one number:

- **Sales** — explains Nutekh's services, products, packages and published prices,
  qualifies prospects, and books the free 30-minute audit.
- **Support** — answers factual questions from existing clients and hands account,
  custom, legal or complaint issues to a human.

It is built on the open-source [meti-ai-bot](https://github.com/Bsh54/meti-ai-bot)
whatsapp-bot (MIT). The WhatsApp, memory, retrieval and media layers are reused;
the persona, brain, knowledge base and lead capture are Nutekh-specific.

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
PHONE=2557XXXXXXXX
OWNER_JIDS=255754000000
```

Seed the knowledge base and test an answer **without** WhatsApp:

```bash
npm run seed
npm run ask -- "How much is the Grow package?"
```

Expected: Grow quoted as **TZS 4M – 12M (USD 1,500 – 4,500)**, retainer from
**TZS 600K/month**, with a question back.

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
- **Languages** — replies in the customer's language; English and Kiswahili are
  first-class.
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

When a conversation qualifies, the brain emits a `[[LEAD: {...}]]` marker. The
lead is then:

1. appended to `data/leads.jsonl`;
2. sent to every `OWNER_JIDS` number on WhatsApp;
3. emailed through Resend if `RESEND_API_KEY` is set.

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

Covers marker parsing, lead normalisation and recording, group addressing
rules, knowledge seeding idempotency, and the published-price guard in the
brief. Tests use a temporary data directory and never call the LLM.

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

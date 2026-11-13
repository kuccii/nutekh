const fs = require('fs')
const path = require('path')
const { db, addCurated, setVerified } = require('./memory')

const BRIEF_PATH = path.join(__dirname, '..', 'knowledge', 'brief.md')
const FAQ_PATH = path.join(__dirname, '..', 'knowledge', 'faq.json')

let _brief = ''
try { _brief = fs.readFileSync(BRIEF_PATH, 'utf8').trim() } catch (e) {
  console.warn('knowledge: could not read brief.md -', e.message)
}

function brief() { return _brief }

function faq() {
  try { return JSON.parse(fs.readFileSync(FAQ_PATH, 'utf8')) } catch (e) {
    console.warn('knowledge: could not read faq.json -', e.message)
    return []
  }
}

const existsStmt = db.prepare('SELECT id FROM messages WHERE msg_id = ?')

/**
 * Insert the published FAQ facts into memory. Idempotent: each fact has a stable
 * msg_id, so re-running only fills gaps.
 */
function ensureSeeded() {
  const rows = faq()
  let added = 0
  let skipped = 0
  for (const f of rows) {
    if (!f || !f.id || !f.text) continue
    const msgId = `seed:nutekh:${f.id}`
    if (existsStmt.get(msgId)) { skipped++; continue }
    const id = addCurated({
      msg_id: msgId,
      ts: Date.now(),
      group_id: 'seed:nutekh',
      group_name: 'Nutekh published knowledge',
      sender_id: 'nutekh',
      sender_name: 'Nutekh',
      text: f.text,
      source_role: 'admin',
      confidence: 1,
    })
    if (id) { setVerified(id, 1); added++ }
  }
  return { added, skipped, total: rows.length }
}

function pendingEmbeddings(limit = 500) {
  return db.prepare(
    `SELECT id, text FROM messages
     WHERE msg_id LIKE 'seed:nutekh:%' AND (superseded IS NULL OR superseded = 0)
       AND id NOT IN (SELECT id FROM vec)
     LIMIT ?`
  ).all(limit)
}

module.exports = { brief, faq, ensureSeeded, pendingEmbeddings, BRIEF_PATH, FAQ_PATH }

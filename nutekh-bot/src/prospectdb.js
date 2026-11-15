const Database = require('better-sqlite3')
const path = require('path')
const fs = require('fs')

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data')
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
const DB_PATH = path.join(DATA_DIR, 'prospect.db')
const OUTREACH_FILE = path.join(DATA_DIR, 'outreach.jsonl')

const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS groups (
    group_id    TEXT PRIMARY KEY,
    subject     TEXT,
    policy      TEXT DEFAULT 'external',
    enabled     INTEGER DEFAULT 1,
    last_synced INTEGER
  );

  CREATE TABLE IF NOT EXISTS members (
    group_id       TEXT,
    jid            TEXT,
    phone          TEXT,
    lid            TEXT,
    push_name      TEXT,
    business_guess TEXT,
    dmable         INTEGER DEFAULT 0,
    status         TEXT DEFAULT 'member',
    first_seen     INTEGER,
    last_seen      INTEGER,
    last_contacted INTEGER,
    PRIMARY KEY (group_id, jid)
  );

  CREATE TABLE IF NOT EXISTS prospect_messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id    TEXT,
    sender_jid  TEXT,
    sender_name TEXT,
    msg_id      TEXT UNIQUE,
    ts          INTEGER,
    text        TEXT,
    processed   INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS signals (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id   TEXT,
    sender_jid TEXT,
    msg_id     TEXT,
    ts         INTEGER,
    text       TEXT,
    business   TEXT,
    need       TEXT,
    intent     TEXT,
    confidence REAL,
    handled    INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS candidates (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id   TEXT,
    sender_jid TEXT,
    business   TEXT,
    intent     TEXT,
    signal_ids TEXT,
    draft      TEXT,
    status     TEXT DEFAULT 'pending',
    created    INTEGER,
    decided    INTEGER,
    sent_at    INTEGER
  );

  CREATE TABLE IF NOT EXISTS outreach (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    candidate_id INTEGER,
    sender_jid   TEXT,
    text         TEXT,
    sent_at      INTEGER,
    outcome      TEXT
  );

  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`)

// groups -------------------------------------------------------------------

const upsertGroupStmt = db.prepare(`
  INSERT INTO groups (group_id, subject, policy, enabled, last_synced)
  VALUES (@group_id, @subject, COALESCE(@policy, 'external'), COALESCE(@enabled, 1), @last_synced)
  ON CONFLICT(group_id) DO UPDATE SET
    subject     = COALESCE(@subject, subject),
    policy      = COALESCE(@policy, policy),
    enabled     = COALESCE(@enabled, enabled),
    last_synced = @last_synced
`)

function upsertGroup({ groupId, subject, policy, enabled }) {
  upsertGroupStmt.run({
    group_id: groupId,
    subject: subject == null ? null : String(subject),
    policy: policy == null ? null : String(policy),
    enabled: enabled == null ? null : (enabled ? 1 : 0),
    last_synced: Date.now(),
  })
}

const getGroupStmt = db.prepare('SELECT * FROM groups WHERE group_id = ?')
function getGroup(groupId) { return getGroupStmt.get(groupId) }

const listGroupsStmt = db.prepare('SELECT * FROM groups ORDER BY group_id ASC')
function listGroups() { return listGroupsStmt.all() }

const setGroupEnabledStmt = db.prepare('UPDATE groups SET enabled = ? WHERE group_id = ?')
function setGroupEnabled(groupId, enabled) { setGroupEnabledStmt.run(enabled ? 1 : 0, groupId) }

const setGroupPolicyStmt = db.prepare('UPDATE groups SET policy = ? WHERE group_id = ?')
function setGroupPolicy(groupId, policy) { setGroupPolicyStmt.run(String(policy), groupId) }

// members ------------------------------------------------------------------

const upsertMemberStmt = db.prepare(`
  INSERT INTO members (group_id, jid, phone, lid, push_name, dmable, first_seen, last_seen)
  VALUES (@group_id, @jid, @phone, @lid, @push_name, @dmable, @now, @now)
  ON CONFLICT(group_id, jid) DO UPDATE SET
    phone      = COALESCE(NULLIF(excluded.phone, ''), phone),
    lid        = COALESCE(NULLIF(excluded.lid, ''), lid),
    push_name  = COALESCE(NULLIF(excluded.push_name, ''), push_name),
    dmable     = MAX(dmable, excluded.dmable),
    last_seen  = excluded.last_seen
`)

function upsertMember({ groupId, jid, phone = '', lid = '', pushName = '', dmable = 0 }) {
  upsertMemberStmt.run({
    group_id: groupId,
    jid,
    phone: String(phone || ''),
    lid: String(lid || ''),
    push_name: String(pushName || ''),
    dmable: dmable ? 1 : 0,
    now: Date.now(),
  })
}

const getMemberStmt = db.prepare('SELECT * FROM members WHERE group_id = ? AND jid = ?')
function getMember(groupId, jid) { return getMemberStmt.get(groupId, jid) }

const listMembersStmt = db.prepare('SELECT * FROM members WHERE group_id = ? ORDER BY jid ASC')
function listMembers(groupId) { return listMembersStmt.all(groupId) }

const setMemberStatusStmt = db.prepare('UPDATE members SET status = ? WHERE group_id = ? AND jid = ?')
function setMemberStatus(groupId, jid, status) { setMemberStatusStmt.run(String(status), groupId, jid) }

const setMemberBusinessStmt = db.prepare('UPDATE members SET business_guess = ? WHERE group_id = ? AND jid = ?')
function setMemberBusiness(groupId, jid, business) { setMemberBusinessStmt.run(business == null ? null : String(business), groupId, jid) }

const markContactedStmt = db.prepare('UPDATE members SET last_contacted = ? WHERE group_id = ? AND jid = ?')
function markContacted(groupId, jid, ts) { markContactedStmt.run(ts, groupId, jid) }

const lastContactedAtStmt = db.prepare('SELECT last_contacted FROM members WHERE group_id = ? AND jid = ?')
function lastContactedAt(groupId, senderJid) {
  const row = lastContactedAtStmt.get(groupId, senderJid)
  return row && row.last_contacted != null ? row.last_contacted : null
}

// prospect_messages --------------------------------------------------------

const addMessageStmt = db.prepare(`
  INSERT OR IGNORE INTO prospect_messages
    (group_id, sender_jid, sender_name, msg_id, ts, text)
  VALUES (@group_id, @sender_jid, @sender_name, @msg_id, @ts, @text)
`)

function addMessage({ groupId, senderJid, senderName = '', msgId, ts, text }) {
  const info = addMessageStmt.run({
    group_id: groupId,
    sender_jid: senderJid,
    sender_name: String(senderName || ''),
    msg_id: msgId,
    ts,
    text,
  })
  return info.changes === 1
}

const pendingMessagesStmt = db.prepare(
  'SELECT * FROM prospect_messages WHERE processed = 0 ORDER BY ts ASC, id ASC LIMIT ?'
)
function pendingMessages(limit = 200) { return pendingMessagesStmt.all(limit) }

function markMessagesProcessed(ids) {
  const list = (Array.isArray(ids) ? ids : [ids]).filter((v) => v != null)
  if (!list.length) return
  const placeholders = list.map(() => '?').join(', ')
  db.prepare(`UPDATE prospect_messages SET processed = 1 WHERE id IN (${placeholders})`).run(...list)
}

// signals ------------------------------------------------------------------

const addSignalStmt = db.prepare(`
  INSERT INTO signals
    (group_id, sender_jid, msg_id, ts, text, business, need, intent, confidence)
  VALUES (@group_id, @sender_jid, @msg_id, @ts, @text, @business, @need, @intent, @confidence)
`)

function addSignal({ groupId, senderJid, msgId, ts, text, business = '', need = '', intent = '', confidence = 0 }) {
  const info = addSignalStmt.run({
    group_id: groupId,
    sender_jid: senderJid,
    msg_id: msgId,
    ts,
    text,
    business: String(business || ''),
    need: String(need || ''),
    intent: String(intent || ''),
    confidence: Number(confidence) || 0,
  })
  return Number(info.lastInsertRowid)
}

const unhandledSignalsStmt = db.prepare(
  'SELECT * FROM signals WHERE handled = 0 AND confidence >= ? ORDER BY id ASC'
)
function unhandledSignals(minConfidence) { return unhandledSignalsStmt.all(Number(minConfidence) || 0) }

const markSignalHandledStmt = db.prepare('UPDATE signals SET handled = 1 WHERE id = ?')
function markSignalHandled(id) { markSignalHandledStmt.run(id) }

// candidates ---------------------------------------------------------------

const createCandidateStmt = db.prepare(`
  INSERT INTO candidates
    (group_id, sender_jid, business, intent, signal_ids, draft, status, created)
  VALUES (@group_id, @sender_jid, @business, @intent, @signal_ids, @draft, 'pending', @created)
`)

function createCandidate({ groupId, senderJid, business, intent, signalIds, draft }) {
  const info = createCandidateStmt.run({
    group_id: groupId,
    sender_jid: senderJid,
    business: business == null ? null : String(business),
    intent: intent == null ? null : String(intent),
    signal_ids: signalIds == null ? '' : String(signalIds),
    draft: draft == null ? null : String(draft),
    created: Date.now(),
  })
  return Number(info.lastInsertRowid)
}

const getCandidateStmt = db.prepare('SELECT * FROM candidates WHERE id = ?')
function getCandidate(id) { return getCandidateStmt.get(id) }

const updateCandidateStmt = db.prepare(`
  UPDATE candidates SET
    status  = COALESCE(@status, status),
    draft   = COALESCE(@draft, draft),
    decided = COALESCE(@decided, decided),
    sent_at = COALESCE(@sent_at, sent_at)
  WHERE id = @id
`)
function updateCandidate(id, { status, draft, decided, sentAt } = {}) {
  updateCandidateStmt.run({
    id,
    status: status == null ? null : String(status),
    draft: draft == null ? null : String(draft),
    decided: decided == null ? null : decided,
    sent_at: sentAt == null ? null : sentAt,
  })
}

const listCandidatesStmt = db.prepare('SELECT * FROM candidates ORDER BY id DESC')
const listCandidatesByStatusStmt = db.prepare('SELECT * FROM candidates WHERE status = ? ORDER BY id DESC')
function listCandidates(status) {
  return status == null ? listCandidatesStmt.all() : listCandidatesByStatusStmt.all(status)
}

const hasPendingCandidateStmt = db.prepare(
  "SELECT 1 AS hit FROM candidates WHERE group_id = ? AND sender_jid = ? AND status = 'pending' LIMIT 1"
)
function hasPendingCandidate(groupId, senderJid) { return !!hasPendingCandidateStmt.get(groupId, senderJid) }

// outreach -----------------------------------------------------------------

const addOutreachStmt = db.prepare(`
  INSERT INTO outreach (candidate_id, sender_jid, text, sent_at, outcome)
  VALUES (@candidate_id, @sender_jid, @text, @sent_at, @outcome)
`)

function addOutreach({ candidateId, senderJid, text }) {
  const sentAt = Date.now()
  const outcome = null
  const info = addOutreachStmt.run({
    candidate_id: candidateId,
    sender_jid: senderJid,
    text: text == null ? null : String(text),
    sent_at: sentAt,
    outcome,
  })
  try {
    fs.appendFileSync(
      OUTREACH_FILE,
      JSON.stringify({ candidate_id: candidateId, sender_jid: senderJid, text, sent_at: sentAt, outcome }) + '\n'
    )
  } catch {
    // the audit log must never break a send
  }
  return Number(info.lastInsertRowid)
}

const countOutreachSinceStmt = db.prepare('SELECT COUNT(*) AS c FROM outreach WHERE sent_at >= ?')
function countOutreachSince(ts) { return countOutreachSinceStmt.get(ts).c }

// meta ---------------------------------------------------------------------

const getMetaStmt = db.prepare('SELECT value FROM meta WHERE key = ?')
function getMeta(key) {
  const row = getMetaStmt.get(key)
  return row ? row.value : null
}

const setMetaStmt = db.prepare(`
  INSERT INTO meta (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`)
function setMeta(key, value) { setMetaStmt.run(key, value == null ? null : String(value)) }

module.exports = {
  db,
  DB_PATH,
  OUTREACH_FILE,
  upsertGroup,
  getGroup,
  listGroups,
  setGroupEnabled,
  setGroupPolicy,
  upsertMember,
  getMember,
  listMembers,
  setMemberStatus,
  setMemberBusiness,
  markContacted,
  addMessage,
  pendingMessages,
  markMessagesProcessed,
  addSignal,
  unhandledSignals,
  markSignalHandled,
  createCandidate,
  getCandidate,
  updateCandidate,
  listCandidates,
  hasPendingCandidate,
  addOutreach,
  countOutreachSince,
  lastContactedAt,
  getMeta,
  setMeta,
}

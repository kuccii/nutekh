// Owner approval commands for group prospecting.
//
// The owner DMs the bot `/send <id>`, `/edit <id> <text>` and `/skip <id>` to
// act on the approval cards prospect.js (Task 4) sent, and uses `/prospects`,
// `/groups`, `/members <group>` and `/prospect on|off|own <group>` for the
// group-admin view. Nothing here messages a member except an explicit /send or
// /edit, and the daily cap is checked before any member message is attempted.
//
// bot.js owns the DM path: it calls `handleCommand` for owner DMs and falls
// through to its own commands when this returns false.

const db = require('./prospectdb')
const usermem = require('./usermem')

const COMMANDS = new Set(['prospects', 'groups', 'members', 'prospect', 'send', 'edit', 'skip'])

const DAY = 86400000

function envNumber(name, fallback) {
  const raw = process.env[name]
  if (raw == null || raw === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

function startOfToday(now) {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * Parse an owner DM into `{ cmd, args }`, or `null` when it is not a prospect
 * command so bot.js can fall through to its existing commands. `/edit` keeps
 * the replacement text as one unsplit argument (`/edit 12 hi there` →
 * `['12', 'hi there']`).
 */
function parseCommand(text) {
  const raw = String(text == null ? '' : text).trim()
  const m = /^\/([a-z]+)(?:\s+([\s\S]*))?$/i.exec(raw)
  if (!m) return null
  const cmd = m[1].toLowerCase()
  if (!COMMANDS.has(cmd)) return null

  const rest = (m[2] || '').trim()
  if (cmd === 'prospects' || cmd === 'groups') return { cmd, args: [] }
  if (cmd === 'members') return { cmd, args: rest ? [rest] : [] }

  if (cmd === 'prospect') {
    const sp = rest.indexOf(' ')
    if (sp === -1) return { cmd, args: rest ? [rest] : [] }
    return { cmd, args: [rest.slice(0, sp), rest.slice(sp + 1).trim()] }
  }

  // send / skip take one id; edit takes an id plus the unsplit replacement text.
  const sp = rest.search(/\s/)
  if (cmd === 'edit' && sp !== -1) {
    return { cmd, args: [rest.slice(0, sp), rest.slice(sp + 1).trim()] }
  }
  return { cmd, args: sp === -1 ? (rest ? [rest] : []) : [rest.slice(0, sp)] }
}

/** `ok:false, reason:'cap'` once the day's sends reach the cap. */
function capCheck({ sentToday, dailyCap }) {
  if (Number(sentToday) >= Number(dailyCap)) return { ok: false, reason: 'cap' }
  return { ok: true, reason: 'ok' }
}

async function safeReply(sock, jid, text) {
  try {
    await sock.sendMessage(jid, { text })
  } catch (e) {
    console.log('outreach: reply failed —', e && e.message)
  }
}

function memberJidFor(member) {
  if (!member || !member.dmable || !member.phone) return null
  return `${member.phone}@s.whatsapp.net`
}

function firstLine(text) {
  return String(text || '').split('\n')[0].trim()
}

/**
 * Deliver the draft for a pending candidate to its member and record the send.
 * `draftOverride` lets /edit send the freshly edited text without a re-read.
 * The cap is checked before the member is messaged; every outcome returns a
 * reply to the owner.
 */
async function sendCandidate(sock, jid, id, draftOverride) {
  const c = db.getCandidate(id)
  if (!c) return safeReply(sock, jid, `No candidate #${id}.`)
  if (c.status !== 'pending') return safeReply(sock, jid, `Candidate #${id} is already ${c.status}.`)

  // R13: read the cap per call, not at module load, so a changed env is
  // honoured at runtime. Local midnight bounds the day's sends.
  const sentToday = db.countOutreachSince(startOfToday(Date.now()))
  const dailyCap = envNumber('OUTREACH_DAILY_CAP', 5)
  const verdict = capCheck({ sentToday, dailyCap })
  if (!verdict.ok) {
    return safeReply(sock, jid, `Daily outreach cap reached (${sentToday}/${dailyCap}). Candidate #${id} stays pending.`)
  }

  // Read the cooldown per call (not at module load) so a changed env is
  // honoured. A member who was sent or suppressed within the window is never
  // re-messaged — spec §7 ("/send: cap + cooldown") and §8 ("gate every draft
  // and every send"). The draft-time eligibility gate normally covers this;
  // this is the last line of defence before a member is messaged.
  const cooldownDays = envNumber('OUTREACH_COOLDOWN_DAYS', 30)
  const lastContacted = db.lastContactedAt(c.group_id, c.sender_jid)
  if (lastContacted != null && Date.now() - lastContacted <= cooldownDays * DAY) {
    return safeReply(sock, jid, `Candidate #${id} is in cooldown — ${c.sender_jid} was contacted recently. Not sent.`)
  }

  const member = db.getMember(c.group_id, c.sender_jid)
  const memberJid = memberJidFor(member)
  if (!memberJid) {
    return safeReply(sock, jid, `Candidate #${id} is not reachable — no DM-able phone for ${c.sender_jid}.`)
  }

  const text = draftOverride != null ? String(draftOverride) : String(c.draft || '')
  await sock.sendMessage(memberJid, { text })

  db.addOutreach({ candidateId: id, senderJid: c.sender_jid, text })
  const now = Date.now()
  db.updateCandidate(id, { status: 'sent', sentAt: now, decided: now })
  db.setMemberStatus(c.group_id, c.sender_jid, 'sent')
  db.markContacted(c.group_id, c.sender_jid, now)
  // Seed the member's DM thread so the brain has context if they reply.
  usermem.push(memberJid, 'assistant', text)
  await safeReply(sock, jid, `Sent #${id} to ${member.phone}.`)
}

async function handleSend(sock, jid, args) {
  const id = Number(args[0])
  if (!Number.isInteger(id) || id <= 0) return safeReply(sock, jid, 'Usage: /send <id>')
  return sendCandidate(sock, jid, id)
}

async function handleEdit(sock, jid, args) {
  const id = Number(args[0])
  if (!Number.isInteger(id) || id <= 0 || !args[1]) {
    return safeReply(sock, jid, 'Usage: /edit <id> <text>')
  }
  const c = db.getCandidate(id)
  if (!c) return safeReply(sock, jid, `No candidate #${id}.`)
  if (c.status !== 'pending') return safeReply(sock, jid, `Candidate #${id} is already ${c.status}.`)

  db.updateCandidate(id, { draft: args[1] })
  return sendCandidate(sock, jid, id, args[1])
}

async function handleSkip(sock, jid, args) {
  const id = Number(args[0])
  if (!Number.isInteger(id) || id <= 0) return safeReply(sock, jid, 'Usage: /skip <id>')
  const c = db.getCandidate(id)
  if (!c) return safeReply(sock, jid, `No candidate #${id}.`)
  // Only a pending candidate can be skipped. Skipping one that was already
  // sent would rewrite the send record and suppress a member we really
  // messaged, so refuse instead of mutating.
  if (c.status !== 'pending') {
    return safeReply(sock, jid, `Candidate #${id} is already ${c.status} and cannot be skipped.`)
  }

  const now = Date.now()
  db.updateCandidate(id, { status: 'skipped', decided: now })
  db.setMemberStatus(c.group_id, c.sender_jid, 'suppressed')
  // Start the cooldown clock: a suppressed member must not be re-drafted (or
  // re-sent) for OUTREACH_COOLDOWN_DAYS — spec §6 (eligibility: "not sent/
  // suppressed within") and §7 ("/skip: mark suppressed; no re-draft for the
  // cooldown"). `last_contacted` is the single cooldown timestamp the schema
  // provides, so suppression records there too.
  db.markContacted(c.group_id, c.sender_jid, now)
  return safeReply(sock, jid, `Skipped #${id}.`)
}

async function handleProspect(sock, jid, args) {
  const mode = String(args[0] || '').toLowerCase()
  const groupId = args[1]
  if (!['on', 'off', 'own'].includes(mode) || !groupId) {
    return safeReply(sock, jid, 'Usage: /prospect on|off|own <group>')
  }
  const group = db.getGroup(groupId)
  if (!group) return safeReply(sock, jid, `Unknown group ${groupId}.`)

  const label = group.subject || groupId
  if (mode === 'on') {
    db.setGroupEnabled(groupId, true)
    return safeReply(sock, jid, `Prospecting on for ${label}.`)
  }
  if (mode === 'off') {
    db.setGroupEnabled(groupId, false)
    return safeReply(sock, jid, `Prospecting off for ${label}.`)
  }
  db.setGroupPolicy(groupId, 'owned')
  return safeReply(sock, jid, `Group ${label} set to owned policy.`)
}

async function handleProspects(sock, jid) {
  const rows = db.listCandidates('pending')
  if (!rows.length) return safeReply(sock, jid, 'No pending prospects.')
  const lines = rows.map((c) => {
    const group = db.getGroup(c.group_id)
    const member = db.getMember(c.group_id, c.sender_jid)
    const who = (member && (member.push_name || member.phone)) || c.sender_jid
    const subject = (group && group.subject) || c.group_id
    return `#${c.id} ${subject} · ${who} · ${c.business || 'unknown'} — ${firstLine(c.draft) || '(no draft)'}`
  })
  return safeReply(sock, jid, `Pending prospects (${rows.length}):\n${lines.join('\n')}`)
}

async function handleGroups(sock, jid) {
  const rows = db.listGroups()
  if (!rows.length) return safeReply(sock, jid, 'No groups tracked yet.')
  const lines = rows.map((g) => {
    const count = db.listMembers(g.group_id).length
    return `${g.group_id} · ${g.subject || '(no subject)'} · ${g.policy || 'external'} · ${g.enabled ? 'on' : 'off'} · ${count} member${count === 1 ? '' : 's'}`
  })
  return safeReply(sock, jid, `Groups (${rows.length}):\n${lines.join('\n')}`)
}

async function handleMembers(sock, jid, args) {
  const groupId = args[0]
  if (!groupId) return safeReply(sock, jid, 'Usage: /members <group>')
  const rows = db.listMembers(groupId)
  if (!rows.length) return safeReply(sock, jid, `No members for ${groupId}.`)
  const group = db.getGroup(groupId)
  const lines = rows.map((m) => {
    const phone = m.phone ? ` (${m.phone})` : ''
    const biz = m.business_guess ? ` · ${m.business_guess}` : ''
    return `${m.jid}${phone} · ${m.push_name || '-'}${biz} · ${m.dmable ? 'dmable' : 'not-dmable'} · ${m.status || 'member'}`
  })
  return safeReply(sock, jid, `Members of ${(group && group.subject) || groupId} (${rows.length}):\n${lines.join('\n')}`)
}

async function dispatch(sock, jid, { cmd, args }) {
  switch (cmd) {
    case 'send': return handleSend(sock, jid, args)
    case 'edit': return handleEdit(sock, jid, args)
    case 'skip': return handleSkip(sock, jid, args)
    case 'prospect': return handleProspect(sock, jid, args)
    case 'prospects': return handleProspects(sock, jid)
    case 'groups': return handleGroups(sock, jid)
    case 'members': return handleMembers(sock, jid, args)
    default: return undefined
  }
}

/**
 * Handle an owner DM. Returns `true` for every recognised prospect command
 * (handled or not) and `false` only when the text is not one of ours, so
 * bot.js can fall through to its existing commands. `deps = { sendOwner }` is
 * accepted for symmetry with the other prospect modules; replies go to the
 * owner's own DM via `sock.sendMessage(jid, { text })`.
 *
 * @returns {Promise<boolean>} resolves true when the text was a prospect
 * command (handled or not), false otherwise. Callers MUST await this — the
 * returned Promise is always truthy.
 */
async function handleCommand(sock, jid, text, deps) {
  // MUST be awaited: this function is async, so a bare call returns a Promise
  // that is always truthy. Task 6 calls it as
  // `if (await outreach.handleCommand(...)) return` — awaiting is what makes
  // the boolean contract meaningful, and it ensures the member send resolves
  // before the owner is told "sent".
  const parsed = parseCommand(text)
  if (!parsed) return false

  try {
    await dispatch(sock, jid, parsed, deps || {})
  } catch (e) {
    // A DB error must not throw out of the DM path; tell the owner instead.
    await safeReply(sock, jid, `Something went wrong: ${e && e.message ? e.message : String(e)}`)
  }
  return true
}

module.exports = { parseCommand, capCheck, handleCommand }

/**
 * Nutekh WhatsApp Assistant
 *
 * Repurposed from meti-ai-bot (MIT, Shadrak Bessanh) for Nutekh services.
 * Handles direct messages (sales + support) and answers in allowed groups only
 * when directly addressed.
 */
require('./src/env')
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
} = require('@whiskeysockets/baileys')
const P = require('pino')
const fs = require('fs')
const path = require('path')
const readline = require('readline')

const { answerDM, answerAuto } = require('./src/brain')
const { isAddressed } = require('./src/addressing')
const { processDocument } = require('./src/media')
const { recordLead, recent: recentLeads } = require('./src/leads')
const { ensureSeeded } = require('./src/knowledge')
const usermem = require('./src/usermem')
const memory = require('./src/memory')
const docs = require('./src/docs')

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const splitList = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean)
const digits = (s) => String(s || '').replace(/\D/g, '')

const PHONE = digits(process.env.PHONE)
const OWNER_JIDS = splitList(process.env.OWNER_JIDS)
const ALLOWED_GROUPS = splitList(process.env.ALLOWED_GROUPS)
const ANSWER_GROUPS = splitList(process.env.ANSWER_GROUPS)

const GROUP_ANSWER = (process.env.GROUP_ANSWER ?? '1') === '1'
const DM_ALWAYS_OPEN = (process.env.DM_ALWAYS_OPEN ?? '1') === '1'
const DM_MAX = Number(process.env.DM_MAX || 0) // 0 = unlimited
const GROUP_INGEST = (process.env.GROUP_INGEST ?? '0') === '1'
const ANSWER_DELAY_MIN = Number(process.env.ANSWER_DELAY_MIN || 700)
const ANSWER_DELAY_MAX = Number(process.env.ANSWER_DELAY_MAX || 1800)

const ROOT = __dirname
const AUTH_DIR = path.join(ROOT, 'auth')
const LOG_DIR = path.join(ROOT, 'logs')
const MEDIA_DIR = process.env.MEDIA_DIR || path.join(ROOT, 'media')
const LOG_FILE = process.env.LOG_FILE || path.join(LOG_DIR, 'messages.jsonl')
const TXT_LOG = path.join(LOG_DIR, 'messages.txt')

for (const d of [AUTH_DIR, LOG_DIR, MEDIA_DIR]) if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true })

const ANSWER_SET = new Set(ANSWER_GROUPS)
const ALLOWED_SET = new Set(ALLOWED_GROUPS)

function isOwner(jid) {
  const d = digits(jid)
  return OWNER_JIDS.some((o) => o === jid || digits(o) === d)
}

// ---------------------------------------------------------------------------
// Message helpers
// ---------------------------------------------------------------------------
const WRAPPERS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
  'editedMessage',
  'deviceSentMessage',
  'groupMentionedMessage',
  'lottieStickerMessage',
]

function unwrap(msg, depth = 0) {
  if (!msg || typeof msg !== 'object' || depth > 6) return msg || {}
  for (const w of WRAPPERS) {
    const inner = msg[w]?.message || msg[w]?.editedMessage?.message || msg[w]
    if (inner && typeof inner === 'object') return unwrap(inner, depth + 1)
  }
  return msg
}

function textOf(msg) {
  const m = unwrap(msg || {})
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    m.audioMessage?.caption ||
    m.ptvMessage?.caption ||
    m.templateMessage?.hydratedTemplate?.hydratedContentText ||
    m.buttonsMessage?.contentText ||
    m.listMessage?.description ||
    m.pollCreationMessage?.name ||
    m.pollCreationMessageV3?.name ||
    m.eventMessage?.name ||
    (m.imageMessage ? '[image]' : '') ||
    (m.videoMessage ? '[video]' : '') ||
    (m.audioMessage ? '[audio]' : '') ||
    (m.stickerMessage ? '[sticker]' : '') ||
    (m.documentMessage ? '[document]' : '') ||
    ''
  )
}

function contextOf(m) {
  const u = unwrap(m && m.message)
  return u?.extendedTextMessage?.contextInfo || u?.imageMessage?.contextInfo
    || u?.videoMessage?.contextInfo || u?.documentMessage?.contextInfo
    || u?.audioMessage?.contextInfo || {}
}

function quotedText(m) {
  const q = contextOf(m).quotedMessage
  return q ? textOf(q).trim() : ''
}

function delay(ms) { return new Promise((r) => setTimeout(r, ms)) }
function randomDelay() {
  return delay(ANSWER_DELAY_MIN + Math.floor(Math.random() * Math.max(1, ANSWER_DELAY_MAX - ANSWER_DELAY_MIN)))
}

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------
const seen = new Set()
const botSent = new Set()
const threadHistory = new Map()
const recentByChat = new Map()

function markSeen(id) {
  if (!id) return false
  if (seen.has(id)) return true
  seen.add(id)
  if (seen.size > 5000) seen.clear()
  return false
}

function rememberSent(res) {
  const id = res?.key?.id
  if (id) {
    botSent.add(id)
    if (botSent.size > 3000) botSent.clear()
  }
}

function pushThread(key, role, text) {
  const arr = threadHistory.get(key) || []
  arr.push({ role, text })
  threadHistory.set(key, arr.slice(-12))
}

function pushRecent(chatId, item) {
  const arr = recentByChat.get(chatId) || []
  arr.push(item)
  recentByChat.set(chatId, arr.slice(-30))
}

function logMessage(entry) {
  try { fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n') } catch {}
  try {
    const line = `[${entry.time}] [${entry.groupName || entry.chatId}] ${entry.senderName} (${entry.senderId}): ${entry.text}\n`
    fs.appendFileSync(TXT_LOG, line)
    console.log(line.trim())
  } catch {}
}

async function sendOwner(text) {
  if (!OWNER_JIDS.length) {
    console.log('leads: no OWNER_JIDS configured, lead only stored on disk')
    return
  }
  const sock = currentSock
  if (!sock) return
  for (const jid of OWNER_JIDS) {
    const target = jid.includes('@') ? jid : `${digits(jid)}@s.whatsapp.net`
    try { await sock.sendMessage(target, { text }) } catch (e) { console.log('owner alert failed:', e?.message) }
  }
}

let currentSock = null
let startedAt = Date.now()
let stopping = false

// ---------------------------------------------------------------------------
// Owner commands
// ---------------------------------------------------------------------------
async function handleCommand(sock, jid, text) {
  const cmd = text.trim().toLowerCase().split(/\s+/)[0]
  const reply = (t) => sock.sendMessage(jid, { text: t })

  if (cmd === '/ping') return reply(`pong — up ${Math.round((Date.now() - startedAt) / 1000)}s`)
  if (cmd === '/stats') {
    let s = {}
    try { s = memory.stats() } catch {}
    return reply(`*Nutekh Assistant*\nUptime: ${Math.round((Date.now() - startedAt) / 60000)} min\nKnowledge rows: ${s.total ?? s.messages ?? 'n/a'}\nGroups answering: ${ANSWER_GROUPS.length || 0}\nDMs open: ${DM_ALWAYS_OPEN ? 'always' : DM_MAX || 'window'}`)
  }
  if (cmd === '/leads') {
    const rows = recentLeads(5)
    if (!rows.length) return reply('No leads recorded yet.')
    return reply(rows.map((l) => `• ${l.at.slice(0, 16)} ${l.type} — ${l.business || l.contact || l.from}`).join('\n'))
  }
  return reply('Commands: /ping, /stats, /leads')
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------
async function ingestMedia(sock, m, meta) {
  const msg = unwrap(m.message)
  const doc = msg.documentMessage || msg.documentWithCaptionMessage?.message?.documentMessage
  const img = msg.imageMessage
  if (!doc && !img) return null

  try {
    const buffer = await downloadMediaMessage(m, 'buffer', {}, { reuploadRequest: sock.updateMediaMessage })
    const ext = img
      ? (img.mimetype?.split('/')[1] || 'jpg')
      : (path.extname(doc?.fileName || '').replace('.', '') || 'bin')
    const fileName = doc?.fileName || `${meta.senderName || 'file'}-${Date.now()}.${ext}`

    if (process.env.OCR_URL) {
      try {
        const res = await processDocument(buffer, { ...meta, fileName, ext })
        return { fileName, facts: res?.facts || 0 }
      } catch (e) { console.log('media: OCR failed -', e.message) }
    }
    const saved = path.join(MEDIA_DIR, String(Date.now()) + '-' + fileName.replace(/[^\w.\-]/g, '_').slice(0, 80))
    fs.writeFileSync(saved, buffer)
    return { fileName, facts: 0 }
  } catch (e) {
    console.log('media: download failed -', e?.message)
    return null
  }
}

async function sendRegisteredDoc(sock, chatId, docId, quoted) {
  if (!docId) return false
  const doc = docs.all().find((d) => String(d.id).toLowerCase() === String(docId).toLowerCase())
  if (!doc) return false
  try {
    const f = await docs.getFile(doc, 'en')
    if (!fs.existsSync(f.path)) return false
    await sock.sendMessage(chatId, {
      document: fs.readFileSync(f.path),
      fileName: f.fileName,
      mimetype: f.mimetype,
      caption: `*${doc.title}*`,
    }, quoted ? { quoted } : {})
    return true
  } catch (e) {
    console.log('docs: send failed -', e?.message)
    return false
  }
}

// ---------------------------------------------------------------------------
// DM handling
// ---------------------------------------------------------------------------
async function handleDM(sock, jid, m) {
  const text = textOf(m.message).trim()
  const name = m.pushName || 'customer'

  if (isOwner(jid) && text.startsWith('/')) return handleCommand(sock, jid, text)
  if (markSeen(m.key.id)) return

  const media = (!text || text === '[image]' || text === '[document]') ? await ingestMedia(sock, m, {
    id: m.key.id, senderName: name, senderId: jid, time: new Date().toISOString(), isAdmin: isOwner(jid),
  }) : null

  const effective = text && !['[image]', '[document]'].includes(text)
    ? text
    : media ? `(customer sent a file: ${media.fileName})` : ''
  if (!effective) return

  const firstContact = usermem.history(jid).length === 0
  const hist = usermem.history(jid).slice()

  try {
    await sock.sendPresenceUpdate('composing', jid).catch(() => {})
    const { reply, lead, leadSource, doc } = await answerDM(effective, hist, usermem.notes(jid), { firstContact })

    usermem.push(jid, 'user', effective)
    if (reply) {
      await randomDelay()
      const res = await sock.sendMessage(jid, { text: reply })
      rememberSent(res)
      usermem.push(jid, 'assistant', reply)
      usermem.bumpCount(jid)
      console.log(`DM: replied to ${name}`)
    }
    if (doc) await sendRegisteredDoc(sock, jid, doc)
    if (lead) {
      await recordLead(lead, {
        jid, name, channel: 'dm', source: leadSource,
        transcript: usermem.history(jid),
        sendOwner,
      })
    }
    usermem.maybeCompact(jid).catch(() => {})
  } catch (e) {
    console.log('DM: brain failed -', e?.message)
    const fallback = "Sorry — I'm having a moment. Please try again, or email hello@nutekh.com and the team will pick it up."
    try { await sock.sendMessage(jid, { text: fallback }) } catch {}
  }
}

// ---------------------------------------------------------------------------
// Group handling
// ---------------------------------------------------------------------------
async function handleGroup(sock, chatId, m, entry) {
  if (m.key.fromMe) return
  if (markSeen(m.key.id)) return
  if (!(entry.text || '').trim()) return

  pushRecent(chatId, { senderName: entry.senderName, text: entry.text, time: entry.time })

  if (GROUP_INGEST && (!ALLOWED_SET.size || ALLOWED_SET.has(chatId))) {
    try { memory.ingest([entry]) } catch {}
  }

  const ctx = contextOf(m)
  const mentions = ctx.mentionedJid || []
  const quotedBot = !!ctx.stanzaId && botSent.has(ctx.stanzaId)
  const sig = await isAddressed(entry.text, {
    quotedBot,
    mentionsBotJid: mentions.some((j) => digits(j) === PHONE || isOwner(j)),
    nTags: mentions.length,
  })
  if (!sig.addressed) return

  const key = chatId + '|' + entry.senderId
  const hist = threadHistory.get(key) || []
  const recent = recentByChat.get(chatId) || []

  try {
    await sock.sendPresenceUpdate('composing', chatId).catch(() => {})
    const { reply, lead, leadSource, skipped } = await answerAuto(entry.text, hist, recent, { addressed: true })
    if (skipped || !reply) return

    await randomDelay()
    const res = await sock.sendMessage(chatId, { text: reply, mentions: [entry.senderId] }, { quoted: m })
    rememberSent(res)
    pushThread(key, 'user', entry.text)
    pushThread(key, 'assistant', reply)
    console.log(`group: replied in ${entry.groupName} to ${entry.senderName}`)

    if (lead) {
      await recordLead(lead, {
        jid: entry.senderId, name: entry.senderName, channel: 'group', source: leadSource,
        transcript: threadHistory.get(key) || [],
        sendOwner,
      })
    }
  } catch (e) {
    console.log('group: brain failed -', e?.message)
  }
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(question, (a) => { rl.close(); resolve(a.trim()) })
  })
}

async function start() {
  try {
    const seed = ensureSeeded()
    if (seed.added) console.log(`knowledge: seeded ${seed.added} fact(s) (${seed.skipped} already present)`)
  } catch (e) { console.log('knowledge: seed failed -', e.message) }

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth: state,
    logger: P({ level: 'silent' }),
    printQRInTerminal: false,
    markOnlineOnConnect: false,
  })
  currentSock = sock
  startedAt = Date.now()

  sock.ev.on('creds.update', saveCreds)

  if (!sock.authState.creds.registered) {
    let phone = PHONE
    if (!phone) phone = digits(await ask('Bot WhatsApp number, international format, no + or spaces (e.g. 255748000000): '))
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(phone)
        console.log('\n==============================')
        console.log('  PAIRING CODE: ' + code)
        console.log('==============================')
        console.log('On the phone: WhatsApp > Linked devices > Link with phone number,')
        console.log('then enter this code.\n')
      } catch (e) { console.error('pairing code error:', e?.message || e) }
    }, 3000)
  }

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update
    if (connection === 'open') {
      console.log('connected — listening for messages')
      sock.groupFetchAllParticipating().then((groups) => {
        const list = Object.values(groups)
        console.log(`\nmember of ${list.length} group(s):`)
        list.forEach((g, i) => {
          const flags = []
          if (ANSWER_SET.has(g.id)) flags.push('ANSWERING')
          if (ALLOWED_SET.has(g.id)) flags.push('LOGGED')
          console.log(`  ${i + 1}. ${g.subject} (${g.id}) — ${g.participants.length} members${flags.length ? ' [' + flags.join(', ') + ']' : ''}`)
        })
        console.log('\nTo answer in a group, add its id to ANSWER_GROUPS in .env\n')
      }).catch((e) => console.log('could not list groups:', e?.message))
    } else if (connection === 'close') {
      if (stopping) return console.log('stopped')
      const code = lastDisconnect?.error?.output?.statusCode
      const reconnect = code !== DisconnectReason.loggedOut
      console.log(`disconnected (code ${code}); reconnect: ${reconnect}`)
      if (reconnect) setTimeout(() => start().catch((e) => console.log('restart failed -', e.message)), 3000)
      else console.log('session closed. Delete the auth/ folder to pair again.')
    }
  })

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify' && type !== 'append') return
    // 'append' is backlog delivered on connect; log it, never reply to it.
    const live = type === 'notify'
    for (const m of messages) {
      const chatId = m.key.remoteJid || ''
      if (!chatId || chatId === 'status@broadcast') continue

      try {
        if (!chatId.endsWith('@g.us')) {
          if (!live) continue
          if (m.key.fromMe) continue
          const t = textOf(m.message).trim()
          if (t.length >= 1 || m.message?.documentMessage || m.message?.imageMessage) handleDM(sock, chatId, m)
          continue
        }

        const senderId = m.key.participant || chatId
        const meta = await sock.groupMetadata(chatId).catch(() => null)
        const entry = {
          time: new Date((m.messageTimestamp || Date.now() / 1000) * 1000).toISOString(),
          messageId: m.key.id,
          chatId,
          groupName: meta?.subject || chatId,
          senderId,
          senderNumber: digits(senderId),
          senderName: m.pushName || 'member',
          fromMe: m.key.fromMe || false,
          msgType: Object.keys(m.message || {}).filter((k) => k !== 'messageContextInfo')[0] || 'unknown',
          text: textOf(m.message),
        }
        logMessage(entry)
        if (!live || !GROUP_ANSWER) continue
        if (ANSWER_SET.size && !ANSWER_SET.has(chatId)) continue
        handleGroup(sock, chatId, m, entry)
      } catch (e) {
        console.log('upsert error -', e?.message)
      }
    }
  })
}

process.on('SIGINT', () => { stopping = true; try { currentSock?.end(new Error('sigint')) } catch {} ; setTimeout(() => process.exit(0), 300) })
process.on('SIGTERM', () => { stopping = true; try { currentSock?.end(new Error('sigterm')) } catch {} ; setTimeout(() => process.exit(0), 300) })
process.on('unhandledRejection', (e) => console.log('unhandled rejection:', e?.message || e))

console.log('Nutekh Assistant starting...')
start().catch((e) => { console.error('Fatal:', e); process.exit(1) })



const fs = require('fs')
const path = require('path')
const { chat, chatJSON } = require('./llm')
const { translateDoc } = require('./translate')

const DOC_DIR = process.env.DOC_DIR || path.join(__dirname, '..', 'documents')
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data')
const MANIFEST = path.join(DATA_DIR, 'docs.json')
for (const d of [DOC_DIR, DATA_DIR]) if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true })

const SEED = []

let manifest = (() => { try { return JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) } catch { return [] } })()
for (const s of SEED) if (!manifest.find((d) => d.id === s.id)) manifest.push(s)
function save() { try { fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2)) } catch {} }
save()

function all() { return manifest }
function pathOf(doc) { return path.isAbsolute(doc.file) ? doc.file : path.join(DOC_DIR, doc.file) }

function register(doc) {
  const id = doc.id || 'doc-' + Date.now()
  const existing = manifest.find((d) => d.id === id)
  if (existing) Object.assign(existing, doc, { id })
  else manifest.push({ id, source: 'admin', ts: Date.now(), ...doc })
  save()
  return id
}

function scoreDoc(d, q) {
  const s = ' ' + q.toLowerCase() + ' '
  let score = 0
  for (const k of (d.keywords || [])) if (s.includes(k.toLowerCase())) score += 2
  for (const w of (d.title || '').toLowerCase().split(/\s+/)) if (w.length > 3 && s.includes(w)) score += 1
  return score
}
function findByKeyword(query) {
  const ranked = manifest.map((d) => ({ d, s: scoreDoc(d, query) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s)
  return ranked.length ? ranked[0].d : null
}

async function pick(query, context = '') {
  const kw = findByKeyword(query)
  const list = manifest.map((d) => `- ${d.id}: ${d.title} — ${d.description}`).join('\n')
  try {
    const raw = await chat([
      { role: 'system', content: `You classify a user message about Nutekh documents. Reply STRICT JSON only: {"id":"<a document id | ambiguous | none>","lang":"<ISO code, default en>"}.
- Use "none" ONLY when the user asks a QUESTION for information (e.g. "what is included in Grow", "what are your hours") rather than asking to receive a file.
- If the user wants to GET / RECEIVE / be SENT a document, or mentions a document "in Swahili/English", map it to the matching document id. Mentioning a language version almost always means they want the file.
- Use "ambiguous" when they clearly want a document sent but it is unclear which one.
- Use the recent conversation to resolve references ("this document", "the Swahili version", "it").
- LANGUAGE: default "en". Only use another code if the user EXPLICITLY asks for that language ("in Swahili", "kwa Kiswahili", "la version française"). Do NOT infer the language from the message's own language.
Examples: "what is included in Grow" -> none | "send me the company profile" -> company-profile | "can I get the pricing guide in Swahili" -> pricing-guide | "send me the file" -> ambiguous` },
      { role: 'user', content: `AVAILABLE DOCUMENTS:\n${list}\n\n${context ? 'RECENT CONVERSATION (oldest first):\n' + context + '\n\n' : ''}USER MESSAGE: "${query}"\n\nJSON only.` },
    ], { max_tokens: 40, priority: 'high' })
    let d = {}; try { d = JSON.parse(raw.match(/\{[\s\S]*\}/)[0]) } catch {}

    const langWanted = /\b(kiswahili|swahili)\b/i.test(query) ? 'sw' : /\b(fran[cç]ais|french)\b/i.test(query) ? 'fr' : 'en'
    const lang = langWanted !== 'en' ? langWanted : (d.lang || 'en').toLowerCase()

    const sendIntent = /\b(send|share|give|forward|resend|get|receive|download|envoi|envoie|envoyer|partage|partager|passe|donne|obtenir|recevoir|t[ée]l[ée]charger)\b/i.test(query)
    if (d.id === 'none' || d.id === 'ambiguous') return (sendIntent && kw) ? { kind: 'doc', doc: kw, lang } : { kind: d.id, lang }
    const doc = d.id ? manifest.find((x) => x.id === d.id) : null
    if (doc) return { kind: 'doc', doc, lang }
    return (sendIntent && kw) ? { kind: 'doc', doc: kw, lang } : { kind: 'none', lang }
  } catch {}
  return kw ? { kind: 'doc', doc: kw, lang: /\b(fran[cç]ais|french)\b/i.test(query) ? 'fr' : 'en' } : { kind: 'none', lang: 'en' }
}

function _renameLang(fileName, lang) {
  const ext = path.extname(fileName)
  return fileName.slice(0, -ext.length) + ` (${lang.toUpperCase()})` + ext
}

async function getFile(doc, lang) {
  lang = (lang || 'en').toLowerCase()
  const baseLang = (doc.lang || 'en').toLowerCase()
  if (lang === baseLang) return { path: pathOf(doc), fileName: doc.fileName, mimetype: doc.mimetype }
  doc.variants = doc.variants || {}
  const known = doc.variants[lang]
  if (known && fs.existsSync(path.join(DOC_DIR, known))) {
    return { path: path.join(DOC_DIR, known), fileName: _renameLang(doc.fileName, lang), mimetype: doc.mimetype }
  }
  const ext = path.extname(pathOf(doc))
  const outName = `${doc.id}.${lang}${ext}`
  const outPath = path.join(DOC_DIR, outName)
  if (!fs.existsSync(outPath)) await translateDoc(pathOf(doc), lang, outPath)
  doc.variants[lang] = outName; save()
  return { path: outPath, fileName: _renameLang(doc.fileName, lang), mimetype: doc.mimetype }
}

async function ensureLang(docId, lang) {
  const doc = manifest.find((d) => d.id === docId)
  if (!doc) return
  try { await getFile(doc, lang) } catch {}
}

async function registerFromContent({ buffer, fileName, mimetype, text }) {
  const safe = (fileName || 'document').replace(/[^\w.\-]/g, '_').slice(0, 60)
  const stored = /\.[a-z0-9]+$/i.test(safe) ? safe : safe + '.bin'
  const dest = path.join(DOC_DIR, Date.now() + '-' + stored)
  try { fs.writeFileSync(dest, buffer) } catch (e) { return null }
  let meta = { title: fileName || 'Document', description: (text || '').slice(0, 160), keywords: [] }
  try {
    const d = await chatJSON([
      { role: 'system', content: 'Summarize a shared document for a retrieval index. STRICT JSON only: {"title":"short title","description":"one clear sentence","keywords":["k1","k2","k3"]}.' },
      { role: 'user', content: `File name: ${fileName || '(unknown)'}\nContent (OCR, may be partial):\n"""${(text || '').slice(0, 2500)}"""` },
    ], { label: 'doc-meta' })
    if (d && d.title) meta = { title: d.title, description: d.description || meta.description, keywords: Array.isArray(d.keywords) ? d.keywords : [] }
  } catch {}

  const stop = new Set(['the', 'and', 'for', 'with', 'pdf', 'pptx', 'docx', 'from', 'this', 'that', 'your'])
  const extra = ((meta.title || '') + ' ' + (fileName || '')).toLowerCase().match(/[a-z0-9]{3,}/g) || []
  meta.keywords = [...new Set([...(meta.keywords || []), ...extra.filter((w) => !stop.has(w))])]
  const id = 'doc-' + Date.now()
  register({ id, file: dest, fileName: fileName || (meta.title + '.pdf'), mimetype: mimetype || 'application/octet-stream', source: 'admin', ...meta })
  return { id, ...meta }
}

module.exports = { all, register, registerFromContent, findByKeyword, pick, getFile, ensureLang, pathOf, DOC_DIR }

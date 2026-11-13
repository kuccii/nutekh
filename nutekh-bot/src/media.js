const fs = require('fs')
const path = require('path')
const { ocrExtract } = require('./ocr')
const { chat } = require('./llm')
const { addCurated } = require('./memory')

const MEDIA_DIR = process.env.MEDIA_DIR || path.join(__dirname, '..', 'media')
if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true })

function safeName(s) { return String(s || Date.now()).replace(/[^\w.\-]/g, '_').slice(0, 80) }

/**
 * OCR a document/image shared in a Nutekh group, then extract durable company
 * facts (prices, package inclusions, policies) into the knowledge base.
 */
async function processDocument(buffer, meta = {}) {
  const fname = safeName(meta.fileName || meta.id) + (/\.[a-z0-9]+$/i.test(meta.fileName || '') ? '' : '.' + (meta.ext || 'bin'))
  const fp = path.join(MEDIA_DIR, fname)
  fs.writeFileSync(fp, buffer)

  let text = ''
  try { text = await ocrExtract(fp, 'en') } catch (e) { console.log('  OCR err:', e.message); return { saved: fp, facts: 0 } }
  if (!text || text.trim().length < 20) { console.log('  OCR: empty/short text, ignored'); return { saved: fp, facts: 0 } }

  const role = meta.isAdmin ? 'admin' : 'member'
  const prompt = `The following text was OCR'd from a file ("${meta.fileName || 'document'}") shared in the Nutekh company workspace by "${meta.senderName || 'a team member'}" (role: ${role}) on ${meta.time || 'unknown date'}. OCR may contain mistakes.
1) Silently fix obvious OCR errors and reflow the text.
2) Extract DURABLE, USEFUL facts for a company FAQ: services, package inclusions, prices, timelines, processes, policies, contacts, delivery notes. Ignore letterhead, page numbers and boilerplate.
Each fact must be a clean, self-contained English sentence with its context (say what it is about).
Return STRICT JSON only: {"facts": ["fact 1", "fact 2", ...]}. If nothing useful, return {"facts": []}.

OCR TEXT:
"""${text.slice(0, 6000)}"""`

  let reply
  try { reply = await chat([{ role: 'user', content: prompt }], { max_tokens: 1200 }) }
  catch (e) { console.log('  LLM err:', e.message); return { saved: fp, facts: 0 } }
  const m = reply && reply.match(/\{[\s\S]*\}/)
  let facts = []
  try { facts = (JSON.parse(m[0]).facts) || [] } catch { facts = [] }

  let n = 0
  for (const f of facts) {
    if (f && String(f).trim().length > 15) {
      addCurated({
        text: `[From file: ${meta.fileName || 'document'}] ${f}`,
        source_role: role,
        confidence: role === 'admin' ? 0.95 : 0.7,
        group_name: meta.groupName || '',
        sender_name: meta.senderName || '',
        sender_id: meta.senderId || '',
        ts: meta.time ? Date.parse(meta.time) : Date.now(),
        msg_id: 'ocr:' + (meta.id || Date.now()) + ':' + n,
      })
      n++
    }
  }
  console.log(`  OCR "${meta.fileName || meta.id}" (${role}) -> ${n} fact(s) stored`)
  return { saved: fp, facts: n, text, role }
}

module.exports = { processDocument, MEDIA_DIR }

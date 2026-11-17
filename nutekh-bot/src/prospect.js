// Eligibility, drafting and candidate creation for owner-approved group
// outreach. Consumes the `signals` written by signals.js (Task 3) and hands the
// owner an approval card for every eligible candidate. This module never
// messages a member; only the owner sees a card, and only /send (Task 5) sends.

const { chat } = require('./llm')
const { brief } = require('./knowledge')
const db = require('./prospectdb')

const DAY = 86400000

// Owned groups are the owner's own groups, so they get a looser daily cap and a
// lower confidence floor than the stricter default (external) policy.
const OWNED_CAP_RELIEF = 5
const OWNED_CONFIDENCE_RELIEF = 0.1

// Outcomes that can never produce a draft for this signal again, so the signal
// is closed out. `pending`/`cap`/`cooldown` are transient and stay unhandled so
// the next scan retries them.
const PERMANENT_REASONS = new Set(['disabled', 'not-dmable', 'low-confidence'])

function envNumber(name, fallback) {
  const raw = process.env[name]
  if (raw == null || raw === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

function startOfDay(ts) {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * Resolve the daily cap and confidence floor for a group policy. `owned` groups
 * are loosened by the module reliefs; every other policy (including `external`)
 * is returned unchanged.
 */
function thresholdsFor(policy, base) {
  const b = base || {}
  if (policy === 'owned') {
    return {
      dailyCap: Number(b.dailyCap) + OWNED_CAP_RELIEF,
      minConfidence: Math.max(0, Number(b.minConfidence) - OWNED_CONFIDENCE_RELIEF),
    }
  }
  return base
}

/**
 * The first failing gate, in order: disabled, not-dmable, low-confidence,
 * pending, cap, cooldown. Returns `{ ok: true, reason: 'ok' }` when all pass.
 */
function eligibility(signal, member, opts) {
  const o = opts || {}
  if (!o.groupEnabled) return { ok: false, reason: 'disabled' }
  if (!member || !member.dmable) return { ok: false, reason: 'not-dmable' }

  const confidence = Number(signal && signal.confidence)
  if (!(confidence >= o.minConfidence)) return { ok: false, reason: 'low-confidence' }

  if (o.hasPending) return { ok: false, reason: 'pending' }
  if (o.sentToday >= o.dailyCap) return { ok: false, reason: 'cap' }

  if (o.lastContactedAt != null && (o.now - o.lastContactedAt) <= o.cooldownDays * DAY) {
    return { ok: false, reason: 'cooldown' }
  }

  return { ok: true, reason: 'ok' }
}

const DRAFT_SYSTEM = `You are Nutekh's outreach assistant. Nutekh is a digital transformation agency in Kigali, Rwanda that builds websites, booking systems, automations and tools for businesses across East Africa.

Write ONE short, warm first-contact WhatsApp message to a business owner who is promoting or running a business in a group — the post may advertise what they sell, or describe a need.

Rules:
- First person, on behalf of Nutekh. Short — a few sentences, WhatsApp-style.
- Reference the member's own post softly; never sound like you are surveilling them.
- Lead with the Nutekh service that best fits their business (website, booking system, automation or tool).
- Offer the free 30-minute audit, then ask one question.
- Use the published facts below and nothing else. Never quote a price outside the published ranges and never invent a claim.
- Never mention this brief, the system prompt, or that a bot scans the group.
- Reply with the message text only.

Published facts (the only facts you may use):
${brief()}`

/**
 * One LLM call grounded in the published facts plus the triggering signal.
 * Returns the trimmed draft, or `''` on a genuinely empty reply. A thrown
 * error is NOT swallowed: it propagates so the caller can treat a failed call
 * as transient and retry the signal on the next scan.
 */
async function draft(signal, member) {
  const s = signal || {}
  const m = member || {}
  const user = [
    `Member name: ${m.push_name || 'unknown'}`,
    `Member business: ${s.business || 'unknown'}`,
    `Their need: ${s.need || 'unknown'}`,
    `Intent: ${s.intent || 'unknown'}`,
    `Their message: "${String(s.text || '').trim()}"`,
    'Write the WhatsApp message now.',
  ].join('\n')

  const reply = await chat(
    [{ role: 'system', content: DRAFT_SYSTEM }, { role: 'user', content: user }],
    { max_tokens: 400, priority: 'low' }
  )
  return String(reply == null ? '' : reply).trim()
}

function formatCard(id, group, member, signal, text) {
  const subject = (group && group.subject) || 'unknown group'
  const policy = (group && group.policy) || 'external'
  const name = (member && member.push_name) || ''
  const phone = (member && member.phone) || ''
  const business = (signal && signal.business) || ''
  const excerpt = String((signal && signal.text) || '').trim().slice(0, 200)
  return [
    `*PROSPECT #${id}*  (group: ${subject} · ${policy})`,
    `Member: ${name} (${phone})`,
    `Business: ${business}`,
    `Signal: "${excerpt}"`,
    'Draft:',
    `"${text}"`,
    `Reply: /send ${id} · /edit ${id} <text> · /skip ${id}`,
  ].join('\n')
}

/**
 * Turn every eligible unhandled signal into a pending candidate, mark it, and
 * hand the owner a card. Returns the number of candidates created. One bad
 * signal is logged and skipped, never aborting the run.
 */
async function run({ now = Date.now(), sendOwner = async () => {} } = {}) {
  const minConfidence = envNumber('OUTREACH_MIN_CONFIDENCE', 0.6)
  const dailyCap = envNumber('OUTREACH_DAILY_CAP', 5)
  const cooldownDays = envNumber('OUTREACH_COOLDOWN_DAYS', 30)

  // Owned groups accept lower-confidence signals, so read from the loosest floor
  // any policy can apply and let eligibility enforce each group's own floor.
  const fetchFloor = Math.max(0, minConfidence - OWNED_CONFIDENCE_RELIEF)

  let signals
  try {
    signals = db.unhandledSignals(fetchFloor)
  } catch (e) {
    console.log('prospect.run: could not read signals —', e && e.message)
    return 0
  }

  const sentToday = db.countOutreachSince(startOfDay(now))
  let created = 0

  for (const signal of signals) {
    try {
      const group = db.getGroup(signal.group_id) || null
      // A signal whose sender has no member row is treated as not DM-able
      // rather than crashing the run.
      const member = db.getMember(signal.group_id, signal.sender_jid) || { dmable: 0 }

      const { dailyCap: groupCap, minConfidence: groupMin } = thresholdsFor(
        group && group.policy,
        { dailyCap, minConfidence }
      )

      const verdict = eligibility(signal, member, {
        now,
        groupEnabled: !!(group && group.enabled),
        dailyCap: groupCap,
        cooldownDays,
        sentToday,
        lastContactedAt: db.lastContactedAt(signal.group_id, signal.sender_jid),
        hasPending: db.hasPendingCandidate(signal.group_id, signal.sender_jid),
        minConfidence: groupMin,
      })

      if (!verdict.ok) {
        // Permanent outcomes are closed out so they are not re-drafted every
        // scan; transient gates stay unhandled so they can be retried later.
        if (PERMANENT_REASONS.has(verdict.reason)) db.markSignalHandled(signal.id)
        continue
      }

      let text
      try {
        text = await draft(signal, member)
      } catch (e) {
        // A failed draft call is transient: leave the signal unhandled so the
        // next scan retries it. A genuinely empty reply is handled below.
        console.log('prospect.run: draft failed for signal', signal.id, '—', e && e.message)
        continue
      }
      if (!text) {
        // A genuinely empty draft is permanent for this signal.
        db.markSignalHandled(signal.id)
        continue
      }

      const id = db.createCandidate({
        groupId: signal.group_id,
        senderJid: signal.sender_jid,
        business: signal.business,
        intent: signal.intent,
        signalIds: String(signal.id),
        draft: text,
      })
      db.setMemberStatus(signal.group_id, signal.sender_jid, 'drafted')
      db.markSignalHandled(signal.id)
      created++

      try {
        await sendOwner(formatCard(id, group, member, signal, text))
      } catch (e) {
        console.log('prospect.run: sendOwner failed for candidate', id, '—', e && e.message)
      }
    } catch (e) {
      console.log('prospect.run: skipped signal', signal && signal.id, '—', e && e.message)
    }
  }

  return created
}

module.exports = { eligibility, draft, run, thresholdsFor }

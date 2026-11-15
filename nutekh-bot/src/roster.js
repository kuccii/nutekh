const db = require('./prospectdb')

const PHONE_SUFFIX = '@s.whatsapp.net'
const LID_SUFFIX = '@lid'

function digits(v) {
  return String(v == null ? '' : v).replace(/\D/g, '')
}

/**
 * Map a Baileys group participant to a `members` row.
 * The phone comes from the participant id when it is a phone JID, otherwise
 * from `phoneNumber` (this is how an @lid member with a known phone becomes
 * DM-able). `dmable` is 1 only when a phone was resolved.
 */
function participantToMember(p) {
  const id = String(p?.id || '')
  const lidSource = String(p?.lid || p?.id || '')
  const phone = id.endsWith(PHONE_SUFFIX) ? digits(id) : digits(p?.phoneNumber)
  return {
    jid: id || lidSource,
    phone,
    lid: lidSource.endsWith(LID_SUFFIX) ? lidSource : '',
    dmable: phone ? 1 : 0,
    pushName: String(p?.notify || ''),
  }
}

/**
 * Upsert a group and its whole roster. Never downgrades an existing group's
 * `policy`/`enabled`: for a group already on record those columns are omitted
 * so an owner's `/prospect off` or `/prospect own` survives a re-sync.
 */
function enrollGroup(group, opts = {}) {
  const { policy = 'external', enabled = 1 } = opts
  const groupId = group.id
  const subject = group.subject
  const existing = db.getGroup(groupId)
  if (existing) {
    db.upsertGroup({ groupId, subject })
  } else {
    db.upsertGroup({ groupId, subject, policy, enabled })
  }

  const participants = Array.isArray(group.participants) ? group.participants : []
  let dmable = 0
  for (const p of participants) {
    const m = participantToMember(p)
    if (m.dmable) dmable++
    db.upsertMember({
      groupId,
      jid: m.jid,
      phone: m.phone,
      lid: m.lid,
      pushName: m.pushName,
      dmable: m.dmable,
    })
  }
  return { groupId, subject, members: participants.length, dmable }
}

/** Discover every group the bot is in (connect / groups.upsert) and sync each roster. */
async function refresh(sock) {
  const groups = await sock.groupFetchAllParticipating()
  const summaries = []
  for (const g of Object.values(groups || {})) {
    if (!g || !g.id) continue
    summaries.push(enrollGroup({ id: g.id, subject: g.subject, participants: g.participants || [] }))
  }
  return summaries
}

module.exports = { participantToMember, enrollGroup, refresh }

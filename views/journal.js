import * as logic from '../src/logic.js'
import { engine } from '../src/engine.js'
import { esc, openSheet, toast } from '../src/ui.js'

// ---------------------------------------------------------------------------
// Journal — every alarm, every proof, every lockout. The receipt.
// ---------------------------------------------------------------------------

export function render(state) {
  const { events, stats, settings, shots } = state
  const rows = [...events].reverse().slice(0, 60)

  const curve = settings.lockHoursCurve
    .map((h, i) => {
      const max = Math.max(...settings.lockHoursCurve)
      const pct = Math.max(5, (h / max) * 100)
      const mine = i + 1 === stats.strikes + 1
      return `<div><div class="col ${mine ? 'me' : ''}" style="height:${pct}%"></div><small>${i + 1}</small></div>`
    })
    .join('')

  // Older builds stored JPEGs. Nothing does any more: spoken proofs keep only a
  // score, a mic peak and a duration, so the evidence panel shows the last five
  // wake-ups as numbers instead of photographs.
  const log = [...events].reverse().slice(0, 5)

  return `
  <div class="spread" style="margin:2px 2px 12px">
    <div>
      <div style="font-size:20px;font-weight:700">Journal</div>
      <div class="tiny muted">${stats.woke} woke · ${stats.failed} locked out</div>
    </div>
    <span class="pill ${stats.streak ? 'ok' : 'hot'}">${stats.streak} day streak</span>
  </div>

  <div class="card">
    <div class="stat-grid">
      <div class="stat"><b>${stats.woke}</b><span>winnings</span></div>
      <div class="stat"><b style="color:var(--hot-2)">${stats.failed}</b><span>losses</span></div>
      <div class="stat"><b>${stats.avgCompletionMs ? Math.round(stats.avgCompletionMs / 1000) + 's' : '—'}</b><span>avg. to wake</span></div>
    </div>
    <hr class="sep" />
    <div class="tiny muted">Punishment ladder — the bar you are standing in front of is highlighted.</div>
    <div class="curve">${curve}</div>
    <div class="tiny center muted" style="margin-top:6px">${esc(logic.describeLockCurve(settings))}</div>
  </div>

  ${
    shots.length
      ? `<div class="tiny muted">${shots.length} photograph(s) kept from an earlier version of this app — nothing new is stored, the mission is spoken now.</div>`
      : ''
  }

  <div class="section-title">Last five</div>
  <div class="card log-list">
    ${
      log.length
        ? log
            .map(
              (e) => `<div class="log-row"><b>${esc(e.type)}</b><span>${esc(logic.formatDayShort(e.at))}</span><span>${
                e.channel ? `<span class="chip sm">${esc(e.channel)}</span> ` : ''
              }${
                e.proofs != null ? `${e.proofs} proof${e.proofs === 1 ? '' : 's'}` : e.shots ? `${e.shots} proof(s)` : ''
              }${e.lockMinutes ? ` · ${esc(logic.formatDuration(e.lockMinutes * 60000))} locked` : ''}${
                e.penaltyMinutes ? ` · +${e.penaltyMinutes} min escape` : ''
              }${e.neverWoke ? ' · never woke' : ''}</span></div>`
            )
            .join('')
        : '<div class="tiny muted">Nothing yet.</div>'
    }
  </div>

  <div class="section-title">History</div>
  <div class="card">
    ${
      rows.length
        ? rows.map(row).join('')
        : `<div class="empty"><div class="big">📭</div><div class="small">Nothing yet. Your first alarm will write the first line.</div></div>`
    }
  </div>
  `
}

function row(e) {
  const map = {
    woke: ['good', '😤', `Beat the alarm — ${e.mode === 'outside' ? 'went outside' : 'indoor poses'} in ${logic.formatDuration(e.completionMs ?? 0)}`],
    debt: ['warn', '📌', 'Failed alarm re-armed — you still owe this wake-up'],
    strike_reset: ['warn', '🧾', 'Ladder reset from the admin console — not counted as a win'],
    escape_attempt: ['bad', '🚪', 'Tried to leave the lockout — time added'],
    proof_rejected: ['bad', '🎙️', 'A proof was not good enough'],
    locked: ['bad', '🔒', `Locked out for ${logic.formatDuration((e.lockMinutes ?? 0) * 60000)} — ${esc(e.reason ?? '')}`],
    released: ['', '🔓', `Lockout of ${logic.formatDuration((e.lockMinutes ?? 0) * 60000)} served${e.restored ? ' (resumed after reload)' : ''}`],
    panic: ['bad', '🚨', `Panic release taken${e.penalty ? ' — strike added' : ''}`],
    bypass: ['', '🛡', `Mission blown during an admin lease — no lockout, no strike`],
    admin_abort: ['', '⏏', 'Episode aborted from the admin console'],
    admin_on: ['', '🔓', `Admin lease started${e.leaseMinutes ? ` (${e.leaseMinutes} min)` : ' (no expiry)'}`],
    admin_off: ['', '🔒', 'Admin lease ended — punishment re-armed'],
    admin_denied: ['bad', '🔑', 'Admin unlock rejected (wrong PIN)'],
    admin_config: ['', '⚙️', `Admin overrides changed: ${Object.keys(e).filter((k) => k.startsWith('admin') && !['admin'].includes(k)).map((k) => `${k.replace('admin', '')}=${e[k]}`).join(', ') || '—'}`],
    admin: ['', '🛡', 'Admin action (no effect on your record)'],
    reset: ['', '🧹', 'All app data wiped by the user'],
  }
  const [cls, ico, text] = map[e.type] ?? ['', '•', e.type]
  return `<div class="log-row">
    <div class="log-ico ${cls}">${ico}</div>
    <div class="grow">
      <div class="small" style="font-weight:${cls ? '650' : '500'}">${text}</div>
      <div class="tiny muted">${esc(logic.formatDayShort(e.at))}${e.label ? ` · ${esc(e.label)}` : ''}${
        e.proofs != null ? ` · ${e.proofs} proof(s)` : e.shots ? ` · ${e.shots} legacy capture(s)` : ''
      }${e.acceptLatencyMs != null ? ` · accepted after ${logic.formatDuration(e.acceptLatencyMs)}` : ''}</div>
    </div>
  </div>`
}

export function mount(root) {
  root.addEventListener('click', (e) => {
    const img = e.target.closest('[data-shot]')
    if (!img) return
    const shot = engine.shots.find((s) => s.id === img.dataset.shot)
    if (!shot) return
    openSheet(
      `<h3 style="margin-bottom:8px">${esc(shot.kind)}</h3>
       <img src="${shot.dataUrl}" style="width:100%;border-radius:14px;border:1px solid var(--line)" alt="" />
       <div class="tiny muted" style="margin-top:10px">
         ${esc(logic.formatDayShort(shot.at))} · pose <b>${esc(shot.poseId)}</b> · ${shot.live ? 'live camera capture' : '<b style="color:var(--warn)">simulated</b>'}
       </div>`
    )
  })
}

export function tick() {}

export function signature(state) {
  return `${state.events.length}:${state.shots.length}:${state.stats.strikes}:${state.stats.failed}`
}

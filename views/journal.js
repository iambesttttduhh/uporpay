import * as logic from '../src/logic.js'
import { engine } from '../src/engine.js'
import { esc, openSheet, toast } from '../src/ui.js'

// ---------------------------------------------------------------------------
// Journal — every alarm, every photo, every lockout. The receipt.
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

  const evidence = shots.slice(-8).reverse()

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
    evidence.length
      ? `<div class="section-title">Evidence</div>
         <div class="card"><div class="shots">
           ${evidence
             .map(
               (s) =>
                 `<img src="${s.dataUrl}" data-shot="${s.id}" alt="${esc(s.kind)}" style="${s.simulated ? 'filter:saturate(.4)' : ''}" />`
             )
             .join('')}
         </div>
         <div class="tiny muted" style="margin-top:9px">${shots.length} capture(s) kept on this device only. Faded = simulated, not a real photo.</div></div>`
      : ''
  }

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
    locked: ['bad', '🔒', `Locked out for ${logic.formatDuration((e.lockMinutes ?? 0) * 60000)} — ${esc(e.reason ?? '')}`],
    released: ['', '🔓', `Lockout of ${logic.formatDuration((e.lockMinutes ?? 0) * 60000)} served${e.restored ? ' (resumed after reload)' : ''}`],
    panic: ['bad', '🚨', `Panic release taken${e.penalty ? ' — strike added' : ''}`],
    reset: ['', '🧹', 'All app data wiped by the user'],
  }
  const [cls, ico, text] = map[e.type] ?? ['', '•', e.type]
  return `<div class="log-row">
    <div class="log-ico ${cls}">${ico}</div>
    <div class="grow">
      <div class="small" style="font-weight:${cls ? '650' : '500'}">${text}</div>
      <div class="tiny muted">${esc(logic.formatDayShort(e.at))}${e.label ? ` · ${esc(e.label)}` : ''}${
        e.shots != null ? ` · ${e.shots} photo(s)` : ''
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
  return `${state.events.length}:${state.shots.length}:${state.stats.strikes}`
}

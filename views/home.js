import * as logic from '../src/logic.js'
import { engine } from '../src/engine.js'
import { esc, toast } from '../src/ui.js'
import { alarmSound } from '../src/audio.js'

// ---------------------------------------------------------------------------
// Home — the clock, and a plain-language restatement of what's at stake.
// ---------------------------------------------------------------------------

export function render(state) {
  const { settings, alarms, episode, strikes, streak, stats, nextAlarmAt, lastOutcome } = state
  const next = nextAlarmAt ? formatUntil(nextAlarmAt, state.now) : null
  const demo = settings.demoTiming
  const minutesToLock = Math.max(0, episode ? (episode.missionDeadlineAt - state.now) / 60000 : 0)

  return `
  <div class="hero">
    <div class="hero-time"><span data-clock-sec="${state.now}"></span></div>
    <div class="hero-next">
      ${
        nextAlarmAt
          ? `⏰ ${esc(formatAlarmLine(alarms, nextAlarmAt))} · in <b>${next}</b>`
          : `<span class="muted">No alarm set — you have nothing to fear</span>`
      }
    </div>
  </div>

  ${
    lastOutcome && Date.now() - lastOutcome.at < 90_000
      ? `<div class="card ${lastOutcome.kind === 'woke' ? '' : 'card--danger'}" style="margin-bottom:12px">
           <div class="row">
             <div style="font-size:26px">${lastOutcome.kind === 'woke' ? '😤' : '🔒'}</div>
             <div class="grow">
               <div class="small" style="font-weight:700">${
                 lastOutcome.kind === 'woke'
                   ? `Out of bed in ${logic.formatDuration(lastOutcome.completionMs)} — ${lastOutcome.mode === 'outside' ? 'fresh air' : 'three poses'} done`
                   : `Lockover served. ${logic.formatDuration((lastOutcome.lockMinutes ?? 0) * 60000)} lost.`
               }</div>
               <div class="tiny muted">${
                 lastOutcome.kind === 'woke'
                   ? `Streak: ${streak} day${streak === 1 ? '' : 's'} · strikes reset to zero`
                   : 'Your alarm clock remembers everything.'
               }</div>
             </div>
           </div>
         </div>`
      : ''
  }

  <div class="card">
    <div class="spread" style="margin-bottom:4px">
      <div style="font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--dim-2)">Your record</div>
      ${demo ? '<span class="pill demo">demo timing</span>' : ''}
    </div>
    <div class="stat-grid">
      <div class="stat"><b>${streak}</b><span>on-time streak</span></div>
      <div class="stat"><b style="color:var(--hot-2)">${strikes}</b><span>strikes</span></div>
      <div class="stat"><b>${logic.formatDuration(stats.lockedMs)}</b><span>time locked</span></div>
    </div>
    <hr class="sep" />
    <div class="small">Next offence costs <b style="color:var(--hot-2)">${esc(logic.lockLabel(strikes + 1, settings))}</b> of phone access${
      strikes > 0 ? ` (up from ${esc(logic.lockLabel(strikes, settings))})` : ''
    }.</div>
  </div>

  <div class="section-title">The deal</div>
  <div class="card">
    <div class="rules">
      <div class="rule"><div class="n"></div><div>The alarm buzzes <b>continuously for ${esc(minutes(settings.ringMinutes))}</b>. No snooze, no dismiss — it only stops when a mission is accepted.</div></div>
      <div class="rule"><div class="n"></div><div>You then get <b>${esc(minutes(settings.missionWindowMinutes))}</b> to prove you are awake:</div></div>
      <div class="rule"><div class="n"></div><div><b>OUTSIDE</b> — one photo of where you actually are (daylight/GPS verified) plus <b>${settings.outsidePoseSelfies} pose selfie${settings.outsidePoseSelfies > 1 ? 's' : ''}</b>.</div></div>
      <div class="rule"><div class="n"></div><div><b>INDOORS</b> — <b>${settings.insidePhotos} photos, ${esc(minutes(settings.insideSpacingMinutes))} apart</b>, each with a different random pose the app picks for you. Start it late and the maths makes it impossible.</div></div>
      <div class="rule"><div class="n"></div><div>Miss the deadline → <b>phone locked, ${esc(logic.lockLabel(strikes + 1, settings))}</b>. Only a phone call gets through. Nothing unlocks it early.</div></div>
    </div>
  </div>

  <div class="section-title">Try the loop</div>
  <div class="card card--flat">
    <div class="tiny muted" style="margin-bottom:11px">
      ${demo
        ? 'Demo timing divides every clock in the rules by 60 — 5 min ring becomes 5 s, the 30 min window becomes 30 s. Flip it off in Settings to use the real thing.'
        : `Real timings are armed. ${esc(minutes(settings.missionWindowMinutes))} window from the first buzz.`}
    </div>
    <div class="btn-grid">
      <button class="btn" data-act="trial-90">⏱ 90-second trial</button>
      <button class="btn" data-act="trial-now">🔔 Ring right now</button>
      <button class="btn" data-act="hear">🔊 Test the siren</button>
      <button class="btn" data-act="blow-up">💀 Fail on purpose</button>
    </div>
  </div>

  ${
    episode
      ? `<div class="card card--danger" style="margin-top:12px">
           <div class="small" style="font-weight:700">Active episode: ${esc(episode.label)}</div>
           <div class="tiny muted" style="margin-top:4px">Phase <b>${episode.phase}</b>${
             episode.mode ? ` · ${episode.mode} mission · ${episode.captures.length} shot(s)` : ''
           }${minutesToLock > 0 ? ` · ${logic.formatDuration(minutesToLock * 60000)} of grace left` : ''}</div>
           <button class="btn sm" data-act="goto-mission" style="margin-top:10px;width:100%">Open it</button>
         </div>`
      : ''
  }
  `
}

function formatUntil(ms, now) {
  const left = ms - now
  if (left < 60_000) return `${Math.round(left / 1000)}s`
  if (left < 3_600_000) return `${Math.round(left / 60_000)} min`
  if (left < 86_400_000) {
    const h = Math.floor(left / 3_600_000)
    const m = Math.round((left % 3_600_000) / 60_000)
    return `${h} h ${m} m`
  }
  return `${logic.formatDayShort(ms)}`
}

function formatAlarmLine(alarms, when) {
  const hit = alarms.find((a) => logic.nextAlarmAt(a, Date.now() - 1) === when)
  const t = new Date(when)
  const sameDay = t.toDateString() === new Date().toDateString()
  return `${hit ? hit.label + ' · ' : ''}${logic.formatAlarmTime(
    `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`
  )}${sameDay ? ' today' : ` ${logic.DAY_NAMES[t.getDay()]}`}`
}

const minutes = (m) => (m >= 1 ? `${m} min` : `${Math.round(m * 60)} s`)

export async function mount(root) {
  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]')
    if (!btn) return
    const act = btn.dataset.act
    if (act === 'trial-90') {
      await engine.forceFire({ minutesOut: 1.5, label: 'Trial run — 90 s' })
      toast('Trial armed. It goes off in ~90 seconds. Put the phone down and walk away.', 'good', 5000)
    } else if (act === 'trial-now') {
      await engine.forceFire({ minutesOut: 0, label: 'Trial run — right now' })
    } else if (act === 'hear') {
      await alarmSound.arm()
      alarmSound.enabled = true
      await alarmSound.start('siren')
      toast('That sound for 5 minutes. <b>Stop</b> in 4…', '', 3800)
      setTimeout(() => {
        if (!engine.episode) alarmSound.stop()
      }, 4000)
    } else if (act === 'blow-up') {
      await engine.forceFire({ minutesOut: 0, label: 'Deliberate failure' })
      toast('Do <b>nothing</b>. When the window closes you will be locked out. Demo timing makes this quick.', 'bad', 5200)
    } else if (act === 'goto-mission') {
      location.hash = '#/mission'
    }
  })
}

export function signature(state) {
  return `${state.nextAlarmAt ?? 0}:${Math.floor(state.now / 60000)}`
}

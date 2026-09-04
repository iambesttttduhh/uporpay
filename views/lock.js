import * as logic from '../src/logic.js'
import { engine } from '../src/engine.js'
import { esc, toast, attachHold, patchTimers } from '../src/ui.js'

// ---------------------------------------------------------------------------
// The lockout. Deliberately boring: no games, no settings, no escape hatch
// other than the optional panic release you must turn on *before* you need it.
// ---------------------------------------------------------------------------

export function render(state) {
  const ep = state.episode
  const s = state.settings
  if (!ep || ep.phase !== 'locked') {
    return `<div class="card"><div class="small" style="font-weight:700">You are not locked out</div>
      <div class="tiny muted" style="margin-top:5px">Enjoy it while it lasts. Next offence: ${esc(logic.lockLabel(state.strikes + 1, s))}.</div></div>`
  }
  const totalMs = ep.lockMinutes * 60_000
  const served = totalMs - Math.max(0, ep.lockUntil - state.now)
  const dots = Array.from({ length: Math.max(3, Math.min(8, ep.strike + 1)) }, (_, i) => `<i class="${i < ep.strike ? 'hit' : ''}"></i>`).join('')

  return `
  <div class="overlay overlay--lock">
    <div>
      <div class="lock-head">
        <div class="lock-title">Phone locked</div>
        <div class="padlock">🔒</div>
        <div class="lock-count" data-cd="${ep.lockUntil}"></div>
        <div class="lock-sub">${ep.lockMinutes >= 60 ? `${esc(logic.formatDuration(Math.max(0, ep.lockUntil - state.now)))} of ${esc(logic.formatDuration(totalMs))} served` : 'no early exit — this is the punishment, not a timeout'}</div>
        <div class="strikes">${dots}</div>
        <div class="tiny muted" style="margin-top:8px">Strike ${ep.strike} · ${esc(ep.reason ?? '')}</div>
      </div>

      <div class="card card--danger" style="margin-top:18px">
        <div class="tiny" style="font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--hot-2);margin-bottom:8px">Why</div>
        <div class="small" style="line-height:1.55">${esc(
          ep.acceptedAt == null
            ? `The alarm rang for ${logic.effectiveMinutes(s.ringMinutes, s).toFixed(0)} minutes and you never tapped "I'm awake". The mission window then expired.`
            : `You accepted a ${ep.mode} mission and did not complete it before the ${logic.effectiveMinutes(s.missionWindowMinutes, s).toFixed(0)}-minute deadline. ${ep.captures.length} of ${logic.missionSteps(ep.mode, s).length} required photos submitted.`
        )}</div>
        <hr class="sep" />
        <div class="tiny muted">Next time you fail: <b style="color:var(--hot-2)">${esc(logic.lockLabel(ep.strike + 1, s))}</b>. Succeed once and the ladder resets to ${esc(logic.lockLabel(1, s))}.</div>
      </div>

      <div class="card" style="margin-top:10px">
        <div class="tiny muted" style="margin-bottom:8px">Progress</div>
        <div class="bar"><i data-cdbar="${ep.firedAt} ${ep.lockUntil}"></i></div>
      </div>
    </div>

    <div style="margin-bottom:6px">
      <a class="btn block" href="tel:" style="text-decoration:none;background:rgba(255,255,255,.1)">📞 Emergency call only</a>
      <div class="tiny muted center" style="margin-top:8px">Voice calls still connect. That is the only thing this screen lets through.</div>
      ${
        s.panicReleaseEnabled
          ? `<div class="panic" data-panic style="margin-top:14px"><div class="fill"></div><span style="position:relative">Hold 5 s to panic-release — costs you an extra strike</span></div>`
          : ''
      }
    </div>
  </div>`
}

export function mount(root, state) {
  const ep = state.episode
  if (!ep || ep.phase !== 'locked') return
  history.pushState({ wol: 'locked' }, '')
  const onPop = () => {
    history.pushState({ wol: 'locked' }, '')
  }
  window.addEventListener('popstate', onPop)
  const panic = root.querySelector('[data-panic]')
  cleanup?.()
  cleanup = panic
    ? attachHold(
        panic,
        5000,
        async () => {
          await engine.panicRelease()
          toast('Released early. A strike was added — next time it is worse.', 'bad', 6000)
        },
        () => {}
      )
    : null
  disposer = () => {
    window.removeEventListener('popstate', onPop)
    cleanup?.()
    cleanup = null
  }
}

let cleanup = null
let disposer = null

export function unmount() {
  disposer?.()
  disposer = null
}

export function tick(root, state) {
  patchTimers(root, Date.now(), state.settings)
}

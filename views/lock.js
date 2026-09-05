import * as logic from '../src/logic.js'
import { engine } from '../src/engine.js'
import { esc, toast, attachHold, patchTimers } from '../src/ui.js'
import { native } from '../src/native.js'

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
        <div class="tiny" style="margin-top:6px;color:var(--dim-2)">${ep.neverWoke ? '<b style="color:var(--hot-2)">You never tapped awake — this is the 20-hour one.</b> ' : ''}${s.reArmAfterLockout ? 'The alarm re-arms when this ends: you still owe a wake-up.' : ''}</div>
        <div class="tiny muted" style="margin-top:8px">Strike ${ep.strike} · ${esc(ep.reason ?? '')}</div>
      </div>

      <div class="card card--danger" style="margin-top:18px">
        <div class="tiny" style="font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--hot-2);margin-bottom:8px">Why</div>
        <div class="small" style="line-height:1.55">${esc(
          ep.acceptedAt == null
            ? `The alarm rang for ${esc(logic.formatDuration(logic.ringMs(s)))} and you never tapped "I'm awake". The mission window then expired.`
            : `You accepted a ${ep.mode} mission and did not finish it before the ${esc(
                logic.formatDuration(logic.missionWindowMs(s))
              )} deadline. ${ep.captures.length} of ${logic.missionSteps(ep.mode, s).length} proofs submitted — the surroundings hold and every line, in order.`
        )}</div>
        <hr class="sep" />
        <div class="tiny muted">Next time you fail: <b style="color:var(--hot-2)">${esc(logic.lockLabel(ep.strike + 1, s))}</b>. Succeed once and the ladder resets to ${esc(logic.lockLabel(1, s))}.</div>
      </div>

      <div class="card" style="margin-top:10px">
        <div class="tiny muted" style="margin-bottom:8px">Progress</div>
        <div class="bar"><i data-cdbar="${ep.firedAt} ${ep.lockUntil}"></i></div>
      </div>

      <div class="card escape-card" style="margin-top:10px">
        <div class="spread">
          <div class="tiny" style="font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--hot-2)">Getting out</div>
          <div class="mono" style="font-weight:800">${ep.escapeCount ?? 0} attempt${(ep.escapeCount ?? 0) === 1 ? '' : 's'}</div>
        </div>
        <div class="tiny muted" style="margin-top:7px">${
          native.available
            ? native.hardLock
              ? 'Device owner: the system confines this task, there is no Unpin button, and uninstall / safe boot / factory reset / adb debugging / changing the clock are blocked while the lockout runs. The power button is Android\u2019s, not ours — but a reboot comes back here with the same time left.'
              : `Pinned with screen pinning, so Android shows an Unpin button. Using it is not an exit: each attempt adds ${s.escapePenaltyMinutes ?? 15} min (capped at ${Math.round((s.escapePenaltyCapMinutes ?? 240) / 60)} h) and the leash drags this screen back to the front within seconds. Rebooting does it too — BootReceiver re-applies what is left.`
            : 'Browser build: nothing here can stop you closing a tab, so the app bills you for trying — hiding the window while you are locked out adds time and lands in the journal.'
        }</div>
        ${native.available && !native.hardLock ? '<button class="btn sm block" data-overlay style="margin-top:9px">Grant "display over other apps" — makes the lock unignorable</button>' : ''}
      </div>
    </div>

    <div style="margin-bottom:6px">
      <a class="btn block" href="tel:" style="text-decoration:none;background:rgba(255,255,255,.1)">📞 Emergency call only</a>
      ${
        logic.adminActive(s)
          ? `<button class="btn block" data-admin-exit style="margin-top:9px;border-color:rgba(255,159,10,.5);background:rgba(255,159,10,.14);color:var(--warn)">🔓 Admin override — end this lockout${ep.adminPreview ? ' (preview)' : ''}</button>`
          : ''
      }
      ${
        // The admin key is offered here too, because a lockout is the only moment
        // you actually want out. It asks for the current admin PIN — the same value
        // the console uses — so changing it in Admin changes this door as well, and
        // using it is journaled as an admin exit rather than a win.
        s.adminExitOnUnlock && !logic.adminActive(s)
          ? `<button class="btn sm block" data-exit-key style="margin-top:9px;background:transparent;border-color:rgba(255,255,255,.14);color:var(--dim)">🗝 Admin key</button>`
          : ''
      }
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
  root.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-overlay]')) return
    const { native: N } = await import('../src/native.js')
    const r = await N.requestOverlay()
    toast(
      r?.granted ? 'Overlay granted — the leash can pull this screen back to the front' : 'Grant it in system settings, then come back here',
      r?.granted ? 'good' : 'bad',
      5000
    )
  })
  const ep = state.episode
  // The key is a two-tap thing: reveal a PIN box, then check it. Not a sheet — a
  // sheet over a takeover screen fights the popstate guard we install below.
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-exit-key]')
    if (!btn || btn.dataset.asking) return
    btn.dataset.asking = '1'
    btn.outerHTML = `<div style="display:flex;gap:8px;margin-top:9px">
      <input id="exit-pin" type="password" inputmode="numeric" maxlength="8" autocomplete="off" placeholder="admin PIN"
             style="flex:1;font-family:var(--mono);font-size:16px;text-align:center;letter-spacing:.3em;padding:11px" />
      <button class="btn sm" data-exit-go>Enter</button>
    </div>`
    root.querySelector('#exit-pin')?.focus()
  })
  root.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-exit-go]')) return
    const input = root.querySelector('#exit-pin')
    const pin = String(input?.value ?? '').trim()
    const ok = await engine.unlockAdmin(pin)
    if (!ok) {
      toast('That is not the key.', 'bad')
      if (input) {
        input.value = ''
        input.focus()
      }
      return
    }
    toast('Admin key accepted — exiting.', 'warn', 3000)
    const r = await engine.adminExit({ reason: 'admin key on the lockout screen' })
    if (!r.native) {
      toast('Browser build: the lockout is over, but a page cannot close its own tab.', 'bad', 6000)
    }
  })
  root.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && e.target?.id === 'exit-pin') {
      e.preventDefault()
      e.stopPropagation()
      root.querySelector('[data-exit-go]')?.click()
    }
  }, true)
  root.querySelector('[data-admin-exit]')?.addEventListener('click', async () => {
    if (ep?.adminPreview) await engine.clearLockPreview()
    else await engine.adminAbort()
    toast('Ended by admin lease. The record was not rewritten.', 'good')
  })
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

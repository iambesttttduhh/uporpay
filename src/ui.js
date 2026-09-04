// ---------------------------------------------------------------------------
// ui.js — tiny view helpers. Deliberately framework-free: the app is a state
// machine with a handful of screens, and re-rendering a live camera stream on
// every 400 ms tick would be a disaster. So: full render only when the screen
// signature changes, plus cheap in-place patching of timer nodes each tick.
// ---------------------------------------------------------------------------

import { formatCountdown, formatDuration } from './logic.js'

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

export const $ = (sel, root = document) => root.querySelector(sel)
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)]

/** Delegated listener. Returns an unbind fn. */
export function on(root, selector, type, handler) {
  const fn = (e) => {
    const target = e.target?.closest?.(selector)
    if (target && root.contains(target)) handler(e, target)
  }
  root.addEventListener(type, fn)
  return () => root.removeEventListener(type, fn)
}

export function toast(message, kind = '', ms = 3400) {
  const host = $('#toasts')
  if (!host) return
  const el = document.createElement('div')
  el.className = `toast ${kind}`
  el.innerHTML = message
  host.appendChild(el)
  setTimeout(() => {
    el.style.transition = 'opacity .25s ease, transform .25s ease'
    el.style.opacity = '0'
    el.style.transform = 'translateY(6px)'
    setTimeout(() => el.remove(), 260)
  }, ms)
}

/** Bottom sheet. Returns close(). */
export function openSheet(html, mount) {
  const backdrop = document.createElement('div')
  backdrop.className = 'sheet-backdrop'
  backdrop.innerHTML = `<div class="sheet"><div class="grabber"></div>${html}</div>`
  document.body.appendChild(backdrop)
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    document.removeEventListener('keydown', onKey)
    backdrop.remove()
  }
  const onKey = (e) => e.key === 'Escape' && close()
  backdrop.addEventListener('pointerdown', (e) => e.target === backdrop && close())
  document.addEventListener('keydown', onKey)
  mount?.($('.sheet', backdrop), close)
  return close
}

export function confirmSheet({ title, body, confirmLabel = 'Confirm', danger = true }) {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      close()
      resolve(value)
    }
    const close = openSheet(
      `<h3>${esc(title)}</h3>
       <div class="small muted" style="line-height:1.55">${body}</div>
       <div class="btn-grid" style="margin-top:16px">
         <button class="btn ghost" data-x="no">Cancel</button>
         <button class="btn" data-x="yes" style="${danger ? 'background:linear-gradient(180deg,#ff5a4f,#c81c12)' : 'background:linear-gradient(180deg,#3ddb66,#21a347)'}">${esc(confirmLabel)}</button>
       </div>`,
      (sheet) => {
        sheet.addEventListener('click', (e) => {
          const b = e.target.closest('[data-x]')
          if (b) finish(b.dataset.x === 'yes')
        })
      }
    )
  })
}

/**
 * Patch countdown / progress / clock nodes in place.
 *   data-cd="endMs"          → time remaining (demo-aware formatting)
 *   data-cd-abs="endMs"      → raw MM:SS regardless of demo timing
 *   data-cdbar="start end"   → % of the window still left
 *   data-clock               → live HH:MM
 *   data-clock-sec           → live HH:MM:SS
 */
export function patchTimers(root, now, settings) {
  if (!root) return
  $$('[data-cd]', root).forEach((el) => {
    const end = Number(el.getAttribute('data-cd'))
    if (!Number.isFinite(end)) return
    const left = end - now
    el.textContent = settings?.demoTiming && left > 0 && left < 60_000
      ? `${(left / 1000).toFixed(1)}s`
      : formatCountdown(left)
    el.classList.toggle('danger', left <= 0)
  })
  $$('[data-cd-abs]', root).forEach((el) => {
    el.textContent = formatCountdown(Number(el.getAttribute('data-cd-abs')) - now)
  })
  $$('[data-cd-left]', root).forEach((el) => {
    el.textContent = formatDuration(Math.max(0, Number(el.getAttribute('data-cd-left')) - now))
  })
  $$('[data-cdbar]', root).forEach((el) => {
    // NB: read the attribute, not dataset.cdBar — `data-cdbar` maps to
    // dataset.cdbar, and an undefined here used to take the whole render down.
    const spec = el.getAttribute('data-cdbar') ?? ''
    const [start, end] = spec.split(/\s+/).map(Number)
    const left = 100 - Math.max(0, Math.min(1, (now - start) / Math.max(1, end - start))) * 100
    el.style.width = `${left.toFixed(2)}%`
    el.parentElement?.classList.toggle('danger', left < 25)
  })
  $$('[data-clock]', root).forEach((el) => {
    const d = new Date(now)
    el.textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  })
  $$('[data-clock-sec]', root).forEach((el) => {
    const d = new Date(now)
    el.textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
  })
}

/** Hold-to-commit control: fills over `ms`, then fires onDone. */
export function attachHold(el, ms, onDone, onProgress = () => {}) {
  let raf = 0
  let t0 = 0
  let done = false
  const step = () => {
    if (done) return
    const p = Math.min(1, (performance.now() - t0) / ms)
    el.style.setProperty('--p', (p * 100).toFixed(1))
    onProgress(p)
    if (p >= 1) {
      done = true
      onDone()
      return
    }
    raf = requestAnimationFrame(step)
  }
  const start = (e) => {
    e?.preventDefault?.()
    t0 = performance.now()
    raf = requestAnimationFrame(step)
  }
  const stop = () => {
    cancelAnimationFrame(raf)
    if (!done) {
      el.style.setProperty('--p', '0')
      onProgress(0)
    }
  }
  el.addEventListener('pointerdown', start)
  el.addEventListener('pointerup', stop)
  el.addEventListener('pointercancel', stop)
  el.addEventListener('pointerleave', stop)
  return () => {
    cancelAnimationFrame(raf)
    el.removeEventListener('pointerdown', start)
    el.removeEventListener('pointerup', stop)
    el.removeEventListener('pointercancel', stop)
    el.removeEventListener('pointerleave', stop)
  }
}

export const DAY_SHORT = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

export function dayPicker(days) {
  return DAY_SHORT.map((name, i) => {
    const active = days.includes(i)
    return `<button type="button" class="chip ${active ? 'on' : ''}" data-day="${i}" style="width:38px;padding:9px 0;border-radius:11px;font-size:12px">${name}</button>`
  }).join('')
}

export function switchHtml(id, on_) {
  return `<button class="switch ${on_ ? 'on' : ''}" role="switch" aria-checked="${!!on_}" data-toggle="${id}"></button>`
}

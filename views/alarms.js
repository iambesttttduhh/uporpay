import * as logic from '../src/logic.js'
import { engine } from '../src/engine.js'
import { esc, openSheet, dayPicker, toast, confirmSheet } from '../src/ui.js'

// ---------------------------------------------------------------------------
// Alarms — list + editor sheet. Every alarm carries its own mission mode so a
// "Monday crawl to work" alarm can be harsher than a Saturday one.
// ---------------------------------------------------------------------------

export function render(state) {
  const { alarms, settings, strikes, now } = state
  const rows = alarms.length
    ? alarms
        .map((a) => {
          const next = logic.nextAlarmAt(a, now)
          return `
      <div class="alarm ${a.enabled ? '' : 'off'}" data-alarm="${a.id}">
        <div class="grow">
          <div class="alarm-time">${esc(logic.formatAlarmTime(a.time).replace(/ (AM|PM)/, ' <span>$1</span>'))}</div>
          <div class="alarm-label" style="margin-top:6px">${esc(a.label)} ${a.oneShot ? '<span class="chip">one-time</span>' : ''}</div>
          <div class="chips">
            <span class="chip">${esc(logic.describeDays(a.days))}</span>
            <span class="chip mode">${a.missionMode === 'choose' ? 'choose at alarm' : a.missionMode === 'outside' ? 'outside · camera + voice' : 'inside · voice'}</span>${a.debt ? '<span class="chip debt">⚠ debt</span>' : ''}
            ${next ? `<span class="chip">→ ${esc(relative(next, now))}</span>` : ''}
          </div>
        </div>
        <button class="switch ${a.enabled ? 'on' : ''}" data-toggle-alarm="${a.id}"></button>
      </div>`
        })
        .join('')
    : `<div class="empty">
         <div class="big">🛌</div>
         <div class="small">No alarms. The only winning move is not to play.</div>
         <button class="btn primary" data-new-alarm style="margin-top:16px">Set an alarm</button>
       </div>`

  return `
    <div class="spread" style="margin:2px 2px 12px">
      <div>
        <div style="font-size:20px;font-weight:700">Alarms</div>
        <div class="tiny muted">Mission window ${esc(minutes(settings.missionWindowMinutes, settings))} · ring ${esc(minutes(settings.ringMinutes, settings))}</div>
      </div>
      <span class="pill ${strikes ? 'hot' : ''}">${strikes} strike${strikes === 1 ? '' : 's'}</span>
    </div>
    ${rows}
    ${alarms.length ? `<button class="btn block" data-new-alarm style="margin-top:12px">+ New alarm</button>` : ''}
  `
}

const minutes = (m, s) => logic.formatDuration(logic.effectiveMinutes(m, s) * 60_000)

function relative(ms, now) {
  const left = ms - now
  if (left < 3_600_000) return `in ${Math.max(1, Math.round(left / 60_000))} min`
  if (left < 86_400_000) return `in ${Math.round(left / 3_600_000)} h`
  return logic.DAY_NAMES[new Date(ms).getDay()]
}

export function mount(root) {
  root.addEventListener('click', async (e) => {
    const sw = e.target.closest('[data-toggle-alarm]')
    if (sw) {
      const a = engine.alarms.find((x) => x.id === sw.dataset.toggleAlarm)
      if (a) await engine.toggleAlarm(a.id, !a.enabled)
      return
    }
    if (e.target.closest('[data-new-alarm]')) return editor(null)
    const row = e.target.closest('[data-alarm]')
    if (row) editor(engine.alarms.find((a) => a.id === row.dataset.alarm))
  })
}

function editor(alarm) {
  const a = alarm ?? {
    label: '',
    time: defaultTime(),
    days: [1, 2, 3, 4, 5],
    missionMode: 'choose',
    profile: 'siren',
    enabled: true,
    oneShot: false,
  }
  const days = [...(a.days ?? [])]

  openSheet(
    `<h3>${alarm ? 'Edit alarm' : 'New alarm'}</h3>
     <div class="field">
       <label>Time</label>
       <input type="time" id="f-time" value="${esc(a.time)}" />
     </div>
     <div class="field" style="margin-top:12px">
       <label>Label</label>
       <input id="f-label" value="${esc(a.label)}" placeholder="Work. Get up." maxlength="40" />
     </div>
     <div class="field" style="margin-top:12px">
       <label>Repeat</label>
       <div class="chips" id="f-days">${dayPicker(days)}</div>
       <div class="tiny muted" style="margin-top:6px">Tap days. None selected = fires once, then turns itself off.</div>
     </div>
     <div class="grid-2" style="margin-top:12px">
       <div class="field">
         <label>Mission</label>
         <select id="f-mode">
           <option value="choose">Let me choose at the alarm</option>
           <option value="inside">Inside: say lines</option>
           <option value="outside">Outside only</option>
         </select>
       </div>
       <div class="field">
         <label>Sound</label>
         <select id="f-profile">
           <option value="siren">Siren</option>
           <option value="jackhammer">Jackhammer</option>
           <option value="chime">Chime (coward's option)</option>
         </select>
       </div>
     </div>
     <div class="note" style="margin-top:13px">Mission rules apply either way — the mode only decides whether you get to pick. Nothing dismisses the alarm.</div>
     <div class="btn-grid" style="margin-top:16px">
       ${alarm ? `<button class="btn" data-del style="background:rgba(255,59,48,.16);border-color:rgba(255,59,48,.4)">Delete</button>` : ''}
       <button class="btn primary" data-save style="grid-column:${alarm ? 'auto' : '1 / span 2'}">Save alarm</button>
     </div>`,
    (sheet, close) => {
      sheet.querySelector('#f-mode').value = a.missionMode
      sheet.querySelector('#f-profile').value = a.profile
      sheet.addEventListener('click', (e) => {
        const d = e.target.closest('[data-day]')
        if (d) {
          const i = Number(d.dataset.day)
          const at = days.indexOf(i)
          if (at >= 0) days.splice(at, 1)
          else days.push(i)
          d.classList.toggle('on')
        }
      })
      sheet.querySelector('[data-del]')?.addEventListener('click', async () => {
        const ok = await confirmSheet({
          title: 'Delete this alarm?',
          body: `The strike history stays — deleting the alarm does not delete your record.`,
          confirmLabel: 'Delete',
        })
        if (!ok) return
        await engine.deleteAlarm(alarm.id)
        close()
        toast('Alarm deleted')
      })
      sheet.querySelector('[data-save]').addEventListener('click', async () => {
        const time = sheet.querySelector('#f-time').value
        if (!/^\d{2}:\d{2}$/.test(time)) return toast('Pick a valid time', 'bad')
        await engine.upsertAlarm({
          ...a,
          id: alarm?.id,
          time,
          label: sheet.querySelector('#f-label').value,
          days,
          missionMode: sheet.querySelector('#f-mode').value,
          profile: sheet.querySelector('#f-profile').value,
          oneShot: days.length === 0,
        })
        close()
        toast('Saved', 'good')
      })
    }
  )
}

function defaultTime() {
  const d = new Date(Date.now() + 9 * 3_600_000)
  d.setMinutes(0, 0, 0)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Re-render when any alarm's visible properties change. */
export function signature(state) {
  return state.alarms.map((a) => `${a.id}${a.enabled ? 1 : 0}${a.time}${a.missionMode}${a.label}${a.days.join('')}`).join(',')
}

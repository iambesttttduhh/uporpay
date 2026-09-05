// ---------------------------------------------------------------------------
// speech.js — spoken proof. The microphone is read, the words are compared, and
// nothing is recorded: no blob, no file, no storage. What survives is a number
// (how much of the required line the recogniser heard) and a peak level.
//
// Two recognition back ends, same result shape:
//   • the APK  → the system speech recogniser via RecognizerIntent (WebView has
//     no Web Speech API, so a browser-only implementation would be dead there)
//   • browser  → webkitSpeechRecognition
// Both are wrapped so failure degrades to a clear message instead of a hang.
// ---------------------------------------------------------------------------

import { native } from './native.js'

let stream = null
let audioCtx = null

export function speechSupport() {
  const SR = globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition ?? null
  return {
    recognize: native.available ? 'native' : SR ? 'web' : null,
    webSpeech: Boolean(SR),
    mic: Boolean(navigator.mediaDevices?.getUserMedia),
    secureContext: globalThis.isSecureContext !== false,
  }
}

/**
 * Live input level, so the UI can show a bar while you talk and so silence
 * cannot pass: the recogniser will happily hallucinate words from a quiet room.
 */
export async function openMeter({ onLevel } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) return { active: false, stop() {} }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
  } catch (err) {
    return { active: false, error: err?.name ?? 'mic-denied', stop() {} }
  }
  const Ctx = globalThis.AudioContext ?? globalThis.webkitAudioContext
  if (!Ctx) return { active: false, stop() {} }
  audioCtx = new Ctx()
  const src = audioCtx.createMediaStreamSource(stream)
  const analyser = audioCtx.createAnalyser()
  analyser.fftSize = 512
  src.connect(analyser)
  const buf = new Uint8Array(analyser.frequencyBinCount)
  let raf = 0
  let peak = 0
  const tickLevels = () => {
    analyser.getByteTimeDomainData(buf)
    let max = 0
    for (let i = 0; i < buf.length; i++) max = Math.max(max, Math.abs(buf[i] - 128) / 128)
    peak = Math.max(peak, max)
    onLevel?.({ level: max, peak })
    raf = requestAnimationFrame(tickLevels)
  }
  raf = requestAnimationFrame(tickLevels)
  return {
    active: true,
    get peak() {
      return peak
    },
    reset() {
      peak = 0
    },
    stop() {
      cancelAnimationFrame(raf)
      for (const t of stream?.getTracks() ?? []) t.stop()
      stream = null
      audioCtx?.close?.().catch(() => {})
      audioCtx = null
    },
  }
}

/**
 * One utterance, compared against `required`.
 * @returns {Promise<{ok:boolean, transcript?:string, score?:number, missing?:string[], peak?:number, seconds?:number, simulated?:boolean, error?:string}>
 */
export async function sayLine({ required, maxSeconds = 12, lang = 'en-US', minLevel = 0.03, onPartial } = {}) {
  const meter = await openMeter({ onLevel: (v) => onPartial?.({ level: v.level, peak: v.peak }) })
  const started = Date.now()
  try {
    const res = await recognize({ maxSeconds, lang, onPartial })
    const peak = meter.peak ?? 0
    if (res.error) return { ok: false, error: res.error, peak, seconds: (Date.now() - started) / 1000 }
    const { scoreTranscript } = await import('./logic.js')
    const scored = scoreTranscript(required, res.transcript)
    if (minLevel > 0 && peak < minLevel && !res.simulated) {
      return {
        ok: false,
        error: 'no-audio',
        transcript: res.transcript,
        peak,
        seconds: (Date.now() - started) / 1000,
        hint: 'The room was silent. Say the whole line out loud.',
      }
    }
    // The caller owns the threshold (settings.speechMatch) — this module only
    // measures, so the rule stays in logic.js and stays unit-tested.
    return {
      score: scored.score,
      missing: scored.missing,
      transcript: res.transcript ?? '',
      confidence: res.confidence ?? null,
      simulated: Boolean(res.simulated),
      peak,
      seconds: (Date.now() - started) / 1000,
      words: scored.words,
    }
  } finally {
    meter.stop?.()
  }
}

async function recognize({ maxSeconds, lang, onPartial }) {
  if (native.available && native.native.recognizeSpeech) {
    const r = await native.native.recognizeSpeech({ lang, maxSeconds })
    if (r?.error) return { error: r.error }
    return { transcript: r?.transcript ?? '', confidence: r?.confidence ?? null }
  }
  const SR = globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition ?? null
  if (!SR) {
    // Fail open only when the user explicitly opted into test mode — otherwise a
    // missing recogniser must be a loud error, not a free pass.
    const { engine } = await import('./engine.js')
    if (engine?.settings?.testMode) return { transcript: '__simulated__', simulated: true }
    return { error: 'no-speech-recogniser' }
  }
  return await webRecognize(SR, { maxSeconds, lang, onPartial })
}

function webRecognize(SR, { maxSeconds, lang, onPartial }) {
  return new Promise((resolve) => {
    let done = false
    const finish = (v) => {
      if (done) return
      done = true
      clearTimeout(toy)
      try {
        rec.onresult = rec.onerror = rec.onend = null
        rec.abort?.()
      } catch {}
      resolve(v)
    }
    const rec = new SR()
    rec.lang = lang
    rec.interimResults = true
    rec.continuous = true
    rec.maxAlternatives = 1
    let best = ''
    let conf = 0
    rec.onresult = (e) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) {
          best += `${r[0].transcript} `
          conf = Math.max(conf, r[0].confidence ?? 0)
        } else interim += r[0].transcript
      }
      onPartial?.({ transcript: best.trim(), interim })
    }
    rec.onerror = (e) => finish({ error: e.error ?? 'speech-error' })
    rec.onend = () => finish({ transcript: best.trim(), confidence: conf })
    const toy = setTimeout(() => finish({ transcript: best.trim(), confidence: conf }), maxSeconds * 1000 + 900)
    try {
      rec.start()
    } catch (err) {
      finish({ error: String(err?.message ?? err) })
    }
  })
}

/** Simulation path used by testMode: the "recognition" is the prompt itself. */
export function simulatedTranscript(required) {
  return required
}

export async function speechReport() {
  const sup = speechSupport()
  return { ...sup, native: native.available, status: native.status ?? null }
}

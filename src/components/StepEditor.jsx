import { useEffect, useRef, useState } from 'react'
import { TRACK_COLORS, noteName } from '../model.js'

const DBL_MS = 300 // second tap inside this removes the note

export default function StepEditor({
  trackName,
  color,
  step,
  data,
  stepMode,
  liveMode,
  cursor,
  onRemoveNote,
  onAudition,
  onAuditionNote,
  onBack,
  onRest,
}) {
  // Which note of the chord is picked — it is the one a chip highlights.
  const pitches = data.notes.map(n => n.note)
  const [picked, setPicked] = useState(pitches[0])
  const empty = data.notes.length === 0
  const active = pitches.includes(picked) ? picked : pitches[0]

  useEffect(() => {
    setPicked(undefined)
  }, [step, trackName]) // eslint-disable-line react-hooks/exhaustive-deps

  // One tap picks and auditions a note, two quick taps drop it from the chord.
  const lastTap = useRef({ note: -1, time: 0 })

  const tapNote = note => {
    const now = performance.now()
    const double = lastTap.current.note === note && now - lastTap.current.time < DBL_MS
    lastTap.current = { note, time: double ? 0 : now }
    if (double) return onRemoveNote(note)
    setPicked(note)
    onAuditionNote(note)
  }

  const mode = stepMode ? `step rec → ${cursor + 1}` : liveMode ? 'live rec' : ''

  return (
    <section className="editor" style={{ '--tc': TRACK_COLORS[color] }}>
      <div className="ed-head">
        <span id="ed-title">
          <span className="t-dot" /> {trackName} · STEP {step + 1} ·{' '}
          {empty ? 'REST' : `${data.notes.length} note${data.notes.length > 1 ? 's' : ''}`}
        </span>
        {/* read-only: velocity and gate are set by dragging the pad's block */}
        <span className="ed-vals">
          VEL {data.velocity} · GATE {data.gate}%
        </span>
        {mode && <span className="hint rec">{mode}</span>}
        <div className="ed-actions inline">
          <button className="tbtn small" onClick={onBack} title="Step back" disabled={!stepMode}>
            ◀
          </button>
          <button className="tbtn small" onClick={onRest} title="Rest" disabled={!stepMode}>
            REST
          </button>
          <button
            className="tbtn small"
            onClick={onAudition}
            disabled={empty}
            aria-label="Audition step"
          >
            ♪
          </button>
        </div>
      </div>

      <div className="chord" aria-label="Notes in this step">
        {empty && <span className="chord-empty">no notes — this step is silent</span>}
        {data.notes.map(n => (
          <button
            key={n.note}
            className={'chip' + (n.note === active ? ' sel' : '')}
            onClick={() => tapNote(n.note)}
            aria-label={`${noteName(n.note)} — double tap to remove`}
          >
            {noteName(n.note)}
            {n.len > 1 && <i className="chip-len">×{n.len}</i>}
          </button>
        ))}
      </div>
    </section>
  )
}

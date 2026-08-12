import { useEffect, useRef, useState } from 'react'
import { TRACK_COLORS, noteName } from '../model.js'

const DBL_MS = 300 // second tap inside this removes the note

export default function StepEditor({
  trackName,
  color,
  step,
  data,
  onRemoveNote,
  onAudition,
  onAuditionNote,
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

  return (
    <section className="editor" style={{ '--tc': TRACK_COLORS[color] }}>
      {/* three columns: what step this is | its notes | what you can do to it */}
      <div className="ed-head">
        <div className="ed-info">
          {/* the chips in the middle column already say what the step holds */}
          <span id="ed-title">
            <span className="t-dot" /> {trackName} · STEP {step + 1}
          </span>
          {/* read-only: velocity and gate are set by dragging the pad's block */}
          <span className="ed-vals">
            VEL {data.velocity} · GATE {data.gate}%
          </span>
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

        <div className="ed-right">
          <button
            className="tbtn audition"
            onClick={onAudition}
            disabled={empty}
            aria-label="Audition step"
          >
            ♪
          </button>
        </div>
      </div>
    </section>
  )
}

import { useEffect, useRef, useState } from 'react'
import { engine } from '../engine.js'
import { TRACK_COLORS, noteName, stepSounds, sustainMap } from '../model.js'

const DRAG_MIN = 5 // px of movement before a tap becomes a resize
const DBL_MS = 300 // second tap inside this clears the step
const GATE_FULL = 200 // gate % that fills the pad's width

const clamp01 = v => Math.min(1, Math.max(0, v))
const gateWidth = gate => Math.min(100, (gate / GATE_FULL) * 100)

// The one pad grid, shared by every track: it always shows the selected track's
// current slot, so switching tracks re-points it instead of adding another rack.
export default function StepGrid({
  trackIndex,
  trackName,
  steps,
  selectedStep,
  cursor,
  playing,
  onSelectStep,
  onResizeStep,
  onClearStepAt,
}) {
  // The playhead is read from the engine once per animation frame and kept
  // here, not in App: the indicator updates in step with the paint, and a step
  // change re-renders these pads instead of the whole rack.
  const [playhead, setPlayhead] = useState(-1)

  useEffect(() => {
    if (!playing) return setPlayhead(-1)
    let raf = 0
    let last = -1
    const loop = () => {
      const step = engine.playheadAt()
      if (step !== last) {
        last = step
        setPlayhead(step)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  // Dragging on a pad resizes its block: X sets gate, Y sets velocity. A tap
  // that never moves past DRAG_MIN stays a plain select.
  const drag = useRef(null)
  const lastTap = useRef({ step: -1, time: 0 })

  const startDrag = (e, i) => {
    // Two quick taps on the same pad wipe its notes.
    const now = performance.now()
    const double = lastTap.current.step === i && now - lastTap.current.time < DBL_MS
    lastTap.current = { step: i, time: double ? 0 : now }
    if (double) {
      onClearStepAt(i)
      return
    }
    onSelectStep(i)
    drag.current = {
      step: i,
      x0: e.clientX,
      y0: e.clientY,
      rect: e.currentTarget.getBoundingClientRect(),
      moved: false,
    }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }

  const onDragMove = e => {
    const d = drag.current
    if (!d) return
    if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < DRAG_MIN) return
    d.moved = true
    const fx = clamp01((e.clientX - d.rect.left) / d.rect.width)
    const fy = clamp01((e.clientY - d.rect.top) / d.rect.height)
    onResizeStep(d.step, {
      gate: Math.max(5, Math.round((fx * GATE_FULL) / 5) * 5),
      velocity: Math.max(1, Math.round((1 - fy) * 127)),
    })
  }

  const endDrag = e => {
    drag.current?.moved && e.stopPropagation()
    drag.current = null
  }

  const held = sustainMap(steps)

  return (
    <div className="stepgrid" style={{ '--tc': TRACK_COLORS[trackIndex] }}>
      <div className="steps" role="group" aria-label={`${trackName} steps`}>
        {steps.map((s, i) => {
          const cls = [
            'step',
            stepSounds(s) ? 'on' : '',
            held[i] ? 'held' : '', // a note from an earlier step still sounds here
            i === selectedStep ? 'sel' : '',
            i === cursor ? 'cursor' : '',
            i === playhead ? 'playhead' : '',
          ]
            .filter(Boolean)
            .join(' ')
          return (
            <button
              key={i}
              className={cls}
              onPointerDown={e => startDrag(e, i)} // tap selects, drag resizes
              onPointerMove={onDragMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onContextMenu={e => e.preventDefault()}
              aria-label={`${trackName} step ${i + 1}${
                stepSounds(s)
                  ? ' ' + s.notes.map(n => noteName(n.note) + (n.len > 1 ? ` ${n.len} steps` : ''))
                      .join(' ')
                  : held[i]
                    ? ' held'
                    : ' rest'
              }`}
            >
              {s.notes.length > 1 && <span className="n">{s.notes.length}</span>}
              {/* the block IS the step's gate (width) and velocity (height) */}
              <span
                className="blk"
                style={{ width: `${gateWidth(s.gate)}%`, height: `${(s.velocity / 127) * 100}%` }}
              />
            </button>
          )
        })}
      </div>
    </div>
  )
}

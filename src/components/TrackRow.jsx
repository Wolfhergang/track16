import { useEffect, useRef, useState } from 'react'
import { TRACK_COLORS, noteName, stepSounds, sustainMap } from '../model.js'
import Slots from './Slots.jsx'

const ARM_MS = 700 // window for the second tap that actually clears
const DRAG_MIN = 5 // px of movement before a tap becomes a resize
const DBL_MS = 300 // second tap inside this clears the step
const GATE_FULL = 200 // gate % that fills the pad's width

const clamp01 = v => Math.min(1, Math.max(0, v))
const gateWidth = gate => Math.min(100, (gate / GATE_FULL) * 100)

export default function TrackRow({
  index,
  config,
  steps,
  selected,
  selectedStep,
  cursor,
  playhead,
  midiLit,
  onSelectTrack,
  onSelectStep,
  onMute,
  onOverdub,
  onClear,
  onSelectSlot,
  onAddSlot,
  onRemoveSlot,
  songSlot,
  onResizeStep,
  onClearStepAt,
}) {
  // Clear takes two taps instead of a confirm dialog: the first arms the
  // button, a second one inside ARM_MS wipes the slot.
  const [armed, setArmed] = useState(false)
  const armTimer = useRef(null)

  useEffect(() => () => clearTimeout(armTimer.current), [])

  const clear = () => {
    clearTimeout(armTimer.current)
    if (armed) {
      setArmed(false)
      onClear()
      return
    }
    setArmed(true)
    armTimer.current = setTimeout(() => setArmed(false), ARM_MS)
  }

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
    <div
      className={'track' + (selected ? ' sel' : '')}
      style={{ '--tc': TRACK_COLORS[index] }}
    >
      <div className="t-head" onClick={onSelectTrack}>
        <span className="t-dot" />
        <span className="t-name">{config.name}</span>
        <span className="t-ch">CH {config.channel}</span>
        <span
          className={'t-in' + (midiLit ? ' on' : '')}
          role="status"
          aria-label={midiLit ? `${config.name} receiving MIDI` : ''}
          title="MIDI in"
        />
        <div className="t-btns">
          <button
            className={'clear' + (armed ? ' armed' : '')}
            onClick={e => {
              e.stopPropagation()
              clear()
            }}
            aria-label={
              armed
                ? `Tap again to clear ${config.name} slot ${config.currentSlot + 1}`
                : `Clear ${config.name} slot ${config.currentSlot + 1} — tap twice`
            }
          >
            {armed ? 'SURE?' : 'CLR'}
          </button>
          <button
            className={'lock' + (config.overdub ? ' on' : '')}
            onClick={e => {
              e.stopPropagation()
              onOverdub()
            }}
            aria-pressed={!!config.overdub}
            aria-label={
              config.overdub
                ? `${config.name}: recording adds to existing notes`
                : `${config.name}: recording replaces the step`
            }
            title="Lock notes: recording adds instead of replacing"
          >
            {config.overdub ? '🔒' : '🔓'}
          </button>
          <button
            className={'mute' + (config.mute ? ' on' : '')}
            onClick={e => {
              e.stopPropagation()
              onMute()
            }}
            aria-label={`Mute ${config.name}`}
            aria-pressed={config.mute}
          >
            M
          </button>
        </div>
      </div>

      <Slots
        track={config}
        playing={songSlot}
        onSelect={onSelectSlot}
        onAdd={onAddSlot}
        onRemove={onRemoveSlot}
      />

      <div className="steps">
        {steps.map((s, i) => {
          const cls = [
            'step',
            stepSounds(s) ? 'on' : '',
            held[i] ? 'held' : '', // a note from an earlier step still sounds here
            selected && i === selectedStep ? 'sel' : '',
            selected && i === cursor ? 'cursor' : '',
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
              aria-label={`${config.name} step ${i + 1}${
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

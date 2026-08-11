import { useEffect, useRef, useState } from 'react'
import { engine } from '../engine.js'
import { MAX_TRACKS, TRACK_COLORS } from '../model.js'

export const IO_KEY = 'step16.io'

const readIo = () => {
  try {
    return JSON.parse(localStorage.getItem(IO_KEY) || '{}')
  } catch {
    return {}
  }
}

const writeIo = patch => {
  try {
    localStorage.setItem(IO_KEY, JSON.stringify({ ...readIo(), ...patch }))
  } catch {
    /* ignore */
  }
}

export default function Settings({ state, ports, midiStatus, onClose, onTrack, onAddTrack, onRemoveTrack }) {
  const ref = useRef(null)
  const [outId, setOutId] = useState(engine.out?.id || '')
  const [inId, setInId] = useState(engine.in?.id || '')
  const [clockOut, setClockOut] = useState(engine.clockOut)
  const [preview, setPreview] = useState(engine.preview)
  // Removing a track drops its 10 patterns, so it takes two taps.
  const [armed, setArmed] = useState(-1)
  const armTimer = useRef(null)

  useEffect(() => {
    ref.current?.showModal()
    return () => clearTimeout(armTimer.current)
  }, [])

  const removeTrack = i => {
    clearTimeout(armTimer.current)
    if (armed === i) {
      setArmed(-1)
      onRemoveTrack(i)
      return
    }
    setArmed(i)
    armTimer.current = setTimeout(() => setArmed(-1), 700)
  }

  const pickOut = id => {
    setOutId(id)
    engine.setOutput(id)
    writeIo({ out: id })
  }
  const pickIn = id => {
    setInId(id)
    engine.setInput(id)
    writeIo({ in: id })
  }

  return (
    <dialog ref={ref} onClose={onClose} onCancel={onClose}>
      <h2>Settings</h2>

      <label className="s-row">
        MIDI out
        <select value={outId} onChange={e => pickOut(e.target.value)}>
          <option value="">— none (audio only) —</option>
          {ports.outputs.map(p => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <label className="s-row">
        MIDI in
        <select value={inId} onChange={e => pickIn(e.target.value)}>
          <option value="">— none —</option>
          {ports.inputs.map(p => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <label className="s-row">
        MIDI clock out
        <input
          type="checkbox"
          checked={clockOut}
          onChange={e => {
            setClockOut(e.target.checked)
            engine.clockOut = e.target.checked
            writeIo({ clockOut: e.target.checked })
          }}
        />
      </label>

      <label className="s-row">
        Audio preview
        <input
          type="checkbox"
          checked={preview}
          onChange={e => {
            setPreview(e.target.checked)
            engine.preview = e.target.checked
            writeIo({ preview: e.target.checked })
          }}
        />
      </label>

      <h3>
        Tracks ({state.tracks.length}/{MAX_TRACKS})
      </h3>
      <div className="track-cfg">
        {state.tracks.map((t, i) => (
          <div className="tc-row" key={i}>
            <span className="t-dot" style={{ '--tc': TRACK_COLORS[i] }} />
            <input
              value={t.name}
              maxLength={10}
              onChange={e => onTrack(i, { name: e.target.value })}
              aria-label={`Track ${i + 1} name`}
            />
            <select
              value={t.channel}
              onChange={e => onTrack(i, { channel: +e.target.value })}
              aria-label={`Track ${i + 1} MIDI channel`}
            >
              {Array.from({ length: 16 }, (_, c) => (
                <option key={c} value={c + 1}>
                  CH {c + 1}
                </option>
              ))}
            </select>
            <button
              className={'tc-del' + (armed === i ? ' armed' : '')}
              onClick={() => removeTrack(i)}
              disabled={state.tracks.length < 2}
              aria-label={
                armed === i ? `Tap again to remove ${t.name}` : `Remove ${t.name} — tap twice`
              }
            >
              {armed === i ? 'SURE?' : '✕'}
            </button>
          </div>
        ))}
      </div>

      <button
        className="tbtn wide"
        onClick={onAddTrack}
        disabled={state.tracks.length >= MAX_TRACKS}
        style={{ marginTop: 8, width: '100%' }}
      >
        + Add track
      </button>

      <p className="hint">{midiStatus}</p>
      <p className="hint">
        Each track owns its own slots (1–10): `+` adds one, a double tap deletes one, `CLR` clears
        the current one. SONG mode cycles every track through its slots, one per pass.
      </p>
      <p className="hint">
        Notes come from an external MIDI controller — pick a MIDI in above. They record into the
        track(s) whose channel they arrive on, and are never echoed back out.
      </p>

      <button className="tbtn wide primary" onClick={() => ref.current?.close()}>
        Done
      </button>
    </dialog>
  )
}

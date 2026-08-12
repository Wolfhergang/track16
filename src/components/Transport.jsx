import { useEffect, useRef, useState } from 'react'
import { BPM_MAX, BPM_MIN } from '../model.js'

const TAP_RESET_MS = 2000 // gap that starts a fresh tap series
const TAP_WINDOW = 5 // taps averaged
const ARM_MS = 700 // window for the second tap that actually clears

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))

// Digits-only text field: strips anything non-numeric as you type, commits a
// clamped value on blur/Enter so a half-typed number never snaps back.
function NumField({ id, label, value, min, max, onCommit }) {
  const [text, setText] = useState(String(value))
  const [editing, setEditing] = useState(false)
  const maxLen = String(max).length

  useEffect(() => {
    if (!editing) setText(String(value))
  }, [value, editing])

  const change = e => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, maxLen)
    setText(digits)
    const n = Number(digits)
    if (digits && n >= min && n <= max) onCommit(n)
  }

  const commit = () => {
    setEditing(false)
    const n = text ? clamp(Number(text), min, max) : value
    setText(String(n))
    onCommit(n)
  }

  return (
    <div className="tempo">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        maxLength={maxLen}
        value={text}
        onFocus={() => setEditing(true)}
        onChange={change}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
      />
    </div>
  )
}

const HOLD_DELAY = 400 // press-and-hold before auto-repeat kicks in
const HOLD_RATE = 80

// ±1 button that repeats while held. `step` is read through a ref so the
// repeat always nudges the current value, not the one captured at press time.
function Nudge({ dir, label, onStep }) {
  const timers = useRef({ delay: null, repeat: null })

  const stop = () => {
    clearTimeout(timers.current.delay)
    clearInterval(timers.current.repeat)
  }

  useEffect(() => stop, [])

  const press = () => {
    onStep(dir)
    timers.current.delay = setTimeout(() => {
      timers.current.repeat = setInterval(() => onStep(dir), HOLD_RATE)
    }, HOLD_DELAY)
  }

  return (
    <button
      className="tbtn small nudge"
      onPointerDown={press}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={e => e.preventDefault()}
      aria-label={label}
    >
      {dir > 0 ? '▲' : '▼'}
    </button>
  )
}

export default function Transport({
  playing,
  recording,
  bpm,
  swing,
  onPlay,
  onRec,
  onBpm,
  onSwing,
  onUndo,
  canUndo,
  onClearAll,
  song,
  onSong,
  onSettings,
}) {
  // Wiping the song takes two taps: the first arms the button, a second one
  // inside ARM_MS goes through with it.
  const [armed, setArmed] = useState(false)
  const armTimer = useRef(null)

  useEffect(() => () => clearTimeout(armTimer.current), [])

  const clearAll = () => {
    clearTimeout(armTimer.current)
    if (armed) {
      setArmed(false)
      onClearAll()
      return
    }
    setArmed(true)
    armTimer.current = setTimeout(() => setArmed(false), ARM_MS)
  }

  const taps = useRef([])
  const [count, setCount] = useState(0)
  const idle = useRef(null)
  const latestBpm = useRef(bpm)
  latestBpm.current = bpm

  const nudgeBpm = dir => {
    const next = clamp(latestBpm.current + dir, BPM_MIN, BPM_MAX)
    latestBpm.current = next
    onBpm(next)
  }

  useEffect(() => () => clearTimeout(idle.current), [])

  const tap = () => {
    const now = performance.now()
    const t = taps.current
    if (t.length && now - t[t.length - 1] > TAP_RESET_MS) t.length = 0
    t.push(now)
    if (t.length > TAP_WINDOW) t.shift()
    setCount(t.length)

    if (t.length > 1) {
      const avg = (t[t.length - 1] - t[0]) / (t.length - 1)
      onBpm(clamp(Math.round(60000 / avg), BPM_MIN, BPM_MAX))
    }

    clearTimeout(idle.current)
    idle.current = setTimeout(() => setCount(0), TAP_RESET_MS)
  }

  return (
    <header className="bar">
      <div className="transport">
        <button
          className={'tbtn play' + (playing ? ' on' : '')}
          onClick={onPlay}
          aria-label={playing ? 'Stop' : 'Play'}
        >
          {playing ? '■' : '▶'}
        </button>
        <button
          className={'tbtn rec' + (recording ? ' on' : '')}
          onClick={onRec}
          aria-label="Record"
          aria-pressed={recording}
        >
          ●
        </button>
      </div>

      <button
        className={'tbtn song' + (song ? ' on' : '')}
        onClick={() => onSong(!song)}
        role="switch"
        aria-checked={song}
        aria-label="Song mode: cycle each track through its memory slots"
        title="Song mode"
      >
        SONG
      </button>

      <button
        className={'tbtn tap' + (count ? ' on' : '')}
        onPointerDown={tap}
        aria-label="Tap tempo"
      >
        TAP{count > 1 ? ` ${count}` : ''}
      </button>

      <div className="bpm-field">
        <Nudge dir={-1} label="Tempo down" onStep={nudgeBpm} />
        <NumField id="bpm" label="BPM" value={bpm} min={BPM_MIN} max={BPM_MAX} onCommit={onBpm} />
        <Nudge dir={1} label="Tempo up" onStep={nudgeBpm} />
      </div>

      <NumField id="swing" label="SWING" value={swing} min={0} max={70} onCommit={onSwing} />

      <button
        className="tbtn small undo"
        onClick={onUndo}
        disabled={!canUndo}
        aria-label="Undo last edit"
        title="Undo"
      >
        ↶
      </button>

      <button
        className={'tbtn small clear-all' + (armed ? ' armed' : '')}
        onClick={clearAll}
        title="Clear every section"
        aria-label={
          armed
            ? 'Tap again to clear every section'
            : 'Clear every section — tap twice'
        }
      >
        {armed ? 'SURE?' : 'CLR'}
      </button>

      <button className="tbtn small" onClick={onSettings} aria-label="Settings">
        ⚙
      </button>
    </header>
  )
}

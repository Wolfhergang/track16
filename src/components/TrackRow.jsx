import { useEffect, useRef, useState } from 'react'
import { TRACK_COLORS } from '../model.js'
import Slots from './Slots.jsx'

const ARM_MS = 700 // window for the second tap that actually clears

// A track's header: what it is, which slot it plays, and its switches. The pads
// live in the single StepGrid below the rack, pointed at the selected track.
export default function TrackRow({
  index,
  config,
  selected,
  midiLit,
  onSelectTrack,
  onMute,
  onClear,
  onSelectSlot,
  onAddSlot,
  onRemoveSlot,
  songSlot,
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

        <Slots
          track={config}
          playing={songSlot}
          onSelect={onSelectSlot}
          onAdd={onAddSlot}
          onRemove={onRemoveSlot}
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
            {armed ? 'SURE?' : '🗑'}
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

        {/* set in Settings — here it is a read-only tell-tale */}
        <span
          className={'t-mono' + (config.mono ? '' : ' poly')}
          title={
            config.mono ? 'Monophonic: one note per step' : 'Polyphonic: a step holds a chord'
          }
        >
          {config.mono ? 'MONO' : 'POLY'}
        </span>
      </div>
    </div>
  )
}

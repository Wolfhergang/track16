import { useRef } from 'react'
import { SLOTS, patternHasData } from '../model.js'

const DBL_MS = 300 // second tap inside this deletes the slot

// One bank per track, rendered inside that track's panel: switching a slot
// re-patterns that track only. A track starts with one slot and grows to SLOTS.
export default function Slots({ track, playing, onSelect, onAdd, onRemove }) {
  const lastTap = useRef({ slot: -1, time: 0 })

  const tap = i => {
    const now = performance.now()
    const double = lastTap.current.slot === i && now - lastTap.current.time < DBL_MS
    lastTap.current = { slot: i, time: double ? 0 : now }
    if (double && track.slots.length > 1) return onRemove(i)
    onSelect(i)
  }

  return (
    <div className="slots" role="group" aria-label={`${track.name} memory slots`}>
      {track.slots.map((pattern, i) => {
        const cls = [
          'slot',
          patternHasData(pattern) ? 'has' : '',
          i === track.currentSlot ? 'sel' : '',
          i === playing ? 'playing' : '',
        ]
          .filter(Boolean)
          .join(' ')
        return (
          <button
            key={i}
            className={cls}
            onClick={e => {
              e.stopPropagation()
              tap(i)
            }}
            aria-label={`${track.name} memory slot ${i + 1}${
              track.slots.length > 1 ? ' — double tap to delete' : ''
            }`}
            aria-pressed={i === track.currentSlot}
          >
            {i + 1}
          </button>
        )
      })}

      {track.slots.length < SLOTS && (
        <button
          className="slot add"
          onClick={e => {
            e.stopPropagation()
            onAdd()
          }}
          aria-label={`Add a memory slot to ${track.name}`}
        >
          +
        </button>
      )}
    </div>
  )
}

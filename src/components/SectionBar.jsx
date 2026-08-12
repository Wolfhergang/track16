import { useEffect, useRef, useState } from 'react'
import { SECTIONS } from '../model.js'

const LETTERS = ['A', 'B', 'C', 'D']
const ARM_MS = 700 // window for the second tap that overwrites

// The song's parts. Every section holds the same tracks with its own memory
// slots, so switching one swaps every track's patterns at once. Tapped while
// the sequence runs, a section is queued: `pending` is the one waiting for the
// current pass to finish.
export default function SectionBar({ current, pending, filled, onSelect, onCopy }) {
  // ▸ pulls the section before this one into it. That overwrites what is here,
  // so over patterns it takes two taps — the first one arms the arrow.
  const [armed, setArmed] = useState(-1)
  const armTimer = useRef(null)

  useEffect(() => () => clearTimeout(armTimer.current), [])

  // `i` is the section being written into — the copy comes from the one before.
  const copy = i => {
    clearTimeout(armTimer.current)
    if (!filled[i] || armed === i) {
      setArmed(-1)
      onCopy(i - 1)
      return
    }
    setArmed(i)
    armTimer.current = setTimeout(() => setArmed(-1), ARM_MS)
  }

  return (
    <nav className="sections" role="group" aria-label="Song sections">
      {Array.from({ length: SECTIONS }, (_, i) => {
        const cls = [
          'section',
          i === current ? 'sel' : '',
          i === pending ? 'queued' : '',
          filled[i] ? 'has' : '',
        ]
          .filter(Boolean)
          .join(' ')
        return (
          <div className="section-cell" key={i}>
            {i > 0 && (
              <button
                className={'section-copy' + (armed === i ? ' armed' : '')}
                onClick={() => copy(i)}
                disabled={!filled[i - 1]}
                title={`Copy ${LETTERS[i - 1]} into ${LETTERS[i]}`}
                aria-label={
                  armed === i
                    ? `Tap again to overwrite section ${LETTERS[i]} with ${LETTERS[i - 1]}`
                    : `Copy section ${LETTERS[i - 1]} into ${LETTERS[i]}${
                        filled[i] ? ' — tap twice, it has patterns' : ''
                      }`
                }
              >
                ▸
              </button>
            )}
            <button
              className={cls}
              onClick={() => onSelect(i)}
              aria-pressed={i === current}
              aria-label={`Section ${LETTERS[i]}${
                i === pending ? ' — queued, starts at the end of this pass' : ''
              }`}
            >
              {LETTERS[i]}
            </button>
          </div>
        )
      })}
    </nav>
  )
}

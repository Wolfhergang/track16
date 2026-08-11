'use client'

import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { engine, STEPS } from './engine.js'
import { load, patternHasData, reducer, save, trackPattern } from './model.js'
import Transport from './components/Transport.jsx'
import TrackRow from './components/TrackRow.jsx'
import StepEditor from './components/StepEditor.jsx'
import Settings from './components/Settings.jsx'
import InstallPrompt from './components/InstallPrompt.jsx'

const CHORD_MS = 140 // notes arriving inside this window stack into one step
const BLINK_MS = 160 // how long a track's MIDI-in light stays lit

/* ---------- undo ---------- */

const HISTORY = 40 // snapshots kept
const COALESCE_MS = 500 // edits closer than this collapse into one undo step
// Only content edits are undoable — selection, transport and track config are not.
const EDITS = new Set([
  'step',
  'clearStep',
  'writeStep',
  'removeNote',
  'setNoteLen',
  'clearTrack',
  'addSlot',
  'removeSlot',
  'addTrack',
  'removeTrack',
])

export default function App() {
  const [state, rawDispatch] = useReducer(reducer, undefined, load)
  const [playing, setPlaying] = useState(false)
  const [recording, setRecording] = useState(false)
  const [playhead, setPlayhead] = useState(-1)
  const [ports, setPorts] = useState({ inputs: [], outputs: [] })
  const [midiStatus, setMidiStatus] = useState('Requesting MIDI access…')
  const [showSettings, setShowSettings] = useState(false)
  const [songSlots, setSongSlots] = useState([]) // slot each track plays in song mode

  const track = state.tracks[state.selectedTrack]
  const pattern = trackPattern(track)
  const stepData = pattern.steps[state.selectedStep]

  // Latest values for callbacks the engine owns (they outlive any single render).
  const live = useRef({ state, recording, playing })
  live.current = { state, recording, playing }

  /* ---------- undo ---------- */

  const past = useRef([])
  const lastEdit = useRef(0)
  const [canUndo, setCanUndo] = useState(false)

  // Every dispatch goes through here: content edits snapshot the state they are
  // about to change, so one tap of ↶ puts it back. A burst of edits (a chord, a
  // slider drag) collapses into a single snapshot.
  const dispatch = useCallback(action => {
    if (EDITS.has(action.type)) {
      const now = performance.now()
      if (now - lastEdit.current > COALESCE_MS) {
        past.current = [...past.current, live.current.state].slice(-HISTORY)
        setCanUndo(true)
      }
      lastEdit.current = now
    }
    rawDispatch(action)
  }, [])

  const undo = useCallback(() => {
    const prev = past.current[past.current.length - 1]
    if (!prev) return
    past.current = past.current.slice(0, -1)
    setCanUndo(past.current.length > 0)
    lastEdit.current = 0
    rawDispatch({ type: 'load', state: prev })
  }, [])

  /* ---------- engine wiring ---------- */

  useEffect(() => {
    engine.setState({
      patterns: state.tracks.map(trackPattern),
      slots: state.tracks.map(t => t.slots),
      currents: state.tracks.map(t => t.currentSlot),
      tracks: state.tracks,
      bpm: state.bpm,
      swing: state.swing,
      song: state.song,
    })
  }, [state.tracks, state.bpm, state.swing, state.song])

  useEffect(() => {
    engine.onStep = (step, time) => {
      if (step < 0) return setPlayhead(-1)
      const delay = Math.max(0, time - performance.now())
      // Steps are scheduled ahead of time; drop any that land after a stop.
      setTimeout(() => setPlayhead(engine.playing ? step : -1), delay)
    }
    engine.onPorts = setPorts
    engine.onError = setMidiStatus
    // Song mode drags the selection along with playback, so recording keeps
    // writing into whichever slot is sounding — one pass per slot, continuously.
    engine.onSong = (slots, time) => {
      const delay = Math.max(0, time - performance.now())
      setTimeout(() => {
        if (!engine.playing) return
        setSongSlots(slots)
        dispatch({ type: 'syncSlots', slots })
      }, delay)
    }
    engine.initMidi().then(access => {
      if (access) setMidiStatus('Web MIDI ready.')
    })
    return () => {
      engine.stop()
      engine.onStep = null
      engine.onPorts = null
      engine.onSong = null
    }
  }, [])

  // Re-apply saved port choices whenever the device list changes (reconnects).
  useEffect(() => {
    let pref = {}
    try {
      pref = JSON.parse(localStorage.getItem('step16.io') || '{}')
    } catch {
      pref = {}
    }
    if (pref.clockOut != null) engine.clockOut = pref.clockOut
    if (pref.preview != null) engine.preview = pref.preview
    if (pref.out && !engine.out && ports.outputs.some(p => p.id === pref.out)) {
      engine.setOutput(pref.out)
    }
    if (pref.in && !engine.in && ports.inputs.some(p => p.id === pref.in)) {
      engine.setInput(pref.in)
    }
  }, [ports])

  /* ---------- persistence ---------- */

  useEffect(() => {
    const id = setTimeout(() => save(state), 250)
    return () => clearTimeout(id)
  }, [state])

  /* ---------- note input (external MIDI controller only) ---------- */

  const chord = useRef({ time: 0, step: -1 })
  const [litChannel, setLitChannel] = useState(0) // MIDI channel arriving right now
  const blink = useRef(null)

  useEffect(() => () => clearTimeout(blink.current), [])

  const flash = useCallback(channel => {
    setLitChannel(channel)
    clearTimeout(blink.current)
    blink.current = setTimeout(() => setLitChannel(0), BLINK_MS)
  }, [])

  // Notes still down, so a live-recorded note can be stretched over the steps
  // it is held through: pitch -> where it was written and when.
  const holds = useRef(new Map())

  // Incoming notes are recorded, never echoed — the controller's own instrument
  // is what you hear while playing. A note goes to the track(s) whose MIDI
  // channel it arrived on; a channel no track listens to is dropped.
  const noteOn = useCallback((note, velocity = 100, channel) => {
    const { state: s, recording: rec, playing: play } = live.current
    if (!rec) return

    const targets = s.tracks.reduce((acc, t, i) => (t.channel === channel ? [...acc, i] : acc), [])
    if (!targets.length) return

    const now = performance.now()
    const held = now - chord.current.time < CHORD_MS
    // `remember` tracks the key for sustain capture — only meaningful against a
    // running clock, so step record always writes single-step notes.
    // The first note of a gesture replaces what the step held unless that track
    // is locked; the rest of a chord always piles onto that same step.
    const write = (step, remember, sameStep) => {
      for (const t of targets) {
        const replace = !s.tracks[t].overdub && !sameStep
        dispatch({ type: 'writeStep', track: t, step, note, velocity, len: 1, replace })
      }
      dispatch({ type: 'set', key: 'selectedTrack', value: targets[0] })
      dispatch({ type: 'set', key: 'selectedStep', value: step })
      if (remember) holds.current.set(`${channel}:${note}`, { targets, step, time: now })
      chord.current = { time: now, step }
    }

    if (play) {
      // Live record: quantize to the nearest step.
      const step = engine.liveStep()
      if (step == null) return
      write(step, true, held && chord.current.step === step)
    } else {
      // Step record: write at the cursor, then advance. Notes played together
      // land on the step just written instead of taking the next one.
      const sameStep = held && chord.current.step >= 0
      const step = sameStep ? chord.current.step : s.cursor
      write(step, false, sameStep)
      if (!sameStep) dispatch({ type: 'set', key: 'cursor', value: (step + 1) % STEPS })
    }
  }, [])

  // Releasing a key sets how many steps the recorded note is held for, so a
  // note carried across steps plays back as one long note instead of repeats.
  const noteOff = useCallback((note, channel) => {
    const key = `${channel}:${note}`
    const h = holds.current.get(key)
    if (!h) return
    holds.current.delete(key)
    // Held past the end of the pattern? Stop at step 16 instead of wrapping.
    const steps = Math.round((performance.now() - h.time) / engine.stepDur)
    const len = Math.min(STEPS - h.step, Math.max(1, steps))
    if (len < 2) return
    for (const t of h.targets) {
      dispatch({ type: 'setNoteLen', track: t, step: h.step, note, len })
    }
  }, [])

  useEffect(() => {
    engine.onMidiIn = ({ note, velocity, channel, on }) => {
      if (!on) return noteOff(note, channel)
      flash(channel) // lights every track set to that channel
      noteOn(note, velocity, channel)
    }
    return () => {
      engine.onMidiIn = null
    }
  }, [noteOn, noteOff, flash])

  /* ---------- transport ---------- */

  const togglePlay = useCallback(() => {
    engine.ensureAudio()
    engine.toggle()
    setPlaying(engine.playing)
    if (!engine.playing) setPlayhead(-1)
  }, [])

  const toggleRec = () => {
    engine.ensureAudio()
    setRecording(r => !r)
  }

  // Space toggles the transport unless the user is typing in a field.
  useEffect(() => {
    const onKey = e => {
      if (e.code !== 'Space' && e.key !== ' ') return
      const el = document.activeElement
      const tag = el?.tagName
      if (
        el?.isContentEditable ||
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        el?.closest?.('dialog[open]')
      ) {
        return
      }
      e.preventDefault()
      togglePlay()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay])

  const selectSlot = (trackIndex, slot) => {
    dispatch({ type: 'set', key: 'selectedTrack', value: trackIndex })
    dispatch({ type: 'selectSlot', track: trackIndex, slot })
  }

  const clearTrack = i => {
    if (!patternHasData(trackPattern(state.tracks[i]))) return
    dispatch({ type: 'clearTrack', track: i })
  }

  // Play a step exactly as the sequencer would, held notes and gate included.
  const auditionStep = (trackIndex, step) => {
    const cfg = state.tracks[trackIndex]
    for (const n of step.notes) {
      const dur = Math.max(120, engine.stepDur * (n.len - 1 + step.gate / 100))
      engine.audition(cfg.channel - 1, n.note, step.velocity, dur, trackIndex)
    }
  }

  const stepMode = recording && !playing

  return (
    <>
      <Transport
        playing={playing}
        recording={recording}
        bpm={state.bpm}
        swing={state.swing}
        onPlay={togglePlay}
        onRec={toggleRec}
        onBpm={v => dispatch({ type: 'set', key: 'bpm', value: v })}
        onSwing={v => dispatch({ type: 'set', key: 'swing', value: v })}
        onUndo={undo}
        canUndo={canUndo}
        song={state.song}
        onSong={v => dispatch({ type: 'set', key: 'song', value: v })}
        onSettings={() => setShowSettings(true)}
      />

      <main className="grid">
        {state.tracks.map((cfg, i) => (
          <TrackRow
            key={i}
            index={i}
            config={cfg}
            steps={trackPattern(cfg).steps}
            selected={state.selectedTrack === i}
            selectedStep={state.selectedStep}
            cursor={stepMode ? state.cursor : -1}
            playhead={playhead}
            midiLit={litChannel === cfg.channel}
            onSelectTrack={() => dispatch({ type: 'set', key: 'selectedTrack', value: i })}
            onSelectStep={step => {
              dispatch({ type: 'set', key: 'selectedTrack', value: i })
              dispatch({ type: 'set', key: 'selectedStep', value: step })
              dispatch({ type: 'set', key: 'cursor', value: step })
              auditionStep(i, trackPattern(cfg).steps[step]) // hear what it holds
            }}
            onMute={() => dispatch({ type: 'track', index: i, patch: { mute: !cfg.mute } })}
            onOverdub={() =>
              dispatch({ type: 'track', index: i, patch: { overdub: !cfg.overdub } })
            }
            onClear={() => clearTrack(i)}
            onSelectSlot={slot => selectSlot(i, slot)}
            onAddSlot={() => dispatch({ type: 'addSlot', track: i })}
            onRemoveSlot={slot => dispatch({ type: 'removeSlot', track: i, slot })}
            songSlot={state.song && playing ? songSlots[i] : -1}
            onResizeStep={(step, patch) => dispatch({ type: 'step', track: i, step, patch })}
            onClearStepAt={step => dispatch({ type: 'clearStep', track: i, step })}
          />
        ))}
      </main>

      <StepEditor
        trackName={track.name}
        color={state.selectedTrack}
        step={state.selectedStep}
        data={stepData}
        stepMode={stepMode}
        liveMode={recording && playing}
        cursor={state.cursor}
        onRemoveNote={note =>
          dispatch({
            type: 'removeNote',
            track: state.selectedTrack,
            step: state.selectedStep,
            note,
          })
        }
        onAuditionNote={note =>
          engine.audition(track.channel - 1, note, stepData.velocity, 200, state.selectedTrack)
        }
        onAudition={() => auditionStep(state.selectedTrack, stepData)}
        onBack={() =>
          dispatch({ type: 'set', key: 'cursor', value: (state.cursor + STEPS - 1) % STEPS })
        }
        onRest={() => dispatch({ type: 'set', key: 'cursor', value: (state.cursor + 1) % STEPS })}
      />

      {showSettings && (
        <Settings
          state={state}
          ports={ports}
          midiStatus={midiStatus}
          onClose={() => setShowSettings(false)}
          onTrack={(index, patch) => dispatch({ type: 'track', index, patch })}
          onAddTrack={() => dispatch({ type: 'addTrack' })}
          onRemoveTrack={index => dispatch({ type: 'removeTrack', index })}
        />
      )}

      <InstallPrompt />
    </>
  )
}

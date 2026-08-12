import { STEPS, TRACKS, SLOTS } from './engine.js'

export const STORAGE_KEY = 'step16.v2'
const LEGACY_KEY = 'step16.v1' // one global slot bank, one note per step

export const MAX_TRACKS = 5
export const SECTIONS = 4 // A–D: parts of a song, each with its own slots
export const TRACK_COLORS = ['#4ad6a0', '#54a8ff', '#ffb84d', '#c07dff', '#ff7ba6']
const DEFAULT_NOTES = [36, 38, 42, 60, 48] // kick, snare, hat, lead, bass
const DEFAULT_NAMES = ['TRK 1', 'TRK 2', 'TRK 3', 'TRK 4', 'TRK 5']

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
export const noteName = n => `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`

export const BPM_MIN = 20
export const BPM_MAX = 220
export const clampBpm = b => Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(b) || 120))

export const clampNote = n => Math.min(127, Math.max(0, Math.round(n)))
export const clampLen = l => Math.min(STEPS, Math.max(1, Math.round(l) || 1))
// A note never wraps past the last step — it is cut at the end of the pattern
// instead of bleeding into step 1 on the next pass.
export const fitLen = (len, step) => Math.max(1, Math.min(clampLen(len), STEPS - step))

// A note entry is { note, len }: `len` is how many steps it is held for, so a
// note sustained across steps is one uninterrupted note, not a retrigger.
export const mkNote = (note, len = 1) => ({ note: clampNote(note), len: clampLen(len) })

// Highest len wins if the same pitch shows up twice, and notes stay pitch-sorted.
const tidyNotes = notes => {
  const byPitch = new Map()
  for (const n of notes) {
    const prev = byPitch.get(n.note)
    byPitch.set(n.note, prev ? mkNote(n.note, Math.max(prev.len, n.len)) : mkNote(n.note, n.len))
  }
  return [...byPitch.values()].sort((a, b) => a.note - b.note)
}

// A step holds a chord: any number of notes sharing velocity and gate. There is
// no on/off flag — a step sounds when it holds notes, an empty step is a rest.
export const emptyStep = () => ({ notes: [], velocity: 100, gate: 50 })
const emptyPattern = () => ({ steps: Array.from({ length: STEPS }, emptyStep) })

// Deep enough that editing the copy never reaches back into the original.
const clonePattern = p => ({
  steps: p.steps.map(s => ({ ...s, notes: s.notes.map(n => ({ ...n })) })),
})

// A track's identity is shared by every section — same name, channel and
// switches throughout the song. Only its patterns change from section to
// section, and those live in `sections` below.
const makeTrack = i => ({
  name: DEFAULT_NAMES[i] ?? `TRK ${i + 1}`,
  channel: (i % 16) + 1,
  note: DEFAULT_NOTES[i] ?? 60,
  mute: false,
  overdub: false, // false: a recorded note replaces the step, true: it piles on
  mono: false, // one note per step: the first one played wins, the rest are dropped
})

// One section's half of a track: the memory slots it plays there.
const makeSlotTrack = () => ({
  currentSlot: 0,
  slots: [emptyPattern()], // tracks start with one slot; `+` adds up to SLOTS
})

const makeSection = count => ({ tracks: Array.from({ length: count }, makeSlotTrack) })

export function initialState() {
  return {
    bpm: 120,
    swing: 0,
    selectedTrack: 0,
    selectedStep: 0,
    cursor: 0, // step-record write head
    song: false, // song mode: each track cycles through its slots, one per pass
    tracks: Array.from({ length: TRACKS }, (_, i) => makeTrack(i)),
    // all four exist from the start — an empty one is just silence
    sections: Array.from({ length: SECTIONS }, () => makeSection(TRACKS)),
    section: 0, // the section being played and edited
  }
}

/* ---------------- selectors ---------------- */

export const trackPattern = track => track.slots[track.currentSlot]

// The slot half of every track in the section that is up right now.
export const sectionTracks = state => state.sections[state.section].tracks
// Config and slots of one track, joined — what the rack and the pads work with.
export const liveTrack = (state, i) => ({ ...state.tracks[i], ...sectionTracks(state)[i] })
export const stepSounds = step => step.notes.length > 0
export const patternHasData = pattern => pattern.steps.some(stepSounds)
export const pitches = step => step.notes.map(n => n.note)

// Steps each note of `steps` reaches over, so the UI can draw sustain tails.
// Index i is true when a note starting earlier is still sounding at step i.
export function sustainMap(steps) {
  const held = steps.map(() => false)
  steps.forEach((s, i) => {
    for (const n of s.notes) {
      for (let k = 1; k < n.len && i + k < steps.length; k++) held[i + k] = true
    }
  })
  return held
}

/* ---------------- persistence ---------------- */

export function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return hydrate(JSON.parse(raw))
    const legacy = localStorage.getItem(LEGACY_KEY)
    if (legacy) return migrateV1(JSON.parse(legacy))
  } catch {
    /* corrupt save — fall through to defaults */
  }
  return initialState()
}

export function save(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* private mode / quota — playback still works, just no persistence */
  }
}

// Handles every older shape: a bare `note`, a list of pitch numbers, and the
// on/off flag steps used to carry (an off step becomes a rest).
const normalizeStep = (s, fallback, index = 0) => {
  let raw = []
  if (Array.isArray(s?.notes)) raw = s.notes
  else if (s) raw = [s.note ?? fallback]
  if (s?.on === false) raw = [] // legacy off step
  return {
    notes: tidyNotes(
      raw.map(n =>
        typeof n === 'object' ? mkNote(n.note, fitLen(n.len, index)) : mkNote(n),
      ),
    ),
    velocity: s?.velocity ?? 100,
    gate: s?.gate ?? 50,
  }
}

const normalizePattern = (p, fallback) => ({
  steps: Array.from({ length: STEPS }, (_, i) => normalizeStep(p?.steps?.[i], fallback, i)),
})

// Shallow-merge onto defaults so older saves survive schema growth. The saved
// track count wins (1..MAX_TRACKS) — the rack is resizable.
// Saves from when every track had a fixed bank of 10 keep only the slots that
// hold something, so an untouched rack opens with one slot per track again.
const trimSlots = slots => {
  let last = 0
  slots.forEach((p, i) => {
    if (patternHasData(p)) last = i
  })
  return slots.slice(0, last + 1)
}

// Slots and their patterns, as saved by any older shape. `src` is a track from
// a save (which used to carry its own slots) or one section's half of it.
function readSlots(src, fallback) {
  const saw = Math.min(SLOTS, Math.max(1, src?.slots?.length || 1))
  const slots = trimSlots(
    Array.from({ length: saw }, (_, s) => normalizePattern(src?.slots?.[s], fallback)),
  )
  return { slots, currentSlot: clampIndex(src?.currentSlot, slots.length) }
}

function hydrate(saved) {
  const base = initialState()
  const count = Math.min(MAX_TRACKS, Math.max(1, saved?.tracks?.length || base.tracks.length))
  const tracks = Array.from({ length: count }, (_, i) => {
    const def = makeTrack(i)
    const t = saved?.tracks?.[i]
    if (!t) return def
    // saves from before sections kept slots here — those are stripped off and
    // become section A below
    const { slots, currentSlot, ...cfg } = t
    return { ...def, ...cfg }
  })
  // Pre-sections saves have no `sections`: the tracks' own slots are section A.
  // Missing sections (older save, fewer of them) come back empty.
  const savedSections = saved?.sections?.length ? saved.sections : [{ tracks: saved?.tracks || [] }]
  const sections = Array.from({ length: SECTIONS }, (_, s) => ({
    tracks: Array.from({ length: count }, (_, i) =>
      readSlots(savedSections[s]?.tracks?.[i], saved?.tracks?.[i]?.note ?? makeTrack(i).note),
    ),
  }))
  return {
    ...base,
    ...saved,
    tracks,
    sections,
    section: clampIndex(saved?.section, sections.length),
    // a tempo saved before the ceiling moved is pulled back into range
    bpm: clampBpm(saved?.bpm ?? base.bpm),
    selectedTrack: clampIndex(saved?.selectedTrack, count),
  }
}

// v1 kept one bank of 10 slots, each holding all 4 tracks. Fan it out per
// track, into section A — v1 had no sections, so B–D open empty.
function migrateV1(old) {
  const base = initialState()
  const banks = base.tracks.map((def, i) => {
    const fallback = old.tracks?.[i]?.note ?? def.note
    const slots = trimSlots(
      Array.from({ length: SLOTS }, (_, s) =>
        normalizePattern(old.slots?.[s]?.tracks?.[i], fallback),
      ),
    )
    return { slots, currentSlot: clampIndex(old.currentSlot, slots.length) }
  })
  return {
    ...base,
    bpm: clampBpm(old.bpm ?? base.bpm),
    swing: old.swing ?? base.swing,
    tracks: base.tracks.map((def, i) => {
      const cfg = old.tracks?.[i] || {}
      return {
        ...def,
        name: cfg.name ?? def.name,
        channel: cfg.channel ?? def.channel,
        note: cfg.note ?? def.note,
        mute: !!cfg.mute,
      }
    }),
    sections: base.sections.map((sec, s) => (s === 0 ? { tracks: banks } : sec)),
  }
}

/* ---------------- reducer ---------------- */

export function reducer(state, action) {
  const a = action
  switch (a.type) {
    case 'set':
      return { ...state, [a.key]: a.value }

    case 'track': // patch one track config
      return patchTrack(state, a.index, a.patch)

    // A track exists in every section, so it is added to and removed from all
    // of them at once — only its patterns are per-section.
    case 'addTrack': {
      if (state.tracks.length >= MAX_TRACKS) return state
      const index = state.tracks.length
      return {
        ...state,
        tracks: [...state.tracks, makeTrack(index)],
        sections: state.sections.map(sec => ({ tracks: [...sec.tracks, makeSlotTrack()] })),
        selectedTrack: index,
      }
    }

    case 'removeTrack': {
      if (state.tracks.length < 2) return state // never leave an empty rack
      const tracks = state.tracks.filter((_, i) => i !== a.index)
      return {
        ...state,
        tracks,
        sections: state.sections.map(sec => ({
          tracks: sec.tracks.filter((_, i) => i !== a.index),
        })),
        selectedTrack: Math.min(state.selectedTrack, tracks.length - 1),
      }
    }

    // A section always starts on slot 1 of every track, so a part sounds the
    // same however you came into it.
    case 'selectSection': {
      const index = clampIndex(a.index, state.sections.length)
      return {
        ...state,
        section: index,
        sections: state.sections.map((sec, s) =>
          s !== index ? sec : { tracks: sec.tracks.map(t => ({ ...t, currentSlot: 0 })) },
        ),
      }
    }

    // Hand a whole part on to the next one — every track's slots, deep-copied,
    // so the copy is edited into a variation without touching the original.
    case 'copySection': {
      const to = a.from + 1
      if (!state.sections[a.from] || !state.sections[to]) return state
      const src = state.sections[a.from].tracks
      return {
        ...state,
        sections: state.sections.map((sec, s) =>
          s !== to
            ? sec
            : {
                tracks: sec.tracks.map((t, i) =>
                  src[i]
                    ? { currentSlot: src[i].currentSlot, slots: src[i].slots.map(clonePattern) }
                    : t,
                ),
              },
        ),
      }
    }

    case 'selectSlot':
      return patchSlots(state, a.track, { currentSlot: a.slot })

    // Back to slot 1 on every track of the section that is up — what pressing
    // play does, so a run always begins from the same place.
    case 'rewindSlots':
      return mapSection(state, tracks => tracks.map(t => ({ ...t, currentSlot: 0 })))

    // Song mode moved on: point every track at the slot now sounding, so what
    // you edit and record into is what you hear.
    case 'syncSlots':
      return mapSection(state, tracks =>
        tracks.map((t, i) => {
          const slot = a.slots[i]
          if (slot == null || slot === t.currentSlot) return t
          return { ...t, currentSlot: clampIndex(slot, t.slots.length) }
        }),
      )

    // A new slot starts as a copy of the last one, so a song is built by
    // duplicating a pattern and varying it rather than starting from silence.
    case 'addSlot': {
      const t = sectionTracks(state)[a.track]
      if (t.slots.length >= SLOTS) return state
      const last = t.slots[t.slots.length - 1]
      return patchSlots(state, a.track, {
        slots: [...t.slots, clonePattern(last)],
        currentSlot: t.slots.length,
      })
    }

    case 'removeSlot': {
      const t = sectionTracks(state)[a.track]
      if (t.slots.length < 2) return state // a track always keeps one slot
      const slots = t.slots.filter((_, i) => i !== a.slot)
      return patchSlots(state, a.track, {
        slots,
        currentSlot: Math.min(t.currentSlot, slots.length - 1),
      })
    }

    case 'step': // patch one step of this track's current slot
      return patchStep(state, a.track, a.step, () => a.patch)

    case 'clearStep': // back to a rest
      return patchStep(state, a.track, a.step, () => ({ notes: [] }))

    // `replace` wipes what the step held first; without it the note piles on.
    case 'writeStep':
      return patchStep(state, a.track, a.step, s => ({
        notes: tidyNotes([...(a.replace ? [] : s.notes), mkNote(a.note, fitLen(a.len, a.step))]),
        velocity: a.velocity ?? s.velocity,
      }))

    case 'removeNote': // dropping the last note leaves a rest
      return patchStep(state, a.track, a.step, s => ({
        notes: s.notes.filter(n => n.note !== a.note),
      }))

    // How many steps a note is held for — 1 is a plain step-long note. It is cut
    // at the end of the pattern rather than wrapping onto step 1.
    case 'setNoteLen':
      return patchStep(state, a.track, a.step, s => ({
        notes: s.notes.map(n => (n.note === a.note ? mkNote(n.note, fitLen(a.len, a.step)) : n)),
      }))

    case 'clearTrack': // clear this track's current slot
      return mapPattern(state, a.track, s => ({ ...s, notes: [] }))

    // Wipe the whole song: every section, every slot, back to one empty slot
    // per track. Track config, tempo and swing are kept.
    case 'clearAll':
      return {
        ...state,
        sections: state.sections.map(() => makeSection(state.tracks.length)),
        selectedStep: 0,
        cursor: 0,
      }

    case 'load':
      return a.state

    default:
      return state
  }
}

const clampIndex = (i, length) => Math.min(length - 1, Math.max(0, i ?? 0))

function patchTrack(state, index, patch) {
  return {
    ...state,
    tracks: state.tracks.map((t, i) => (i === index ? { ...t, ...patch } : t)),
  }
}

// Slot edits only ever touch the section that is up.
function mapSection(state, fn) {
  return {
    ...state,
    sections: state.sections.map((sec, s) =>
      s === state.section ? { tracks: fn(sec.tracks) } : sec,
    ),
  }
}

function patchSlots(state, index, patch) {
  return mapSection(state, tracks => tracks.map((t, i) => (i === index ? { ...t, ...patch } : t)))
}

function mapPattern(state, track, fn) {
  const t = sectionTracks(state)[track]
  return patchSlots(state, track, {
    slots: t.slots.map((p, i) => (i !== t.currentSlot ? p : { steps: p.steps.map(fn) })),
  })
}

// `fn(step)` returns a patch, so callers can derive it from the current step.
function patchStep(state, track, step, fn) {
  return mapPattern(state, track, (s, i) => (i === step ? { ...s, ...fn(s) } : s))
}

export { TRACKS, SLOTS, STEPS }

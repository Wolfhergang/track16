// Sequencer engine: clock, scheduling, Web MIDI I/O, WebAudio preview synth.
// Kept outside React on purpose — the scheduler must not depend on render timing.

export const STEPS = 16
export const TRACKS = 4
export const SLOTS = 10 // ceiling: a track holds 1..SLOTS memory slots

const LOOKAHEAD_MS = 100 // how far ahead events are scheduled
const TICK_MS = 25 // how often the scheduler wakes up
const PPQN = 24 // MIDI clock pulses per quarter note
const TIMELINE_MAX = 64 // scheduled steps remembered for the playhead

const NOTE_ON = 0x90
const NOTE_OFF = 0x80
const CLOCK = 0xf8
const START = 0xfa
const STOP = 0xfc
const CC = 0xb0

class Engine {
  constructor() {
    // [{ slots: [[{steps}, ...] per track], currents: [slot per track] }] — the
    // whole song. The engine picks the pattern to play out of here itself, so a
    // section switch lands on the next pass without waiting for a re-render.
    this.sections = null
    this.section = 0 // section sounding right now
    this.pending = null // section queued mid-pass, applied at the next pass
    this.song = false // song mode: advance one slot per pass, per track
    this.songSlot = [] // slot each track is playing right now
    this.barStarted = false
    this.tracks = null // [{ channel, mute, ... }]
    this.bpm = 120
    this.swing = 0

    this.playing = false
    this.step = 0
    this.nextStepTime = 0
    this.timer = null
    // [{ step, time }] for the steps scheduled so far, oldest first. Steps are
    // scheduled ahead of when they sound, so this is what lets the UI ask which
    // step is being heard *right now* instead of being pushed one timer per step.
    this.timeline = []

    this.access = null
    this.out = null
    this.in = null

    this.ctx = null
    this.preview = true
    this.clockOut = false

    this.active = new Set() // "ch:note" currently sounding
    this.onSong = null // (slotPerTrack) => void, fired when song mode advances
    this.onSection = null // (index, timeMs) => void, fired when a queued section starts
    this.onMidiIn = null // ({ note, velocity, channel }) => void
    this.onPorts = null // ({ inputs, outputs }) => void
    this.onError = null // (message) => void
  }

  /* ---------------- state feed ---------------- */

  // React pushes the current pattern/config here on every change so that edits
  // made while the sequence runs take effect on the very next step.
  setState({ sections, section, tracks, bpm, swing, song }) {
    if (sections) this.sections = sections
    // While stopped, the engine follows what the user selects; while playing,
    // its own position stays authoritative — see queueSection.
    if (section != null && !this.playing) this.section = section
    if (sections && !this.playing) this.songSlot = this.currents().slice()
    if (tracks) this.tracks = tracks
    if (bpm) this.bpm = bpm
    if (swing != null) this.swing = swing
    if (song != null) this.song = song
  }

  get bank() {
    return this.sections?.[this.section] || null
  }

  currents() {
    return this.bank?.currents || []
  }

  // The pattern a track is actually playing this pass.
  patternFor(ti) {
    const bank = this.bank?.slots?.[ti]
    if (!bank?.length) return null
    const slot = this.song ? (this.songSlot[ti] ?? 0) : (this.currents()[ti] ?? 0)
    return bank[slot % bank.length]
  }

  /* ---------------- sections ---------------- */

  // Tapping a section while stopped switches at once; while playing it is
  // queued, so the pass you are hearing finishes before the new part starts.
  // Returns true when it took effect immediately.
  queueSection(index) {
    if (!this.sections?.[index]) return false
    if (!this.playing) {
      this.enterSection(index)
      return true
    }
    this.pending = index === this.section ? null : index
    return false
  }

  // A section always opens on slot 1 of every track. React resets the same
  // pointers, but the first steps of the new pass are scheduled before that
  // re-render lands — so the engine's own copy is zeroed here too.
  enterSection(index) {
    this.section = index
    this.pending = null
    const bank = this.sections?.[index]
    if (bank) bank.currents = (bank.slots || []).map(() => 0)
    this.songSlot = this.currents().slice()
  }

  applySection(index, time) {
    this.enterSection(index)
    this.onSection?.(index, time)
    // the slot pointers moved with the section — tell the UI, or its "playing"
    // marker keeps pointing at the slot the previous section was on
    this.onSong?.(this.songSlot.slice(), time)
  }

  // Rewind every track in the section that is up to its first slot. Called just
  // before the clock starts, never while it runs — song mode owns the slot
  // pointers from then on.
  rewindSlots() {
    const bank = this.bank
    if (bank) bank.currents = (bank.slots || []).map(() => 0)
    this.songSlot = this.currents().slice()
  }

  // `time` is when the new pass is heard — steps are scheduled ahead of it, so
  // the UI is told to follow at that moment, not at scheduling time.
  advanceSong(time) {
    this.songSlot = (this.bank?.slots || []).map((bank, ti) => {
      const len = bank?.length || 1
      return ((this.songSlot[ti] ?? 0) + 1) % len
    })
    this.onSong?.(this.songSlot.slice(), time)
  }

  get stepDur() {
    return 60000 / this.bpm / 4
  }

  swingOffset(step) {
    return step % 2 === 1 ? this.stepDur * (this.swing / 100) : 0
  }

  /* ---------------- MIDI ---------------- */

  async initMidi() {
    if (!navigator.requestMIDIAccess) {
      this.onError?.('Web MIDI not supported by this browser. Audio preview only.')
      return null
    }
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false })
      this.access.onstatechange = () => this.publishPorts()
      this.publishPorts()
      return this.access
    } catch (e) {
      this.onError?.('MIDI access denied: ' + e.message)
      return null
    }
  }

  publishPorts() {
    if (!this.access) return
    const inputs = [...this.access.inputs.values()].map(p => ({ id: p.id, name: p.name }))
    const outputs = [...this.access.outputs.values()].map(p => ({ id: p.id, name: p.name }))
    // Drop selections whose device disappeared.
    if (this.out && !outputs.some(o => o.id === this.out.id)) this.out = null
    if (this.in && !inputs.some(i => i.id === this.in.id)) this.setInput(null)
    this.onPorts?.({ inputs, outputs })
  }

  setOutput(id) {
    this.allNotesOff()
    this.out = id && this.access ? this.access.outputs.get(id) || null : null
  }

  setInput(id) {
    if (this.in) this.in.onmidimessage = null
    this.in = id && this.access ? this.access.inputs.get(id) || null : null
    if (this.in) this.in.onmidimessage = e => this.handleMidiIn(e)
  }

  // Note-offs are forwarded too: live record measures how long a key is held.
  handleMidiIn(e) {
    const [status, d1, d2] = e.data
    const type = status & 0xf0
    const channel = (status & 0x0f) + 1
    if (type === NOTE_ON && d2 > 0) {
      this.onMidiIn?.({ note: d1, velocity: d2, channel, on: true })
    } else if (type === NOTE_OFF || (type === NOTE_ON && d2 === 0)) {
      this.onMidiIn?.({ note: d1, velocity: 0, channel, on: false })
    }
  }

  send(bytes, time) {
    if (this.out) {
      try {
        this.out.send(bytes, time)
      } catch {
        /* port went away mid-send */
      }
    }
  }

  /* ---------------- audio preview ---------------- */

  ensureAudio() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext
      if (AC) this.ctx = new AC()
    }
    if (this.ctx?.state === 'suspended') this.ctx.resume()
    return this.ctx
  }

  // Converts a performance.now() timestamp into AudioContext time.
  audioTime(timeMs) {
    return this.ctx.currentTime + Math.max(0, timeMs - performance.now()) / 1000
  }

  beep(note, velocity, timeMs, durMs, trackIndex = 0) {
    if (!this.preview) return
    const ctx = this.ensureAudio()
    if (!ctx) return
    const t = this.audioTime(timeMs)
    const dur = Math.max(0.03, durMs / 1000)
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = ['triangle', 'square', 'sawtooth', 'sine'][trackIndex % 4]
    osc.frequency.value = 440 * Math.pow(2, (note - 69) / 12)
    const peak = (velocity / 127) * 0.18
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.005)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    osc.connect(gain).connect(ctx.destination)
    osc.start(t)
    osc.stop(t + dur + 0.02)
  }

  /* ---------------- transport ---------------- */

  start() {
    if (this.playing) return
    this.ensureAudio()
    this.playing = true
    this.step = 0
    this.songSlot = this.currents().slice() // a song always starts where you are
    this.pending = null
    this.barStarted = false
    this.timeline = []
    this.onSong?.(this.songSlot.slice(), performance.now())
    this.nextStepTime = performance.now() + 60
    if (this.clockOut) this.send([START], this.nextStepTime)
    this.tick()
    this.timer = setInterval(() => this.tick(), TICK_MS)
  }

  stop() {
    if (!this.playing) return
    this.playing = false
    this.pending = null // a queued section never survives a stop
    clearInterval(this.timer)
    this.timer = null
    this.timeline = []
    if (this.clockOut) this.send([STOP])
    this.allNotesOff()
  }

  toggle() {
    this.playing ? this.stop() : this.start()
  }

  allNotesOff() {
    for (const key of this.active) {
      const [ch, note] = key.split(':').map(Number)
      this.send([NOTE_OFF | ch, note, 0])
    }
    this.active.clear()
    for (let ch = 0; ch < 16; ch++) this.send([CC | ch, 123, 0]) // all notes off
  }

  // The step sounding at `now`, swing included — the UI polls this once per
  // animation frame rather than being handed one timer per step, so the
  // indicator lands with the note and self-corrects after a stall.
  playheadAt(now = performance.now()) {
    if (!this.playing) return -1
    let current = -1
    let stale = 0
    for (const e of this.timeline) {
      if (e.time > now) break
      current = e.step
      stale++
    }
    // keep one played entry as the floor, drop the rest
    if (stale > 1) this.timeline.splice(0, stale - 1)
    return current
  }

  // Nearest step to "now" — used to quantize live recording.
  liveStep() {
    if (!this.playing) return null
    const elapsed = performance.now() - (this.nextStepTime - this.stepDur)
    const drift = Math.round(elapsed / this.stepDur)
    return (((this.step - 1 + drift) % STEPS) + STEPS) % STEPS
  }

  /* ---------------- scheduler ---------------- */

  tick() {
    const now = performance.now()
    while (this.nextStepTime < now + LOOKAHEAD_MS) {
      // Song mode moves every track to its next slot at the top of each pass,
      // before that pass is scheduled — tracks with different slot counts drift
      // against each other on purpose.
      // A queued section takes over at the top of a pass, before that pass is
      // scheduled — and it starts on its own slots rather than advancing them.
      if (this.step === 0) {
        if (this.pending != null) this.applySection(this.pending, this.nextStepTime)
        else if (this.barStarted && this.song) this.advanceSong(this.nextStepTime)
        this.barStarted = true
      }
      this.scheduleStep(this.step, this.nextStepTime)
      // logged at the time it is actually heard, swing and all. The UI prunes
      // as it reads, but nothing reads while the tab is hidden — hence the cap.
      this.timeline.push({ step: this.step, time: this.nextStepTime + this.swingOffset(this.step) })
      if (this.timeline.length > TIMELINE_MAX) {
        this.timeline.splice(0, this.timeline.length - TIMELINE_MAX)
      }
      this.nextStepTime += this.stepDur
      this.step = (this.step + 1) % STEPS
    }
  }

  scheduleStep(step, baseTime) {
    if (this.clockOut) {
      const per = this.stepDur / (PPQN / 4)
      for (let i = 0; i < PPQN / 4; i++) this.send([CLOCK], baseTime + i * per)
    }
    if (!this.sections || !this.tracks) return

    const time = baseTime + this.swingOffset(step)
    this.tracks.forEach((cfg, ti) => {
      if (!cfg || cfg.mute) return
      const pat = this.patternFor(ti)
      if (!pat) return
      const st = pat.steps[step]
      if (!st || !st.notes.length) return // empty step = rest
      // A step is a chord: every note in it fires together. A note held for
      // `len` steps sounds as one uninterrupted note — gate shapes its tail.
      // Nothing rings past the last step: the loop starts clean on step 1.
      const toEnd = (STEPS - step) * this.stepDur
      for (const n of st.notes) {
        const dur = Math.min(this.stepDur * (n.len - 1 + st.gate / 100), toEnd)
        this.playNote(cfg.channel - 1, n.note, st.velocity, time, dur, ti)
      }
    })
  }

  playNote(ch, note, velocity, time, durMs, trackIndex = 0) {
    const key = `${ch}:${note}`
    if (this.active.has(key)) this.send([NOTE_OFF | ch, note, 0], time - 1)
    this.active.add(key)
    this.send([NOTE_ON | ch, note, velocity], time)
    const off = time + Math.max(10, durMs)
    this.send([NOTE_OFF | ch, note, 0], off)
    setTimeout(() => this.active.delete(key), Math.max(0, off - performance.now()) + 20)
    this.beep(note, velocity, time, Math.max(10, durMs), trackIndex)
  }

  // Immediate audition of a note (keyboard taps, step preview).
  audition(ch, note, velocity = 100, durMs = 180, trackIndex = 0) {
    this.playNote(ch, note, velocity, performance.now() + 1, durMs, trackIndex)
  }

  auditionChord(ch, notes, velocity = 100, durMs = 180, trackIndex = 0) {
    const time = performance.now() + 1
    for (const note of notes) this.playNote(ch, note, velocity, time, durMs, trackIndex)
  }
}

export const engine = new Engine()

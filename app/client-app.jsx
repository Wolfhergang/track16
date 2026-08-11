'use client'

import dynamic from 'next/dynamic'
import ServiceWorker from './service-worker.jsx'

// The whole app is browser-only: patterns come out of localStorage on the first
// render, and the engine talks to Web MIDI and WebAudio. Rendering it on the
// server would produce empty markup that mismatches on hydration, so skip SSR
// (and prerendering) for it entirely.
const App = dynamic(() => import('../src/App.jsx'), { ssr: false })

export default function ClientApp() {
  return (
    <>
      <App />
      <ServiceWorker />
    </>
  )
}

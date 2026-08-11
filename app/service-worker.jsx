'use client'

import { useEffect } from 'react'

// Registers /sw.js and handles the update handshake. Renders nothing.
export default function ServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    let reg
    let reloading = false

    const onControllerChange = () => {
      if (reloading) return
      reloading = true
      window.location.reload()
    }

    ;(async () => {
      try {
        reg = await navigator.serviceWorker.register('/sw.js')
      } catch {
        return // insecure origin or no SW support — the app still runs, just online
      }

      // Patterns live in localStorage; ask the browser not to evict them.
      navigator.storage?.persist?.().catch(() => {})

      // The page itself is served from cache without touching the network, so
      // check for a new worker explicitly. It is async and fails silently offline.
      reg.update().catch(() => {})

      // A new build installs in the background and waits. Applying it swaps the
      // JS out from under a running session, so ask before reloading.
      const offerUpdate = worker => {
        if (!worker || !navigator.serviceWorker.controller) return
        worker.addEventListener('statechange', () => {
          if (worker.state !== 'installed') return
          if (window.confirm('A new version of STEP16 is ready. Reload now?')) {
            worker.postMessage('skip-waiting')
          }
        })
      }
      reg.addEventListener('updatefound', () => offerUpdate(reg.installing))

      navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)
    })()

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
    }
  }, [])

  return null
}

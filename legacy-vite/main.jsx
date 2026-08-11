import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    let reg
    try {
      reg = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`)
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

    let reloading = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return
      reloading = true
      window.location.reload()
    })
  })
}

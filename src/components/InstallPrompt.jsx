import { useEffect, useState } from 'react'

const DISMISS_KEY = 'step16.installDismissed'

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true

const isIos = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (isStandalone() || localStorage.getItem(DISMISS_KEY)) return

    const onPrompt = e => {
      e.preventDefault() // keep the event so we can show our own UI
      setDeferred(e)
      setOpen(true)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', () => setOpen(false))

    // iOS never fires beforeinstallprompt — show the manual instructions instead.
    const t = setTimeout(() => {
      if (isIos()) setOpen(true)
    }, 1200)

    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      clearTimeout(t)
    }
  }, [])

  if (!open) return null

  const install = async () => {
    if (!deferred) return
    deferred.prompt()
    const { outcome } = await deferred.userChoice
    if (outcome !== 'accepted') localStorage.setItem(DISMISS_KEY, '1')
    setDeferred(null)
    setOpen(false)
  }

  const later = () => {
    localStorage.setItem(DISMISS_KEY, '1')
    setOpen(false)
  }

  return (
    <div className="install" role="dialog" aria-label="Install app">
      <div className="install-card">
        <strong>Install STEP16</strong>
        {deferred ? (
          <p>Add it to your home screen — fullscreen, offline, no browser bars.</p>
        ) : (
          <p>
            Tap <b>Share</b> <span aria-hidden>􀈂</span> in Safari, then{' '}
            <b>Add to Home Screen</b> for fullscreen, offline use.
          </p>
        )}
        <div className="install-btns">
          <button className="tbtn" onClick={later}>
            {deferred ? 'Later' : 'Got it'}
          </button>
          {deferred && (
            <button className="tbtn primary" onClick={install}>
              Install
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

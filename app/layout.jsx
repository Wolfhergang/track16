import '../src/styles.css'

export const metadata = {
  title: 'STEP16 — MIDI Sequencer',
  description: '4-track, 16-step MIDI sequencer with 10 memory slots.',
  applicationName: 'STEP16',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/icons/icon-192.png',
    apple: '/icons/icon-192.png',
  },
  appleWebApp: {
    capable: true,
    title: 'STEP16',
    statusBarStyle: 'black-translucent',
  },
  other: {
    // Chrome's non-prefixed spelling; Next only emits the `apple-` one.
    'mobile-web-app-capable': 'yes',
  },
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#0e0f13',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      {/* styles.css sizes #root — keep the id the CSS expects. */}
      <body>
        <div id="root">{children}</div>
      </body>
    </html>
  )
}

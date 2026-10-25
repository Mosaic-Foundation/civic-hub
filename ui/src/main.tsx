import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Every stylesheet, first and in a fixed order (styles/hubStyles.ts).
import './styles/hubStyles'
import App from './App.tsx'
import { loadHubConfig, applyHubHead, getHubDeadEnd, getHubMovedTo } from './config/hubConfig'
import { DEAD_ENDS, DEAD_END_STYLE } from '../../src/shared/deadEnd'
import { installErrorReporter } from './services/errorReporter'

// Uncaught errors go to the hub's /api/client-errors (operations shell).
installErrorReporter('hub')

// Which hub is this? Decided by the hostname, so it has to be fetched before
// anything renders: a first paint with the wrong hub's name and banner, then
// a correction, is worse than waiting one round trip. loadHubConfig never
// rejects — if the hub cannot be reached we render on the build-time
// VITE_HUB_* fallbacks rather than showing nothing.
await loadHubConfig()

// An address with no hub, or a paused hub: the same plain page the server
// sends (src/middleware/hub.ts). On Vercel this shell is a static file served
// without the server, so the answer arrives here, from /hub-config, instead.
// No app, no hub name, no build-time fallback identity.
// A hub that moved to a new address (review R47): the same page there, path,
// query and fragment kept. replace(), so Back does not return to the old one.
const movedTo = getHubMovedTo()
if (movedTo) {
  window.location.replace(`${movedTo}${window.location.pathname}${window.location.search}${window.location.hash}`)
  await new Promise(() => {})
}

const deadEnd = getHubDeadEnd()
if (deadEnd) {
  const { title, body } = DEAD_ENDS[deadEnd]
  document.title = title
  const robots = document.createElement('meta')
  robots.name = 'robots'
  robots.content = 'noindex'
  document.head.appendChild(robots)
  // On a wrapper, not <body>: the app's reset pins body margins with !important.
  const page = document.createElement('main')
  page.setAttribute('style', DEAD_END_STYLE)
  const h1 = document.createElement('h1')
  h1.setAttribute('style', 'font-size:1.35rem;margin:0 0 .5rem')
  h1.textContent = title
  const p = document.createElement('p')
  p.setAttribute('style', 'margin:0;color:#555')
  p.textContent = body
  page.append(h1, p)
  document.body.replaceChildren(page)
} else {
  applyHubHead()

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

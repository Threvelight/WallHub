import { Component, StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import { AuthProvider } from './lib/auth'
import App from './App'
import './styles.css'

registerSW({ immediate: true })

declare global {
  interface Window {
    __wallhubFatal?: (detail?: string) => void
  }
}

/** Shows the startup safety screen (from index.html) if rendering crashes. */
class CrashScreen extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown) {
    const detail = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error)
    setTimeout(() => window.__wallhubFatal?.(detail))
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CrashScreen>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </CrashScreen>
  </StrictMode>,
)

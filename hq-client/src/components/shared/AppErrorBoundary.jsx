import { Component } from 'react'
import ServerErrorPage from '../../pages/shared/ServerErrorPage'

/**
 * AppErrorBoundary — catches JS errors thrown during render anywhere below
 * it in the tree and shows ServerErrorPage instead of an unstyled blank
 * white screen (React's default when nothing catches the error). Must be a
 * class component — componentDidCatch has no hook equivalent.
 *
 * Wraps <AppRoutes/> in App.jsx, outside the router's individual routes, so
 * one page crashing doesn't require reloading the whole tab to recover —
 * "Reload Page" on the fallback does that for the user instead.
 */
export default class AppErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('[AppErrorBoundary] Uncaught render error:', error, info?.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return <ServerErrorPage onRetry={() => window.location.reload()} />
    }
    return this.props.children
  }
}

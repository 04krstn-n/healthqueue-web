import ErrorState from '../../components/shared/ErrorState'

// 500 — shown by <AppErrorBoundary> when a component throws during render
// (an actual frontend crash), and can also be rendered directly by any page
// that gets back an HTTP 500 / 502 / 503 from hq-server, for consistency.
// No useAuth() here on purpose — an error boundary can be triggered by a
// crash inside AuthContext itself, so this page must not depend on it.
export default function ServerErrorPage({ onRetry }) {
  return (
    <ErrorState
      code={500}
      title="Something went wrong"
      message="An unexpected error occurred on our end. This has been logged — please try again, and contact support if the problem continues."
      primaryAction={{ label: 'Reload Page', onClick: onRetry || (() => window.location.reload()) }}
    />
  )
}

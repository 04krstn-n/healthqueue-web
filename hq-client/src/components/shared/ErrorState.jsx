import { useNavigate } from 'react-router-dom'

/**
 * ErrorState — shared full-page error UI for HTTP-style failures (404, 403,
 * 500, offline/network) plus unexpected render crashes caught by
 * <AppErrorBoundary>. Reuses the app's existing design tokens (--primary,
 * --error, --border, .btn, .card) instead of introducing new styling, so it
 * matches every other screen in hq-client.
 *
 * Not meant to be used directly in routes — see NotFoundPage.jsx,
 * ForbiddenPage.jsx, ServerErrorPage.jsx for the pre-configured wrappers
 * that actually get wired into App.jsx.
 */
export default function ErrorState({
  code,
  title,
  message,
  primaryAction,   // { label, to } | { label, onClick }
  showBack = true,
}) {
  const navigate = useNavigate()

  return (
    <div
      style={{
        minHeight: '70vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '40px 20px',
      }}
    >
      <div
        style={{
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: 1,
          color: 'var(--error-dk, #991B1B)',
          background: 'var(--error-lt, #FEE2E2)',
          padding: '4px 14px',
          borderRadius: 99,
          marginBottom: 20,
        }}
      >
        ERROR {code}
      </div>

      <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text)', margin: '0 0 10px' }}>
        {title}
      </h1>

      <p style={{ fontSize: 14, color: 'var(--muted)', maxWidth: 420, lineHeight: 1.6, margin: '0 0 28px' }}>
        {message}
      </p>

      <div style={{ display: 'flex', gap: 10 }}>
        {showBack && (
          <button className="btn btn-outline" onClick={() => navigate(-1)}>
            Go Back
          </button>
        )}
        {primaryAction && (
          primaryAction.to ? (
            <button className="btn btn-primary" onClick={() => navigate(primaryAction.to)}>
              {primaryAction.label}
            </button>
          ) : (
            <button className="btn btn-primary" onClick={primaryAction.onClick}>
              {primaryAction.label}
            </button>
          )
        )}
      </div>
    </div>
  )
}

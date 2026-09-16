import { useAuth } from '../../context/AuthContext'
import ErrorState from '../../components/shared/ErrorState'

const homePathFor = (role) =>
  role === 'super_admin' ? '/super/dashboard' :
  role === 'facility_admin' ? '/facility/dashboard' : '/'

// 404 — shown for any unmatched route (see App.jsx catch-all route),
// replacing the previous silent <Navigate to="/" replace /> which hid
// broken/mistyped/old links instead of telling the user what happened.
export default function NotFoundPage() {
  const { user } = useAuth()

  return (
    <ErrorState
      code={404}
      title="Page not found"
      message="The page you're looking for doesn't exist, may have been moved, or the link may be outdated."
      primaryAction={{ label: 'Go to Dashboard', to: homePathFor(user?.role) }}
    />
  )
}

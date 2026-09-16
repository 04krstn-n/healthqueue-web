import { useAuth } from '../../context/AuthContext'
import ErrorState from '../../components/shared/ErrorState'

const homePathFor = (role) =>
  role === 'super_admin' ? '/super/dashboard' :
  role === 'facility_admin' ? '/facility/dashboard' : '/'

// 403 — shown when a logged-in user's role doesn't match the route they
// hit (see ProtectedRoute in App.jsx). Previously this case was
// indistinguishable from "not logged in at all" — both silently redirected
// to /login, which is misleading for a facility_admin who mistyped /super/*
// while already authenticated. Never shown to a truly unauthenticated
// visitor; that case still goes to /login as before.
export default function ForbiddenPage() {
  const { user } = useAuth()

  return (
    <ErrorState
      code={403}
      title="Access denied"
      message="Your account doesn't have permission to view this page. If you think this is a mistake, contact your system administrator."
      primaryAction={{ label: 'Go to Dashboard', to: homePathFor(user?.role) }}
      showBack={false}
    />
  )
}

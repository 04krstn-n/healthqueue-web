import { createContext, useContext, useState, useEffect } from 'react'
import { authApi } from '../services/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null)
  const [loading, setLoading] = useState(true)

  // Restore session on mount — verify token is still valid
  useEffect(() => {
    const token  = localStorage.getItem('hq_token')
    const cached = localStorage.getItem('hq_user')

    if (!token) {
      setLoading(false)
      return
    }

    // Optimistically restore from cache so ProtectedRoute doesn't flash
    if (cached) {
      try { setUser(JSON.parse(cached)) } catch (_) {}
    }

    authApi.me()
      .then((res) => {
        setUser(res.data.user)
        localStorage.setItem('hq_user', JSON.stringify(res.data.user))
      })
      .catch((err) => {
        // Only clear session on explicit 401 (invalid/expired token)
        // Network errors or 5xx should NOT log the user out
        const status = err?.response?.status
        if (status === 401) {
          localStorage.removeItem('hq_token')
          localStorage.removeItem('hq_user')
          setUser(null)
        }
        // Otherwise keep the cached user — server may be temporarily unavailable
      })
      .finally(() => setLoading(false))
  }, [])

  // login() — call API, store token, set user
  const login = async (email, password) => {
    const res = await authApi.login(email, password)
    const { token, user: u } = res.data

    if (!['super_admin', 'facility_admin'].includes(u.role)) {
      throw new Error('Access denied. This portal is for System Administrator or Facility Admin only.')
    }

    localStorage.setItem('hq_token', token)
    localStorage.setItem('hq_user', JSON.stringify(u))
    setUser(u)
    setLoading(false)   // ensure loading is false so ProtectedRoute lets us through
    return u
  }

  const logout = () => {
    localStorage.removeItem('hq_token')
    localStorage.removeItem('hq_user')
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)

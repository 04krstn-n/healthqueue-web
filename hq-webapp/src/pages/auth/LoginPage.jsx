import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import styles from './LoginPage.module.css'
import Logo from '../../assets/img/hq_logo.png'

const EyeOn  = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
const EyeOff = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>

export default function LoginPage() {
  // The 'tab' state has been completely removed.
  const [email,    setEmail]   = useState('')
  const [password, setPass]    = useState('')
  const [showPw,   setShowPw]  = useState(false)
  const [loading,  setLoading] = useState(false)
  const [error,    setError]   = useState('')

  const { login } = useAuth()
  const navigate  = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!email || !password) { setError('Please enter your email and password.'); return }
    setLoading(true)
    
    try {
      // Pass the credentials. The backend auth system handles determining the role.
      const user = await login(email.trim().toLowerCase(), password)
      
      // Routing is still cleanly managed based on the backend response payload.
      if (user.role === 'super_admin') {
        navigate('/super/dashboard',    { replace: true })
      } else if (user.role === 'facility_admin') {
        navigate('/facility/dashboard', { replace: true })
      } else {
        setError('Access denied. This portal is for admins only.')
      }
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || 'Invalid email or password.'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>

        {/* Logo */}
        <div className={styles.logoWrap}>
          <div className={styles.logoIcon}>
              <img src={Logo} alt="HealthQueue+ Logo" className={styles.logoImg} />
          </div>
          <div className={styles.appName}>HealthQueue+</div>
        </div>

        {/* Error banner */}
        {error && (
          <div className={styles.error}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className={styles.form}>
          
          {/* Unified Email Input */}
          <div className={styles.formGroup}>
            <label className={styles.label}>Email Address</label>
            <div className={styles.inputWrap}>
              <svg className={styles.inputIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                <polyline points="22,6 12,13 2,6"/>
              </svg>
              <input
                type="email"
                className={styles.input}
                placeholder="admin@healthqueue.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoComplete="email"
              />
            </div>
          </div>

          {/* Password Input */}
          <div className={styles.formGroup}>
            <label className={styles.label}>Password</label>
            <div className={styles.inputWrap}>
              <svg className={styles.inputIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              <input
                type={showPw ? 'text' : 'password'}
                className={styles.input}
                placeholder="••••••••"
                value={password}
                onChange={e => setPass(e.target.value)}
                autoComplete="current-password"
                style={{ paddingRight: 44, appearance: 'none' }}
              />
              <button type="button" className={styles.eyeBtn} onClick={() => setShowPw(v => !v)}>
                {showPw ? <EyeOff /> : <EyeOn />}
              </button>
            </div>
          </div>
          
          {/* Remember Me & Forgot Password Row */}
          <div className={styles.row}>
            <label className={styles.checkLabel}>
              <input type="checkbox" />
              <span>Remember me</span>
            </label>
            <button type="button" className={styles.forgot}>
              Forgot password?
            </button>
          </div>

          {/* Login Button */}
          <button type="submit" className={styles.submitBtn} disabled={loading || !email || !password}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        {/* Demo Callout Box */}
        <div className={styles.demoBox} style={{ marginTop: '24px' }}>
          <p className={styles.demoTitle}>Admin Access</p>
          <p className={styles.demoDesc}>
            Enter your credentials. The system will automatically route you to the correct dashboard based on your assigned permissions.
          </p>
        </div>

        <div className={styles.footer}>© 2026 HealthQueue+. All rights reserved.</div>
      </div>
    </div>
  )
}
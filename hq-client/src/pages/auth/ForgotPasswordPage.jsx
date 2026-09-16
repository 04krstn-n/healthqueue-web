import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authApi } from '../../services/api'
import styles from './LoginPage.module.css'

// Three steps, matching authController's three endpoints exactly:
//   1. forgotPassword(phone)              -> { resetId, devOtp? }
//   2. verifyResetOtp(resetId, otp)        -> { resetId, resetToken }
//   3. resetPassword(resetId, resetToken, newPassword)
// This works for ANY role (super_admin/facility_admin/staff/patient) —
// the backend never restricts forgotPassword by role, it just looks the
// account up by phone. userController.createUser now requires phone on
// every admin/staff account specifically so this path is always available
// to them, not just to patients.
export default function ForgotPasswordPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState('phone') // 'phone' | 'otp' | 'password' | 'done'

  const [phone, setPhone] = useState('')
  const [otp,   setOtp]   = useState('')
  const [newPassword,     setNewPassword]     = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const [resetId,    setResetId]    = useState(null)
  const [resetToken, setResetToken] = useState(null)
  const [devOtp,     setDevOtp]     = useState(null) // only set when SMS isn't configured server-side

  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(false)

  const submitPhone = async (e) => {
    e.preventDefault()
    setError('')
    if (!phone.trim()) { setError('Please enter your phone number.'); return }

    setLoading(true)
    try {
      const res = await authApi.forgotPassword(phone.trim())
      setResetId(res.data.resetId)
      setDevOtp(res.data.devOtp || null)
      setStep('otp')
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to send verification code.')
    } finally {
      setLoading(false)
    }
  }

  const submitOtp = async (e) => {
    e.preventDefault()
    setError('')
    if (!otp.trim()) { setError('Please enter the code sent to your phone.'); return }

    setLoading(true)
    try {
      const res = await authApi.verifyResetOtp(resetId, otp.trim())
      setResetToken(res.data.resetToken)
      setStep('password')
    } catch (err) {
      setError(err?.response?.data?.message || 'Invalid or expired code.')
    } finally {
      setLoading(false)
    }
  }

  const submitNewPassword = async (e) => {
    e.preventDefault()
    setError('')
    if (!newPassword || !confirmPassword) { setError('Please fill in both password fields.'); return }
    if (newPassword !== confirmPassword) { setError('Passwords do not match.'); return }

    setLoading(true)
    try {
      await authApi.resetPassword(resetId, resetToken, newPassword)
      setStep('done')
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to reset password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <div className={styles.logoWrap}>
          <div className={styles.appName}>
            {step === 'done' ? 'Password Reset' : 'Forgot Password'}
          </div>
        </div>

        {error && (
          <div className={styles.error}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            {error}
          </div>
        )}

        {step === 'phone' && (
          <form onSubmit={submitPhone} className={styles.form}>
            <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 4px' }}>
              Enter the phone number on your account. We'll text you a verification code.
            </p>
            <div className={styles.formGroup}>
              <label className={styles.label}>Phone Number</label>
              <div className={styles.inputWrap}>
                <input
                  type="tel"
                  className={styles.input}
                  placeholder="09XXXXXXXXX"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  autoComplete="tel"
                />
              </div>
            </div>
            <button type="submit" className={styles.submitBtn} disabled={loading}>
              {loading ? 'Sending…' : 'Send Code'}
            </button>
          </form>
        )}

        {step === 'otp' && (
          <form onSubmit={submitOtp} className={styles.form}>
            <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 4px' }}>
              Enter the 6-digit code sent to {phone}.
            </p>
            {devOtp && (
              <div style={{ fontSize: 12, color: '#92400E', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '8px 12px' }}>
                SMS isn't configured on this server — your code is <strong>{devOtp}</strong>.
              </div>
            )}
            <div className={styles.formGroup}>
              <label className={styles.label}>Verification Code</label>
              <div className={styles.inputWrap}>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  className={styles.input}
                  placeholder="123456"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                />
              </div>
            </div>
            <button type="submit" className={styles.submitBtn} disabled={loading}>
              {loading ? 'Verifying…' : 'Verify Code'}
            </button>
            <button
              type="button"
              className={styles.forgot}
              onClick={() => { setStep('phone'); setOtp(''); setError('') }}
            >
              Use a different phone number
            </button>
          </form>
        )}

        {step === 'password' && (
          <form onSubmit={submitNewPassword} className={styles.form}>
            <div className={styles.formGroup}>
              <label className={styles.label}>New Password</label>
              <div className={styles.inputWrap}>
                <input
                  type="password"
                  className={styles.input}
                  placeholder="••••••••"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>Confirm New Password</label>
              <div className={styles.inputWrap}>
                <input
                  type="password"
                  className={styles.input}
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', margin: '2px 0 8px', lineHeight: 1.6 }}>
              Must be 8+ characters, with an uppercase letter, a lowercase letter, a number, and a special character.
            </div>
            <button type="submit" className={styles.submitBtn} disabled={loading}>
              {loading ? 'Saving…' : 'Reset Password'}
            </button>
          </form>
        )}

        {step === 'done' && (
          <div>
            <p style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 1.6, marginBottom: 20 }}>
              Your password has been updated. You can now sign in with your new password.
            </p>
            <button type="button" className={styles.submitBtn} onClick={() => navigate('/login')}>
              Back to Sign In
            </button>
          </div>
        )}

        {step !== 'done' && (
          <div className={styles.footer}>
            <button type="button" className={styles.forgot} onClick={() => navigate('/login')}>
              Back to Sign In
            </button>
          </div>
        )}
      </div>
    </main>
  )
}

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authApi } from '../../services/api'
import styles from './LoginPage.module.css'

// Password input with a red required asterisk in the label (above the field)
// and an eye icon button that toggles between hidden and visible text.
function PasswordField({ label, value, onChange, placeholder = '••••••••', autoComplete }) {
  const [show, setShow] = useState(false)

  return (
    <div className={styles.formGroup}>
      <label className={styles.label}>
        {label} <span style={{ color: '#DC2626' }} aria-hidden="true">*</span>
      </label>
      <div className={styles.inputWrap} style={{ position: 'relative' }}>
        <input
          type={show ? 'text' : 'password'}
          className={styles.input}
          style={{ paddingRight: 40 }}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
          aria-required="true"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? 'Hide password' : 'Show password'}
          aria-pressed={show}
          style={{
            position: 'absolute',
            right: 10,
            top: '50%',
            transform: 'translateY(-50%)',
            background: 'none',
            border: 'none',
            padding: 4,
            cursor: 'pointer',
            color: 'var(--muted)',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          {show ? (
            // eye-off
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
              <line x1="1" y1="1" x2="23" y2="23"/>
            </svg>
          ) : (
            // eye
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
          )}
        </button>
      </div>
    </div>
  )
}

// Three steps, matching authController's three endpoints exactly:
//   1. forgotPassword(email)              -> { resetId }   (code is emailed)
//   2. verifyResetOtp(resetId, otp)        -> { resetId, resetToken }
//   3. resetPassword(resetId, resetToken, newPassword)
// Administrator-side recovery: super_admin / facility_admin / staff accounts
// receive the code by EMAIL. Patients reset from the mobile app by phone.
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
    if (!phone.trim()) { setError('Please enter your email address.'); return }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(phone.trim())) { setError('Please enter a valid email address.'); return }

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
    if (!otp.trim()) { setError('Please enter the code sent to your email.'); return }

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
              Enter the email address on your administrator account. We'll email you a verification code.
            </p>
            <div className={styles.formGroup}>
              <label className={styles.label}>Email Address</label>
              <div className={styles.inputWrap}>
                <input
                  type="email"
                  className={styles.input}
                  placeholder="you@example.com"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  autoComplete="email"
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
              Enter the 6-digit code sent to {phone}. It expires in 5 minutes.
            </p>
            {devOtp && (
              <div style={{ fontSize: 12, color: '#92400E', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '8px 12px' }}>
                Email isn't configured on this dev server — your code is <strong>{devOtp}</strong>.
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
              Use a different email address
            </button>
          </form>
        )}

        {step === 'password' && (
          <form onSubmit={submitNewPassword} className={styles.form}>
            <PasswordField
              label="New Password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
            <PasswordField
              label="Confirm New Password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
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
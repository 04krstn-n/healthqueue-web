import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { usersApi } from '../../services/api'
import styles from '../auth/LoginPage.module.css'

// Reuses LoginPage's CSS module rather than new styles — this is part of
// the same auth flow family (forced first-login change after
// userController.createUser hands out a temp password), so it should look
// like it belongs with the login screen, not like a separate app section.
export default function ChangePasswordPage() {
  const { clearMustChangePassword } = useAuth()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword,     setNewPassword]     = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError('Please fill in all fields.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.')
      return
    }
    if (currentPassword === newPassword) {
      setError('New password must be different from your current password.')
      return
    }

    setLoading(true)
    try {
      await usersApi.changePassword(currentPassword, newPassword)
      clearMustChangePassword()
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to change password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <div className={styles.logoWrap}>
          <div className={styles.appName}>Set a New Password</div>
        </div>

        <div
          style={{
            background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 10,
            padding: '12px 14px', fontSize: 13, color: '#1E40AF', marginBottom: 20, lineHeight: 1.5,
          }}
        >
          This account was just created for you with a temporary password. For security, you need to set your own before continuing.
        </div>

        {error && (
          <div className={styles.error}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.formGroup}>
            <label className={styles.label}>Temporary Password</label>
            <div className={styles.inputWrap}>
              <input
                type="password"
                className={styles.input}
                placeholder="The password you were given"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
          </div>

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
            {loading ? 'Updating…' : 'Set New Password'}
          </button>
        </form>
      </div>
    </main>
  )
}

import { useState } from 'react'

/**
 * Small modal to correct a typo'd email on an account whose owner has not
 * yet set their own password. Saving clears the "password sent" state so the
 * admin can click Send Password again for the corrected address.
 */
export default function EditEmailModal({ name, currentEmail, onSave, onClose }) {
  const [email, setEmail] = useState(currentEmail || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    const next = email.trim()
    if (!/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(next)) return setError('Enter a valid email address.')
    if (next.toLowerCase() === (currentEmail || '').toLowerCase()) return onClose()
    setSaving(true)
    setError('')
    try {
      await onSave(next)
    } catch (e) {
      setError(e?.response?.data?.message || 'Failed to update the email.')
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <div className="modal-header">
          <span className="modal-title">Fix email address</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div style={{ padding: '0 24px 8px' }}>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 0 }}>
            Correct the email for <strong style={{ color: 'var(--text)' }}>{name}</strong>, then click Send Password again.
          </p>
          <input
            className="form-input"
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setError('') }}
            autoFocus
          />
          {error && <div style={{ color: '#DC2626', fontSize: 12, marginTop: 6 }}>{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}

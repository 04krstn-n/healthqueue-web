import { useState } from 'react'

// Same rules the server enforces (authController.validatePasswordStrength).
export const PASSWORD_RULES = [
  { key: 'len',   label: 'At least 8 characters', test: (p) => p.length >= 8 },
  { key: 'upper', label: 'One uppercase letter',   test: (p) => /[A-Z]/.test(p) },
  { key: 'lower', label: 'One lowercase letter',   test: (p) => /[a-z]/.test(p) },
  { key: 'digit', label: 'One number',             test: (p) => /\d/.test(p) },
  { key: 'spec',  label: 'One special character',  test: (p) => /[^\w\s]/.test(p) },
]

/** Returns an error string, or '' when password + confirmation are acceptable. */
export function validateNewPassword(password, confirm) {
  if (!password) return 'Password is required'
  const missing = PASSWORD_RULES.filter((r) => !r.test(password))
  if (missing.length) return 'Password does not meet all requirements'
  if (password !== confirm) return 'Passwords do not match'
  return ''
}

/**
 * Password + confirm-password inputs with a show/hide toggle and a live
 * requirements checklist. The creating admin chooses the password — the
 * system never generates one.
 */
export default function PasswordSetter({ password, confirm, onPassword, onConfirm, error, hint }) {
  const [show, setShow] = useState(false)
  const inputStyle = { border: error ? '1px solid #DC2626' : undefined, paddingRight: 64 }

  const Toggle = (
    <button
      type="button"
      onClick={() => setShow((s) => !s)}
      style={{
        position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
        background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--muted)',
      }}
      aria-label={show ? 'Hide password' : 'Show password'}
    >
      {show ? 'Hide' : 'Show'}
    </button>
  )

  return (
    <>
      <div className="form-group">
        <label className="form-label">
          Password <span style={{ color: 'var(--error, #DC2626)' }}>*</span>
        </label>
        <div style={{ position: 'relative' }}>
          <input
            className="form-input"
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            value={password}
            style={inputStyle}
            onChange={(e) => onPassword(e.target.value)}
          />
          {Toggle}
        </div>
        {password && (
          <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, fontSize: 12, lineHeight: 1.6 }}>
            {PASSWORD_RULES.map((r) => {
              const ok = r.test(password)
              return (
                <li key={r.key} style={{ color: ok ? '#16A34A' : 'var(--muted)' }}>
                  {ok ? '✓' : '○'} {r.label}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="form-group">
        <label className="form-label">
          Confirm Password <span style={{ color: 'var(--error, #DC2626)' }}>*</span>
        </label>
        <input
          className="form-input"
          type={show ? 'text' : 'password'}
          autoComplete="new-password"
          value={confirm}
          style={{ border: error ? '1px solid #DC2626' : undefined }}
          onChange={(e) => onConfirm(e.target.value)}
        />
        {error && (
          <div style={{ color: '#DC2626', fontSize: 12, marginTop: 4, fontWeight: 500 }}>{error}</div>
        )}
        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6, lineHeight: 1.5 }}>
          {hint || "They'll be asked to change this password the first time they log in."}
        </div>
      </div>
    </>
  )
}

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { systemConfigApi } from '../../services/api'
import styles from './super-admin.module.css'

const GROUP_LABELS = {
  General: 'General Settings',
  Queue: 'Queue Settings',
  Chatbot: 'Chatbot Settings',
}

export default function SystemConfigPage() {
  const [configs, setConfigs] = useState([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState(null)
  const [toast, setToast] = useState('')
  const [edits, setEdits] = useState({}) // key -> new value

  const toastTimerRef = useRef(null)

  const showToast = useCallback((message) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToast(message)
    toastTimerRef.current = setTimeout(() => setToast(''), 3000)
  }, [])

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    }
  }, [])

  // ─── Data Loading ────────────────────────────────────────────────────────────
  const loadConfigs = useCallback(async () => {
    setLoading(true)
    try {
      const res = await systemConfigApi.list()
      const rawData = res?.data?.data ?? res?.data
      const data = Array.isArray(rawData) ? rawData : []

      setConfigs(data)

      const initialEdits = {}
      data.forEach((c) => {
        initialEdits[c.key] = c.value
      })
      setEdits(initialEdits)
    } catch (e) {
      showToast(e?.response?.data?.message || 'Failed to load system config')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => {
    loadConfigs()
  }, [loadConfigs])

  // ─── Mutation Handlers ───────────────────────────────────────────────────────
  const handleSave = async (cfg) => {
    setSavingId(cfg._id)
    try {
      await systemConfigApi.update(cfg._id, edits[cfg.key])
      showToast(`"${cfg.label || cfg.key}" updated successfully`)
      await loadConfigs()
    } catch (e) {
      showToast(e?.response?.data?.message || 'Failed to save configuration')
    } finally {
      setSavingId(null)
    }
  }

  const handleEditChange = (key, value) => {
    setEdits((prev) => ({ ...prev, [key]: value }))
  }

  // ─── Memoized Grouping ───────────────────────────────────────────────────────
  const groupedConfigs = useMemo(() => {
    const map = {}
    configs.forEach((cfg) => {
      const groupName = cfg.group || 'General'
      if (!map[groupName]) {
        map[groupName] = []
      }
      map[groupName].push(cfg)
    })
    return map
  }, [configs])

  const groupKeys = useMemo(() => Object.keys(groupedConfigs), [groupedConfigs])

  return (
    <div className={styles.page}>
      {toast && <div className={styles.toast}>{toast}</div>}

      {/* Header */}
      <div className={styles.header}>
        <div>
          <div className={styles.title}>System Configuration</div>
          <div className={styles.sub}>Manage platform-wide settings</div>
        </div>
        <button className="btn btn-outline" onClick={loadConfigs} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
          Loading config…
        </div>
      ) : groupKeys.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
          No configuration entries found.
        </div>
      ) : (
        groupKeys.map((group) => (
          <div key={group} className="card" style={{ padding: 20, marginBottom: 16 }}>
            <div
              style={{
                fontWeight: 700,
                color: 'var(--text)',
                fontSize: 14,
                marginBottom: 16,
                paddingBottom: 10,
                borderBottom: '1px solid var(--border-lt)',
              }}
            >
              {GROUP_LABELS[group] || group}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {groupedConfigs[group].map((cfg) => {
                const isSavingThis = savingId === cfg._id
                const currentValue = edits[cfg.key]
                const isModified = currentValue !== cfg.value

                return (
                  <div
                    key={cfg._id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '14px 0',
                      borderBottom: '1px solid var(--border-lt)',
                    }}
                  >
                    <div style={{ flex: 1, paddingRight: 16 }}>
                      <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: 13 }}>
                        {cfg.label || cfg.key}
                      </div>
                      {cfg.description && (
                        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                          {cfg.description}
                        </div>
                      )}
                      <div
                        style={{
                          fontSize: 11,
                          color: 'var(--muted)',
                          marginTop: 2,
                          fontFamily: 'monospace',
                        }}
                      >
                        key: {cfg.key}
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <ConfigInput
                        cfg={cfg}
                        value={currentValue}
                        onChange={(val) => handleEditChange(cfg.key, val)}
                      />
                      <button
                        className="btn btn-primary"
                        style={{
                          fontSize: 12,
                          padding: '5px 12px',
                          opacity: isModified ? 1 : 0.75,
                        }}
                        onClick={() => handleSave(cfg)}
                        disabled={isSavingThis}
                      >
                        {isSavingThis ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))
      )}
    </div>
  )
}

function ConfigInput({ cfg, value, onChange }) {
  const isBoolean = typeof cfg.value === 'boolean'
  const isNumber = typeof cfg.value === 'number'

  if (isBoolean) {
    return (
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span style={{ fontSize: 13, color: 'var(--text-2)', minWidth: 60 }}>
          {value ? 'Enabled' : 'Disabled'}
        </span>
      </label>
    )
  }

  if (isNumber) {
    return (
      <input
        className="form-input"
        type="number"
        style={{ width: 120 }}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
      />
    )
  }

  return (
    <input
      className="form-input"
      type="text"
      style={{ width: 240 }}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { systemConfigApi, chatbotAdminApi } from '../../services/api'
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

  const [aiStatus, setAiStatus] = useState(null)
  const [aiStatusLoading, setAiStatusLoading] = useState(true)

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

  // ─── AI Service Status ───────────────────────────────────────────────────────
  // GET /api/chatbot-admin/rasa-status actually pings the Rasa server (see
  // chatbotAdminController.getRasaStatus) rather than assuming it's up.
  // OpenAI's row reflects whether an API key is configured, not a live call —
  // pinging OpenAI on every poll would burn real API quota for no benefit.
  const loadAiStatus = useCallback(async () => {
    try {
      const res = await chatbotAdminApi.getRasaStatus()
      setAiStatus(res?.data ?? null)
    } catch (e) {
      setAiStatus(null)
    } finally {
      setAiStatusLoading(false)
    }
  }, [])

  useEffect(() => {
    loadAiStatus()
    const interval = setInterval(loadAiStatus, 15000) // keep the panel live without a manual refresh
    return () => clearInterval(interval)
  }, [loadAiStatus])

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

      <AiStatusPanel status={aiStatus} loading={aiStatusLoading} />

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

// ── AI Service Status ─────────────────────────────────────────────────────────
// Rows reflect the live values from GET /api/chatbot-admin/rasa-status, not
// hardcoded text — RasaAI's dot genuinely follows whether the server just
// answered a ping, and FAQ's "Active" vs "Fallback Mode" tracks whether it's
// actually the tier currently answering (activeMode === 'faq') vs merely
// available as the last resort.
const DOT_COLOR = { green: 'var(--success)', red: 'var(--error)', blue: 'var(--primary)' }

function StatusDot({ color }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: DOT_COLOR[color],
        marginRight: 8,
      }}
    />
  )
}

function buildAiStatusRows(status) {
  const layers = status?.layers || {}
  const activeMode = status?.activeMode

  const rasaOnline = !!layers.rasa?.online
  const openaiConfigured = !!layers.openai?.configured
  const faqIsActiveTier = activeMode === 'faq'

  return [
    {
      service: 'RasaAI',
      color: rasaOnline ? 'green' : 'red',
      statusLabel: rasaOnline ? 'Running' : 'Server Down',
      meaning: rasaOnline
        ? 'RasaAI server is available and being used as the primary AI service.'
        : 'RasaAI is unavailable; system automatically switches to OpenAI.',
    },
    {
      service: 'OpenAI',
      color: openaiConfigured ? 'green' : 'red',
      statusLabel: openaiConfigured ? 'Running' : 'Not Configured',
      meaning: openaiConfigured
        ? 'OpenAI is available and can be used as fallback.'
        : 'OpenAI is unavailable; system automatically switches to FAQ fallback.',
    },
    {
      service: 'FAQ System',
      color: faqIsActiveTier ? 'blue' : 'green',
      statusLabel: faqIsActiveTier ? 'Fallback Mode' : 'Active',
      meaning: faqIsActiveTier
        ? 'System is currently answering using predefined FAQs because AI services are unavailable.'
        : 'FAQ-based responses are available as the final fallback.',
    },
  ]
}

function AiStatusPanel({ status, loading }) {
  const rows = useMemo(() => buildAiStatusRows(status), [status])

  return (
    <div className="card" style={{ padding: 20, marginBottom: 16 }}>
      <div
        style={{
          fontWeight: 700,
          color: 'var(--text)',
          fontSize: 14,
          marginBottom: 4,
        }}
      >
        AI Service Status
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
        Which engine is currently answering the patient chatbot, live from the server.
      </div>

      {loading && !status ? (
        <div style={{ padding: 16, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
          Checking AI services…
        </div>
      ) : !status ? (
        <div style={{ padding: 16, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
          Could not reach the server to check AI service status.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '120px 140px 1fr',
              fontSize: 11,
              fontWeight: 700,
              color: 'var(--muted)',
              textTransform: 'uppercase',
              letterSpacing: 0.3,
              paddingBottom: 8,
              borderBottom: '1px solid var(--border-lt)',
            }}
          >
            <div>Service</div>
            <div>Status</div>
            <div>Meaning</div>
          </div>
          {rows.map((row) => (
            <div
              key={row.service}
              style={{
                display: 'grid',
                gridTemplateColumns: '120px 140px 1fr',
                alignItems: 'center',
                padding: '12px 0',
                borderBottom: '1px solid var(--border-lt)',
                fontSize: 13,
              }}
            >
              <div style={{ fontWeight: 600, color: 'var(--text)' }}>{row.service}</div>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <StatusDot color={row.color} />
                {row.statusLabel}
              </div>
              <div style={{ color: 'var(--muted)' }}>{row.meaning}</div>
            </div>
          ))}
        </div>
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
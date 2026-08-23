import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { io } from 'socket.io-client'
import { clinicsApi, dashboardApi, queueApi } from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import styles from './facility-admin.module.css'

const COLORS = {
  waiting: '#D97706',
  serving: '#2563EB',
  completed: '#16A34A',
  avg: '#7C3AED',
}

const SOCKET_URL = (import.meta.env.VITE_API_URL || 'http://localhost:4000')
  .replace(/\/api\/?$/, '')
  .replace(/\/$/, '')

export default function QueueOversightPage() {
  const { user } = useAuth()
  const clinicId = user?.clinicId

  const [view, setView] = useState('realtime') // 'realtime' | 'summary'
  const [serviceFilter, setServiceFilter] = useState('All Services')
  const [stats, setStats] = useState(null)
  const [queue, setQueue] = useState([])
  const [clinic, setClinic] = useState(null)
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [toast, setToast] = useState('')

  const showToast = useCallback((message) => {
    setToast(message)
    setTimeout(() => setToast(''), 3000)
  }, [])

  // ─── Data Loading ────────────────────────────────────────────────────────────
  const loadOversightData = useCallback(async () => {
    if (!clinicId) {
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const [statsRes, queueRes, clinicRes] = await Promise.all([
        dashboardApi.facility(clinicId),
        queueApi.list({ clinicId }),
        clinicsApi.get(clinicId),
      ])

      const statsPayload = statsRes?.data?.data ?? statsRes?.data ?? null
      setStats(statsPayload)
      setQueue(Array.isArray(queueRes?.data) ? queueRes.data : [])
      setClinic(clinicRes?.data ?? null)
      setLastUpdated(new Date())
    } catch {
      showToast('Failed to load queue oversight data')
    } finally {
      setLoading(false)
    }
  }, [clinicId, showToast])

  useEffect(() => {
    loadOversightData()
  }, [loadOversightData])

  // Keep a stable ref to the latest loadOversightData so the socket effect
  // below doesn't need to reconnect every time the callback identity changes.
  const loadRef = useRef(loadOversightData)
  useEffect(() => {
    loadRef.current = loadOversightData
  }, [loadOversightData])

  // ─── Real-Time Socket Subscription ───────────────────────────────────────────
  useEffect(() => {
    const targetClinicId = typeof clinicId === 'object' ? clinicId?._id : clinicId
    if (!targetClinicId) return

    const socket = io(SOCKET_URL || 'http://localhost:4000', {
      transports: ['polling', 'websocket'],
      withCredentials: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    })

    socket.on('connect', () => {
      socket.emit('join_clinic', String(targetClinicId))
    })

    const handleUpdate = () => {
      if (loadRef.current) loadRef.current()
    }

    socket.on('queue_updated', handleUpdate)
    socket.on('patient_called', handleUpdate)
    socket.on('queue_completed', handleUpdate)

    return () => {
      socket.off('queue_updated', handleUpdate)
      socket.off('patient_called', handleUpdate)
      socket.off('queue_completed', handleUpdate)
      socket.disconnect()
    }
  }, [clinicId])

  // ─── Memoized Selectors & Calculations ───────────────────────────────────────
  const services = useMemo(() => {
    return clinic?.services?.filter((s) => s.isAvailable) || []
  }, [clinic])

  const serviceNames = useMemo(() => {
    return ['All Services', ...services.map((s) => s.name)]
  }, [services])

  const { serviceStats, bottlenecks, recentActivity } = useMemo(() => {
    // Exact string equality was silently dropping entries whose serviceName
    // differs only in case/whitespace from the clinic's service name (e.g.
    // free-typed walk-ins, or a service renamed after entries joined) —
    // those entries still showed in Recent Activity (which doesn't filter
    // by service) but never matched a card, so every card read 0.
    const norm = (str) => (str || '').trim().toLowerCase()

    const rawStats = services.map((svc) => {
      const svcQueue = queue.filter(
        (q) =>
          norm(q.serviceName) === norm(svc.name) ||
          (q.serviceId && svc._id && String(q.serviceId) === String(svc._id))
      )
      // Status comparisons must be case-insensitive: the backend schema
      // stores 'Waiting' / 'Serving' / 'Done' (capitalized), so a strict
      // lowercase check here silently matched nothing and kept every card
      // at 0 even though entries clearly existed (visible in Recent
      // Activity, which doesn't filter by status at all).
      const waiting = svcQueue.filter((q) => norm(q.status) === 'waiting').length
      const serving = svcQueue.filter((q) => norm(q.status) === 'serving').length
      const completed = svcQueue.filter((q) => ['done', 'completed'].includes(norm(q.status))).length
      const avgWait = svc.durationMinutes || 0
      const isBottleneck = waiting >= 8 || (waiting > 0 && avgWait > 30)

      return {
        name: svc.name,
        waiting,
        serving,
        completed,
        avgWait,
        isBottleneck,
        total: svcQueue.length,
      }
    })

    const filtered = rawStats.filter(
      (s) => serviceFilter === 'All Services' || s.name === serviceFilter
    )

    const bottlenecks = rawStats.filter((s) => s.isBottleneck)

    const recentActivity = [...queue]
      .sort((a, b) => new Date(b.joinedAt || 0) - new Date(a.joinedAt || 0))
      .slice(0, 8)

    return {
      serviceStats: filtered,
      bottlenecks,
      recentActivity,
    }
  }, [services, queue, serviceFilter])

  const formatTime = (d) =>
    d ? new Date(d).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }) : '—'

  const s = stats || {}

  return (
    <div className={styles.page}>
      {toast && <div className={styles.toast}>{toast}</div>}

      {/* ── Header ── */}
      <div className={styles.header}>
        <div>
          <div className={styles.title}>Real-Time Queue Oversight</div>
          <div className={styles.sub}>Monitor queue flow and detect bottlenecks across all services</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* View Toggle */}
          <div style={{ display: 'flex', background: 'var(--bg-2)', borderRadius: 8, padding: 3, gap: 0 }}>
            {['realtime', 'summary'].map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                style={{
                  padding: '7px 16px',
                  borderRadius: 6,
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                  background: view === v ? 'var(--primary)' : 'transparent',
                  color: view === v ? '#fff' : 'var(--text-2)',
                }}
              >
                {v === 'realtime' ? 'Real-time View' : 'Summary View'}
              </button>
            ))}
          </div>

          <button
            className="btn btn-primary"
            onClick={loadOversightData}
            disabled={loading}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* ── Filter Bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2">
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
          </svg>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>Filter by Service:</span>
          <select
            className="form-select"
            style={{ width: 160 }}
            value={serviceFilter}
            onChange={(e) => setServiceFilter(e.target.value)}
          >
            {serviceNames.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--success)' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#16A34A', display: 'inline-block' }} />
          Live Updates · Last updated: {lastUpdated ? formatTime(lastUpdated) : '—'}
        </div>
      </div>

      {/* ── REAL-TIME VIEW ── */}
      {view === 'realtime' && (
        <>
          {/* Bottlenecks Banner */}
          {bottlenecks.length > 0 && (
            <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 12, padding: 16, marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="#D97706" stroke="none">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" stroke="#fff" strokeWidth="2" />
                  <line x1="12" y1="17" x2="12.01" y2="17" stroke="#fff" strokeWidth="2" />
                </svg>
                <span style={{ fontWeight: 700, color: '#92400E', fontSize: 14 }}>Bottlenecks Detected</span>
              </div>
              {bottlenecks.map((b) => (
                <div
                  key={b.name}
                  style={{
                    background: '#fff',
                    borderRadius: 8,
                    padding: '12px 16px',
                    marginBottom: 8,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, color: 'var(--text)', fontSize: 13 }}>{b.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                      {b.waiting >= 8
                        ? `High queue length (${b.waiting} patients)`
                        : `Above average wait time (${b.avgWait} minutes)`}
                    </div>
                    <div style={{ fontSize: 12, color: '#2563EB', marginTop: 4 }}>
                      💡 {b.waiting >= 8 ? 'Consider opening an additional service window' : 'Check if additional staff assistance is needed'}
                    </div>
                  </div>
                  <button
                    className="btn btn-outline"
                    style={{ fontSize: 12 }}
                    onClick={() => showToast(`Action logged for ${b.name}`)}
                  >
                    Take Action
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Service Cards + Recent Activity Side by Side */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 16, alignItems: 'start' }}>
            {/* Service Cards */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {loading ? (
                <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
                  Loading real-time queue…
                </div>
              ) : serviceStats.length === 0 ? (
                <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
                  No services configured.
                </div>
              ) : (
                serviceStats.map((svc) => (
                  <div key={svc.name} className="card" style={{ padding: 20 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)' }}>{svc.name}</div>
                        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                          Avg. {svc.avgWait} min per patient
                        </div>
                      </div>
                      <span
                        style={{
                          padding: '3px 10px',
                          borderRadius: 99,
                          fontSize: 11,
                          fontWeight: 700,
                          background: svc.isBottleneck ? '#FEF9C3' : '#DCFCE7',
                          color: svc.isBottleneck ? '#92400E' : '#166534',
                          border: `1px solid ${svc.isBottleneck ? '#FDE047' : '#86EFAC'}`,
                        }}
                      >
                        {svc.isBottleneck ? 'BOTTLENECK' : 'NORMAL'}
                      </span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
                      {[
                        { label: 'Queued', value: svc.waiting, color: COLORS.waiting },
                        { label: 'Serving', value: svc.serving, color: COLORS.serving },
                        { label: 'Completed', value: svc.completed, color: COLORS.completed },
                        { label: 'Avg Wait', value: `${svc.avgWait} min`, color: COLORS.avg },
                      ].map((m) => (
                        <div key={m.label} style={{ background: 'var(--bg-2)', borderRadius: 10, padding: '12px 14px' }}>
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>
                            {m.icon} {m.label}
                          </div>
                          <div style={{ fontSize: 22, fontWeight: 800, color: m.color }}>{m.value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Recent Activity Sidebar */}
            <div className="card" style={{ padding: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', marginBottom: 14 }}>
                Recent Activity
              </div>
              {recentActivity.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: '20px 0' }}>
                  No activity yet
                </div>
              ) : (
                recentActivity.map((q) => (
                  <div key={q._id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 12 }}>
                    <div
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: 99,
                        background: '#EFF6FF',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#2563EB' }}>
                        {q.queueNumber || '—'}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text)', marginTop: 1 }}>
                        {(() => {
                          const st = (q.status || '').toLowerCase()
                          if (st === 'waiting') return 'Checked in'
                          if (st === 'serving') return 'Consultation started'
                          if (st === 'called') return 'Called'
                          if (st === 'completed' || st === 'done') return 'Completed'
                          if (st === 'no_show') return 'No-show'
                          if (st === 'skipped') return 'Skipped'
                          return q.status
                        })()}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{q.serviceName}</div>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>
                      {formatTime(q.joinedAt)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}

      {/* ── SUMMARY VIEW ── */}
      {view === 'summary' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 16 }}>
          <div className="card" style={{ padding: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', marginBottom: 16 }}>
              Service Summary
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Queued</th>
                  <th>Serving</th>
                  <th>Done</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {serviceStats.map((s) => (
                  <tr key={s.name}>
                    <td style={{ fontWeight: 600, fontSize: 13 }}>{s.name}</td>
                    <td style={{ color: COLORS.waiting, fontWeight: 700 }}>{s.waiting}</td>
                    <td style={{ color: COLORS.serving, fontWeight: 700 }}>{s.serving}</td>
                    <td style={{ color: COLORS.completed, fontWeight: 700 }}>{s.completed}</td>
                    <td>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: 99,
                          background: s.isBottleneck ? '#FEF9C3' : '#DCFCE7',
                          color: s.isBottleneck ? '#92400E' : '#166534',
                        }}
                      >
                        {s.isBottleneck ? '⚠ BUSY' : '✓ OK'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card" style={{ padding: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', marginBottom: 16 }}>
              Overall Stats
            </div>
            {[
              ['Total in Queue Today', s.todayPatients ?? 0],
              ['Currently Waiting', s.activeQueue ?? 0],
              ['Completed Today', s.completedToday ?? 0],
              ['Avg Wait Time', `${s.avgWaitTime ?? 0} min`],
              ['Completion Rate', `${s.completionRate ?? 0}%`],
              ['Appointments Today', s.todayAppointments ?? 0],
            ].map(([label, val]) => (
              <div
                key={label}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '10px 0',
                  borderBottom: '1px solid var(--border-lt)',
                }}
              >
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>{label}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                  {loading ? '…' : val}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
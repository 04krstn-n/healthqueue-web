import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { clinicsApi, queueApi } from '../../services/api'
import styles from './super-admin.module.css'

const STATUS_BADGE = {
  waiting: 'badge-warn',
  serving: 'badge-blue',
  done: 'badge-green',
  completed: 'badge-green',
  cancelled: 'badge-gray',
  no_show: 'badge-red',
}

export default function QueueOversightPage() {
  const [clinics, setClinics] = useState([])
  const [queueMap, setQueueMap] = useState({}) // clinicId -> queue[]
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [toast, setToast] = useState('')
  const [actionProcessingId, setActionProcessingId] = useState(null)

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
  const loadOversightData = useCallback(async () => {
    setLoading(true)
    try {
      const clinicRes = await clinicsApi.list()
      const clinicList = Array.isArray(clinicRes?.data) ? clinicRes.data : []
      setClinics(clinicList)

      // Fetch queue arrays for all clinics in parallel
      const queueResults = await Promise.allSettled(
        clinicList.map((c) =>
          queueApi.list({ clinicId: c._id }).then((r) => ({
            id: c._id,
            queue: Array.isArray(r?.data) ? r.data : [],
          }))
        )
      )

      const map = {}
      queueResults.forEach((res) => {
        if (res.status === 'fulfilled') {
          map[res.value.id] = res.value.queue
        }
      })

      setQueueMap(map)
    } catch {
      showToast('Failed to load queue oversight data')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => {
    loadOversightData()
  }, [loadOversightData])

  // ─── Queue Actions ───────────────────────────────────────────────────────────
  const handleQueueAction = async (queueId, apiCall, actionLabel) => {
    setActionProcessingId(queueId)
    try {
      await apiCall(queueId)
      showToast(`${actionLabel} successfully`)
      await loadOversightData()
    } catch (err) {
      showToast(err?.response?.data?.message || `Failed to ${actionLabel.toLowerCase()}`)
    } finally {
      setActionProcessingId(null)
    }
  }

  // ─── Memoized Selectors & Aggregate Totals ────────────────────────────────────
  const filteredClinics = useMemo(() => {
    const query = search.trim().toLowerCase()
    return clinics.filter((c) => {
      if (!query) return true
      return (
        c.name?.toLowerCase().includes(query) ||
        c.city?.toLowerCase().includes(query) ||
        c.province?.toLowerCase().includes(query)
      )
    })
  }, [clinics, search])

  const aggregateStats = useMemo(() => {
    let waiting = 0
    let serving = 0
    let completed = 0
    let total = 0

    Object.values(queueMap).forEach((queueList) => {
      if (!Array.isArray(queueList)) return
      queueList.forEach((item) => {
        total += 1
        if (item.status === 'waiting') waiting += 1
        else if (item.status === 'serving') serving += 1
        else if (['done', 'completed'].includes(item.status)) completed += 1
      })
    })

    return { total, waiting, serving, completed }
  }, [queueMap])

  return (
    <div className={styles.page}>
      {toast && <div className={styles.toast}>{toast}</div>}

      {/* Header */}
      <div className={styles.header}>
        <div>
          <div className={styles.title}>Queue Oversight</div>
          <div className={styles.sub}>Monitor live queues across all health facilities</div>
        </div>
        <div className={styles.toolbar}>
          <input
            className="form-input"
            style={{ width: 220 }}
            placeholder="Search facility or city…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="btn btn-outline" onClick={loadOversightData} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Summary KPI Stats */}
      <div className={styles.statsRow} style={{ marginBottom: 20 }}>
        <div className={`card ${styles.statCard}`}>
          <div className={styles.statLabel}>Total in Queue</div>
          <div className={styles.statValue}>{loading ? '…' : aggregateStats.total}</div>
        </div>
        <div className={`card ${styles.statCard}`}>
          <div className={styles.statLabel}>Waiting</div>
          <div className={styles.statValue} style={{ color: '#D97706' }}>
            {loading ? '…' : aggregateStats.waiting}
          </div>
        </div>
        <div className={`card ${styles.statCard}`}>
          <div className={styles.statLabel}>Being Served</div>
          <div className={styles.statValue} style={{ color: '#2563EB' }}>
            {loading ? '…' : aggregateStats.serving}
          </div>
        </div>
        <div className={`card ${styles.statCard}`}>
          <div className={styles.statLabel}>Completed Today</div>
          <div className={styles.statValue} style={{ color: '#16A34A' }}>
            {loading ? '…' : aggregateStats.completed}
          </div>
        </div>
      </div>

      {/* Per-Clinic Accordion List */}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
          Loading facility queues…
        </div>
      ) : filteredClinics.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
          No facilities found.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filteredClinics.map((clinic) => {
            const queue = queueMap[clinic._id] || []
            const waitingCount = queue.filter((q) => q.status === 'waiting').length
            const capacity = clinic.maxQueueCapacity || 60
            const percentage = Math.min(100, Math.round((queue.length / capacity) * 100))
            const isOpen = expandedId === clinic._id

            return (
              <div key={clinic._id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                {/* Clinic Summary Row */}
                <div
                  style={{
                    padding: '14px 18px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    cursor: 'pointer',
                    borderBottom: isOpen ? '1px solid var(--border-lt)' : 'none',
                    background: isOpen ? 'var(--bg-2)' : 'transparent',
                  }}
                  onClick={() => setExpandedId(isOpen ? null : clinic._id)}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, color: 'var(--text)', fontSize: 14 }}>
                      {clinic.name}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                      {clinic.city || '—'}, {clinic.province || '—'}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                    <span className={`badge ${waitingCount > 0 ? 'badge-warn' : 'badge-gray'}`}>
                      {waitingCount} waiting
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                      {queue.length}/{capacity}
                    </span>
                    <div style={{ width: 80 }}>
                      <div className={styles.ovProgress}>
                        <div
                          className={styles.ovBar}
                          style={{
                            width: `${percentage}%`,
                            background:
                              percentage > 80 ? '#DC2626' : percentage > 50 ? '#D97706' : '#2563EB',
                          }}
                        />
                      </div>
                    </div>
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="var(--muted)"
                      strokeWidth="2"
                      style={{
                        transform: isOpen ? 'rotate(180deg)' : 'none',
                        transition: 'transform 0.2s',
                      }}
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </div>
                </div>

                {/* Expanded Queue Table */}
                {isOpen && (
                  <div style={{ padding: '0 18px 14px' }}>
                    {queue.length === 0 ? (
                      <div
                        style={{
                          padding: '20px 0',
                          textAlign: 'center',
                          color: 'var(--muted)',
                          fontSize: 13,
                        }}
                      >
                        No active queue entries.
                      </div>
                    ) : (
                      <table className="table" style={{ marginTop: 12 }}>
                        <thead>
                          <tr>
                            <th>Queue #</th>
                            <th>Patient</th>
                            <th>Service</th>
                            <th>Type</th>
                            <th>Joined</th>
                            <th>Status</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {queue.map((q) => {
                            const isBusy = actionProcessingId === q._id

                            return (
                              <tr key={q._id}>
                                <td>
                                  <strong>{q.queueNumber || '—'}</strong>
                                </td>
                                <td>{q.patientName || '—'}</td>
                                <td>{q.serviceName || '—'}</td>
                                <td>{q.queueType || 'Regular'}</td>
                                <td style={{ fontSize: 12 }}>
                                  {q.joinedAt
                                    ? new Date(q.joinedAt).toLocaleTimeString('en-PH', {
                                        hour: '2-digit',
                                        minute: '2-digit',
                                      })
                                    : '—'}
                                </td>
                                <td>
                                  <span className={`badge ${STATUS_BADGE[q.status] || 'badge-gray'}`}>
                                    {q.status}
                                  </span>
                                </td>
                                <td>
                                  <div style={{ display: 'flex', gap: 4 }}>
                                    {q.status === 'waiting' && (
                                      <button
                                        className="btn btn-outline"
                                        style={{ fontSize: 11, padding: '3px 8px' }}
                                        disabled={isBusy}
                                        onClick={() =>
                                          handleQueueAction(q._id, queueApi.call, 'Called patient')
                                        }
                                      >
                                        Call
                                      </button>
                                    )}
                                    {q.status === 'serving' && (
                                      <button
                                        className="btn btn-outline"
                                        style={{ fontSize: 11, padding: '3px 8px', color: 'var(--success)' }}
                                        disabled={isBusy}
                                        onClick={() =>
                                          handleQueueAction(q._id, queueApi.complete, 'Completed')
                                        }
                                      >
                                        Done
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
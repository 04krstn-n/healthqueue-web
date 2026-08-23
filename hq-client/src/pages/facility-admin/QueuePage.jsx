import { useState, useEffect, useCallback, useMemo } from 'react'
import { clinicsApi, queueApi, appointmentsApi } from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import styles from './facility-admin.module.css'

const STATUS_BADGE = {
  waiting: 'badge-warn',
  serving: 'badge-blue',
  done: 'badge-green',
  completed: 'badge-green',
  skipped: 'badge-gray',
  no_show: 'badge-red',
  cancelled: 'badge-red',
  pending: 'badge-warn',
  confirmed: 'badge-blue',
  arrived: 'badge-green',
  rescheduled: 'badge-gray',
}

const PATIENT_TYPES = ['Regular', 'Senior Citizen', 'PWD', 'Pregnant', 'Priority']
const APPT_STATUSES = ['pending', 'confirmed', 'arrived', 'serving', 'completed', 'no show', 'cancelled', 'rescheduled']

const INITIAL_WALKIN_FORM = {
  patientName: '',
  phone: '',
  serviceName: '',
  patientType: 'Regular',
}

export default function QueueAndAppointmentsPage() {
  const { user } = useAuth()
  const clinicId = user?.clinicId

  const [tab, setTab] = useState('queue') // 'queue' | 'appointments'

  // ── Queue State ──
  const [queue, setQueue] = useState([])
  const [metrics, setMetrics] = useState(null)
  const [services, setServices] = useState([])
  const [qLoading, setQLoading] = useState(true)
  const [qSearch, setQSearch] = useState('')
  const [qStatus, setQStatus] = useState('All')

  // ── Walk-in Modal State ──
  const [walkinModal, setWalkinModal] = useState(false)
  const [walkinForm, setWalkinForm] = useState(INITIAL_WALKIN_FORM)
  const [walkinErrors, setWalkinErrors] = useState({})
  const [wSaving, setWSaving] = useState(false)

  // ── Appointment State ──
  const [appts, setAppts] = useState([])
  const [aLoading, setALoading] = useState(true)
  const [aSearch, setASearch] = useState('')
  const [aStatus, setAStatus] = useState('All')
  const [aTab, setATab] = useState('today') // 'today' | 'upcoming' | 'past'

  const [toast, setToast] = useState('')

  const showToast = useCallback((msg) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }, [])

  // ─── Data Loaders ────────────────────────────────────────────────────────────
  const loadQueue = useCallback(async () => {
    if (!clinicId) {
      setQLoading(false)
      return
    }

    setQLoading(true)
    try {
      const [queueRes, metricsRes, clinicRes] = await Promise.all([
        queueApi.list({ clinicId }),
        queueApi.metrics(clinicId).catch(() => ({ data: null })),
        clinicsApi.get(clinicId),
      ])

      setQueue(Array.isArray(queueRes?.data) ? queueRes.data : [])
      setMetrics(metricsRes?.data?.data ?? metricsRes?.data ?? null)
      setServices((clinicRes?.data?.services || []).filter((s) => s.isAvailable))
    } catch {
      showToast('Failed to load queue data')
    } finally {
      setQLoading(false)
    }
  }, [clinicId, showToast])

  // Fetches the clinic's full appointment list once — Today / Upcoming /
  // Past are now client-side buckets over the same data (see apptBucket
  // below), so switching tabs no longer needs a fresh request.
  const loadAppts = useCallback(async () => {
    if (!clinicId) {
      setALoading(false)
      return
    }

    setALoading(true)
    try {
      const res = await appointmentsApi.list({ clinicId })
      setAppts(Array.isArray(res?.data) ? res.data : [])
    } catch {
      setAppts([])
      showToast('Failed to load appointments')
    } finally {
      setALoading(false)
    }
  }, [clinicId, showToast])

  useEffect(() => {
    loadQueue()
    loadAppts()
  }, [loadQueue, loadAppts])

  // ─── Walk-in Handlers ────────────────────────────────────────────────────────
  const closeWalkinModal = () => {
    setWalkinModal(false)
    setWalkinForm(INITIAL_WALKIN_FORM)
    setWalkinErrors({})
  }

  const handleWalkinChange = (field, value) => {
    setWalkinForm((prev) => ({ ...prev, [field]: value }))
    if (walkinErrors[field]) {
      setWalkinErrors((prev) => ({ ...prev, [field]: '' }))
    }
  }

  const addWalkin = async () => {
    const errors = {}
    if (!walkinForm.patientName.trim()) {
      errors.patientName = 'Patient name is required'
    }
    if (!walkinForm.serviceName.trim()) {
      errors.serviceName = 'Service is required'
    }

    if (Object.keys(errors).length > 0) {
      setWalkinErrors(errors)
      return
    }

    setWSaving(true)
    try {
      await queueApi.addWalkin({ ...walkinForm, clinicId })
      showToast('Walk-in patient added')
      closeWalkinModal()
      loadQueue()
    } catch (e) {
      showToast(e?.response?.data?.message || 'Failed to add walk-in')
    } finally {
      setWSaving(false)
    }
  }

  // ─── Filtered Data Selectors ─────────────────────────────────────────────────
  const filteredQueue = useMemo(() => {
    const query = qSearch.trim().toLowerCase()
    return queue.filter((q) => {
      const matchStatus = qStatus === 'All' || q.status === qStatus
      const matchQuery =
        !query ||
        q.patientName?.toLowerCase().includes(query) ||
        q.queueNumber?.toLowerCase().includes(query) ||
        q.serviceName?.toLowerCase().includes(query)

      return matchStatus && matchQuery
    })
  }, [queue, qSearch, qStatus])

  // ── Today / Upcoming / Past bucketing ──
  const { todayStart, todayEnd } = useMemo(() => {
    const start = new Date(); start.setHours(0, 0, 0, 0)
    const end = new Date(); end.setHours(23, 59, 59, 999)
    return { todayStart: start, todayEnd: end }
  }, [])

  const apptBucket = useCallback((appt) => {
    if (!appt.appointmentDate) return 'past'
    const d = new Date(appt.appointmentDate)
    if (d >= todayStart && d <= todayEnd) return 'today'
    if (d > todayEnd) return 'upcoming'
    return 'past'
  }, [todayStart, todayEnd])

  const filteredAppts = useMemo(() => {
    const query = aSearch.trim().toLowerCase()
    return appts.filter((a) => {
      const matchTab = apptBucket(a) === aTab
      const matchStatus = aStatus === 'All' || a.status === aStatus
      const matchQuery =
        !query ||
        a.patientName?.toLowerCase().includes(query) ||
        a.serviceName?.toLowerCase().includes(query) ||
        a.patientPhone?.toLowerCase().includes(query)

      return matchTab && matchStatus && matchQuery
    })
  }, [appts, aSearch, aStatus, aTab, apptBucket])

  // ── CSV Export (rolling last-30-days window) ──
  const downloadApptsCsv = () => {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 30)
    cutoff.setHours(0, 0, 0, 0)

    const rows = appts.filter((a) => a.appointmentDate && new Date(a.appointmentDate) >= cutoff)

    if (rows.length === 0) {
      showToast('No appointments in the last 30 days to export')
      return
    }

    const escapeCsv = (val) => {
      const s = String(val ?? '')
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }

    const headers = ['Date', 'Time', 'Patient Name', 'Phone', 'Service', 'Patient Type', 'Status']
    const lines = [
      headers.join(','),
      ...rows.map((a) => [
        a.appointmentDate ? new Date(a.appointmentDate).toLocaleDateString('en-PH') : '',
        a.timeSlot || '',
        a.patientName || '',
        a.patientPhone || '',
        a.serviceName || '',
        a.patientType || '',
        a.status || '',
      ].map(escapeCsv).join(',')),
    ]

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `appointments_last_30_days_${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  // ─── Queue & Appointment Stats ───────────────────────────────────────────────
  const { qWaiting, qServing, qCompleted, totalToday, aPending, aConfirmed, aCompleted } = useMemo(() => {
    return {
      qWaiting: queue.filter((q) => q.status === 'waiting').length,
      qServing: queue.filter((q) => q.status === 'serving').length,
      qCompleted: queue.filter((q) => ['done', 'completed'].includes(q.status)).length,
      totalToday: appts.filter((a) => apptBucket(a) === 'today').length,
      aPending: appts.filter((a) => a.status === 'pending').length,
      aConfirmed: appts.filter((a) => a.status === 'confirmed').length,
      aCompleted: appts.filter((a) => a.status === 'completed').length,
    }
  }, [queue, appts, apptBucket])

  return (
    <div className={styles.page}>
      {toast && <div className={styles.toast}>{toast}</div>}

      {/* ── Page Header ── */}
      <div className={styles.header}>
        <div>
          <div className={styles.title}>Queue & Appointment Management</div>
          <div className={styles.sub}>Manage walk-ins and scheduled appointments</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {tab === 'queue' && (
            <button className="btn btn-primary" onClick={() => setWalkinModal(true)}>
              + Add Walk-in
            </button>
          )}
        </div>
      </div>

      {/* ── Tab Switcher ── */}
      <div style={{ display: 'flex', gap: 0, background: 'var(--bg-2)', borderRadius: 10, padding: 4, width: 'fit-content', marginBottom: 16 }}>
        <button
          onClick={() => setTab('queue')}
          style={{
            padding: '8px 20px',
            borderRadius: 8,
            border: 'none',
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: 13,
            background: tab === 'queue' ? 'var(--primary)' : 'transparent',
            color: tab === 'queue' ? '#fff' : 'var(--text-2)',
          }}
        >
          Queue Management
        </button>
        <button
          onClick={() => setTab('appointments')}
          style={{
            padding: '8px 20px',
            borderRadius: 8,
            border: 'none',
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: 13,
            background: tab === 'appointments' ? 'var(--primary)' : 'transparent',
            color: tab === 'appointments' ? '#fff' : 'var(--text-2)',
          }}
        >
          Appointment Management
        </button>
      </div>

      {/* ── QUEUE TAB ── */}
      {tab === 'queue' && (
        <>
          {/* Queue KPI Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 16 }}>
            {[
              { label: 'Waiting', value: qWaiting, color: '#D97706' },
              { label: 'Being Served', value: qServing, color: '#2563EB' },
              { label: 'Completed', value: qCompleted, color: '#16A34A' },
              { label: 'Avg Wait', value: `${metrics?.avgWait ?? 0} min`, color: '#7C3AED' },
            ].map((stat) => (
              <div key={stat.label} className="card" style={{ padding: 16 }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>{stat.label}</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: stat.color }}>
                  {qLoading ? '…' : stat.value}
                </div>
              </div>
            ))}
          </div>

          {/* Queue Toolbar */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input
              className="form-input"
              style={{ flex: 1, maxWidth: 260 }}
              placeholder="Search patient, service, queue #…"
              value={qSearch}
              onChange={(e) => setQSearch(e.target.value)}
            />
            <select
              className="form-select"
              style={{ width: 140 }}
              value={qStatus}
              onChange={(e) => setQStatus(e.target.value)}
            >
              {['All', 'Waiting', 'Serving', 'Done', 'Completed', 'Cancelled', 'No Show'].map((status) => (
                <option key={status} value={status}>
                  {status === 'All' ? 'All Status' : status}
                </option>
              ))}
            </select>
            <button className="btn btn-outline" onClick={loadQueue} disabled={qLoading}>
              {qLoading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          {/* Queue Table */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {qLoading ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading queue…</div>
            ) : filteredQueue.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
                {queue.length === 0 ? 'No queue entries today.' : 'No results match your filter.'}
              </div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Queue #</th>
                    <th>Patient</th>
                    <th>Service</th>
                    <th>Type</th>
                    <th>Joined</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredQueue.map((q) => (
                    <tr key={q._id}>
                      <td><strong>{q.queueNumber || '—'}</strong></td>
                      <td>
                        <div>{q.patientName || '—'}</div>
                        {q.patientPhone && (
                          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{q.patientPhone}</div>
                        )}
                      </td>
                      <td>{q.serviceName || '—'}</td>
                      <td>
                        <span className={`badge ${q.queueType === 'Priority' ? 'badge-red' : 'badge-blue'}`}>
                          {q.queueType || 'Regular'}
                        </span>
                      </td>
                      <td style={{ fontSize: 12 }}>
                        {q.joinedAt ? new Date(q.joinedAt).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }) : '—'}
                      </td>
                      <td>
                        <span className={`badge ${STATUS_BADGE[q.status] || 'badge-gray'}`}>{q.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* ── APPOINTMENTS TAB ── */}
      {tab === 'appointments' && (
        <>
          {/* Appointment KPI Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 16 }}>
            {[
              { label: 'Total Today', value: totalToday, color: '#2563EB' },
              { label: 'Pending', value: aPending, color: '#D97706' },
              { label: 'Confirmed', value: aConfirmed, color: '#16A34A' },
              { label: 'Completed', value: aCompleted, color: '#7C3AED' },
            ].map((stat) => (
              <div key={stat.label} className="card" style={{ padding: 16 }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>{stat.label}</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: stat.color }}>
                  {aLoading ? '…' : stat.value}
                </div>
              </div>
            ))}
          </div>

          {/* Sub-tabs + Filters */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
            <div style={{ display: 'flex', gap: 0, background: 'var(--bg-2)', borderRadius: 8, padding: 3 }}>
              {['today', 'upcoming', 'past'].map((t) => (
                
                <button
                  key={t}
                  onClick={() => setATab(t)}
                  style={{
                    padding: '6px 16px',
                    borderRadius: 6,
                    border: 'none',
                    cursor: 'pointer',
                    fontWeight: 600,
                    fontSize: 12,
                    background: aTab === t ? 'var(--primary)' : 'transparent',
                    color: aTab === t ? '#fff' : 'var(--text-2)',
                  }}
                >
                  {t === 'today' ? "Today's" : t === 'upcoming' ? 'Upcoming' : 'Past'}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input
                className="form-input"
                style={{ width: 220 }}
                placeholder="Search patient, phone, service…"
                value={aSearch}
                onChange={(e) => setASearch(e.target.value)}
              />
              <select
                className="form-select"
                style={{ width: 150 }}
                value={aStatus}
                onChange={(e) => setAStatus(e.target.value)}
              >
                <option value="All">All Status</option>
                {APPT_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status.charAt(0).toUpperCase() + status.slice(1).replace('_', ' ')}
                  </option>
                ))}
              </select>
              <button className="btn btn-outline" onClick={loadAppts} disabled={aLoading}>
                {aLoading ? 'Refreshing…' : 'Refresh'}
              </button>
              <button className="btn btn-outline" onClick={downloadApptsCsv} disabled={aLoading || appts.length === 0}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Export CSV
              </button>
            </div>
          </div>

          {/* Appointments Table */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {aLoading ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading appointments…</div>
            ) : filteredAppts.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>No appointments found.</div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Patient</th>
                    <th>Service</th>
                    <th>Date & Time</th>
                    <th>Type</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAppts.map((appt) => (
                    <tr key={appt._id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{appt.patientName || '—'}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{appt.patientPhone || '—'}</div>
                      </td>
                      <td>{appt.serviceName || '—'}</td>
                      <td style={{ fontSize: 12 }}>
                        <div>
                          {appt.appointmentDate
                            ? new Date(appt.appointmentDate).toLocaleDateString('en-PH', {
                                year: 'numeric',
                                month: 'short',
                                day: 'numeric',
                              })
                            : '—'}
                        </div>
                        <div style={{ color: 'var(--muted)' }}>{appt.timeSlot || '—'}</div>
                      </td>
                      <td>
                        <span className={`badge ${appt.patientType === 'Regular' ? 'badge-blue' : 'badge-red'}`}>
                          {appt.patientType || 'Regular'}
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${STATUS_BADGE[appt.status] || 'badge-gray'}`}>{appt.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* ── WALK-IN MODAL ── */}
      {walkinModal && (
        <div className="modal-overlay" onClick={closeWalkinModal}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Add Walk-in Patient</span>
              <button className="modal-close" onClick={closeWalkinModal}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label"> Patient Name <span style={{ color: 'var(--error)' }}>*</span> </label>
                <input
                  className="form-input"
                  value={walkinForm.patientName}
                  placeholder="Full name"
                  style={{ border: walkinErrors.patientName ? '1px solid #DC2626' : undefined }}
                  onChange={(e) => handleWalkinChange('patientName', e.target.value)}
                />
                {walkinErrors.patientName && (
                  <div style={{ color: '#DC2626', fontSize: 12, marginTop: 6, fontWeight: 500 }}>
                    {walkinErrors.patientName}
                  </div>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">Phone </label>
                <input
                  className="form-input"
                  type="tel"
                  inputMode="numeric"
                  maxLength={11}
                  value={walkinForm.phone}
                  placeholder="09XXXXXXXXX"
                  onChange={(e) => handleWalkinChange('phone', e.target.value.replace(/\D/g, '').slice(0, 11))}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Service <span style={{ color: 'var(--error)' }}>*</span></label>
                {services.length > 0 ? (
                  <select
                    className="form-select"
                    value={walkinForm.serviceName}
                    style={{ border: walkinErrors.serviceName ? '1px solid #DC2626' : undefined }}
                    onChange={(e) => handleWalkinChange('serviceName', e.target.value)}
                  >
                    <option value="">Select service…</option>
                    {services.map((s) => (
                      <option key={s._id || s.name} value={s.name}>
                        {s.name} ({s.durationMinutes || 15} min)
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="form-input"
                    value={walkinForm.serviceName}
                    placeholder="e.g. Consultation"
                    style={{ border: walkinErrors.serviceName ? '1px solid #DC2626' : undefined }}
                    onChange={(e) => handleWalkinChange('serviceName', e.target.value)}
                  />
                )}
                {walkinErrors.serviceName && (
                  <div style={{ color: '#DC2626', fontSize: 12, marginTop: 6, fontWeight: 500 }}>
                    {walkinErrors.serviceName}
                  </div>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">Patient Type</label>
                <select
                  className="form-select"
                  value={walkinForm.patientType}
                  onChange={(e) => handleWalkinChange('patientType', e.target.value)}
                >
                  {PATIENT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn btn-outline" onClick={closeWalkinModal}>Cancel</button>
              <button className="btn btn-primary" onClick={addWalkin} disabled={wSaving}>
                {wSaving ? 'Adding…' : 'Add to Queue'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
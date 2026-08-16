import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { clinicsApi, appointmentsApi } from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import styles from './facility-admin.module.css'

const STATUS_BADGE = {
  pending: 'badge-warn',
  confirmed: 'badge-blue',
  arrived: 'badge-green',
  serving: 'badge-blue',
  completed: 'badge-green',
  no_show: 'badge-red',
  cancelled: 'badge-red',
  rescheduled: 'badge-gray',
  late: 'badge-orange',
}

const STATUS_OPTIONS = [
  'pending',
  'confirmed',
  'arrived',
  'serving',
  'completed',
  'no_show',
  'cancelled',
  'rescheduled',
]

export default function AppointmentsPage() {
  const { user } = useAuth()
  const clinicId = user?.clinicId

  const [appointments, setAppointments] = useState([])
  const [services, setServices] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('today') // 'today' | 'all'
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [toast, setToast] = useState('')
  const [processingId, setProcessingId] = useState(null)

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
  const loadData = useCallback(async () => {
    if (!clinicId) {
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const apptPromise =
        tab === 'today'
          ? appointmentsApi.today(clinicId)
          : appointmentsApi.list({ clinicId })

      const [apptRes, clinicRes] = await Promise.all([
        apptPromise,
        clinicsApi.get(clinicId),
      ])

      // api.js unwrap returns the data array/object directly in `res.data`
      setAppointments(Array.isArray(apptRes?.data) ? apptRes.data : [])

      const clinicServices = clinicRes?.data?.services || []
      setServices(clinicServices.filter((s) => s.isAvailable))
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to load appointment records')
    } finally {
      setLoading(false)
    }
  }, [clinicId, tab, showToast])

  useEffect(() => {
    loadData()
  }, [loadData])

  // ─── Status & Mutation Handlers ──────────────────────────────────────────────
  const handleUpdateStatus = async (id, status) => {
    try {
      setProcessingId(id)
      await appointmentsApi.updateStatus(id, status)
      showToast(`Status updated to ${status}`)
      await loadData()
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to update status')
    } finally {
      setProcessingId(null)
    }
  }

  const handleCancelAppointment = async (id) => {
    const reason = window.prompt('Enter cancellation reason (optional):', 'Administrative Cancellation')
    if (reason === null) return // User cancelled prompt

    try {
      setProcessingId(id)
      // appointmentsApi.cancel expects (id, reason) in api.js
      await appointmentsApi.cancel(id, reason)
      showToast('Appointment cancelled successfully')
      await loadData()
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to cancel appointment')
    } finally {
      setProcessingId(null)
    }
  }

  // ─── Filtered Data ───────────────────────────────────────────────────────────
  const filteredAppointments = useMemo(() => {
    const query = search.trim().toLowerCase()

    return appointments.filter((appt) => {
      const matchStatus = statusFilter === 'All' || appt.status === statusFilter
      const matchSearch =
        !query ||
        appt.patientName?.toLowerCase().includes(query) ||
        appt.serviceName?.toLowerCase().includes(query) ||
        appt.patientPhone?.toLowerCase().includes(query)

      return matchStatus && matchSearch
    })
  }, [appointments, search, statusFilter])

  // ─── Action Button Renderers ─────────────────────────────────────────────────
  const renderActionButtons = (appt) => {
    const isBusy = processingId === appt._id

    return (
      <div style={{ display: 'flex', gap: 4 }}>
        {appt.status === 'pending' && (
          <button
            className="btn btn-outline"
            style={{ fontSize: 11, padding: '3px 8px' }}
            disabled={isBusy}
            onClick={() => handleUpdateStatus(appt._id, 'confirmed')}
          >
            Confirm
          </button>
        )}

        {appt.status === 'confirmed' && (
          <button
            className="btn btn-outline"
            style={{ fontSize: 11, padding: '3px 8px' }}
            disabled={isBusy}
            onClick={() => handleUpdateStatus(appt._id, 'arrived')}
          >
            Arrived
          </button>
        )}

        {appt.status === 'arrived' && (
          <button
            className="btn btn-outline"
            style={{ fontSize: 11, padding: '3px 8px' }}
            disabled={isBusy}
            onClick={() => handleUpdateStatus(appt._id, 'serving')}
          >
            Serve
          </button>
        )}

        {appt.status === 'serving' && (
          <button
            className="btn btn-outline"
            style={{ fontSize: 11, padding: '3px 8px', color: 'var(--success)' }}
            disabled={isBusy}
            onClick={() => handleUpdateStatus(appt._id, 'completed')}
          >
            Complete
          </button>
        )}

        {!['completed', 'cancelled', 'no_show'].includes(appt.status) && (
          <button
            className="btn"
            style={{
              fontSize: 11,
              padding: '3px 8px',
              color: 'var(--error)',
              background: 'var(--error-lt)',
              border: 'none',
            }}
            disabled={isBusy}
            onClick={() => handleCancelAppointment(appt._id)}
          >
            Cancel
          </button>
        )}
      </div>
    )
  }

  return (
    <div className={styles.page}>
      {toast && <div className={styles.toast}>{toast}</div>}

      {/* Header & Tabs */}
      <div className={styles.header}>
        <div style={{ display: 'flex', gap: 0, background: 'var(--bg-2)', borderRadius: 8, padding: 3 }}>
          <button
            onClick={() => setTab('today')}
            className={tab === 'today' ? 'btn btn-primary' : 'btn btn-outline'}
            style={{ fontSize: 13, borderRadius: 6 }}
          >
            Today's Appointments
          </button>
          <button
            onClick={() => setTab('all')}
            className={tab === 'all' ? 'btn btn-primary' : 'btn btn-outline'}
            style={{ fontSize: 13, borderRadius: 6 }}
          >
            All Appointments
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline" onClick={loadData} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Search & Status Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          className="form-input"
          style={{ width: 240 }}
          placeholder="Search patient, phone, or service…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <select
          className="form-select"
          style={{ width: 160 }}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="All">All Status</option>
          {STATUS_OPTIONS.map((status) => (
            <option key={status} value={status}>
              {status.charAt(0).toUpperCase() + status.slice(1).replace('_', ' ')}
            </option>
          ))}
        </select>
      </div>

      {/* Appointment Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
            Loading appointments…
          </div>
        ) : filteredAppointments.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
            No appointments found.
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Patient</th>
                <th>Service</th>
                <th>Date & Time</th>
                <th>Type</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredAppointments.map((appt) => (
                <tr key={appt._id}>
                  <td>
                    <div>
                      <strong>{appt.patientName || '—'}</strong>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                      {appt.patientPhone || 'No phone'}
                    </div>
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
                    <span className={`badge ${STATUS_BADGE[appt.status] || 'badge-gray'}`}>
                      {appt.status}
                    </span>
                  </td>
                  <td>{renderActionButtons(appt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
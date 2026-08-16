import { useState, useEffect, useCallback, useMemo } from 'react'
import { timeSlotsApi } from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import styles from './facility-admin.module.css'

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

const TIME_OPTIONS = (() => {
  const options = []
  for (let h = 7; h <= 17; h++) {
    ;['00', '30'].forEach((m) => {
      const displayHour = h > 12 ? h - 12 : h
      const ampm = h >= 12 ? 'PM' : 'AM'
      options.push({
        value: `${String(h).padStart(2, '0')}:${m}`,
        label: `${displayHour}:${m} ${ampm}`,
      })
    })
  }
  return options
})()

const INITIAL_FORM = {
  serviceName: '',
  dayOfWeek: 0,
  startTime: '08:00',
  endTime: '09:00',
  maxPatients: 1,
}

export default function SchedulePage() {
  const { user } = useAuth()
  const clinicId = user?.clinicId

  const [slots, setSlots] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(INITIAL_FORM)
  const [formErrors, setFormErrors] = useState({})
  const [toast, setToast] = useState('')

  const showToast = useCallback((msg) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }, [])

  // ─── Data Loading ────────────────────────────────────────────────────────────
  const loadSchedule = useCallback(async () => {
    if (!clinicId) {
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const res = await timeSlotsApi.list({ clinicId })
      setSlots(Array.isArray(res?.data) ? res.data : [])
    } catch {
      setSlots([])
      showToast('Failed to load clinic time slots')
    } finally {
      setLoading(false)
    }
  }, [clinicId, showToast])

  useEffect(() => {
    loadSchedule()
  }, [loadSchedule])

  // ─── Modal & Form Handlers ───────────────────────────────────────────────────
  const openAdd = () => {
    setEditing(null)
    setForm(INITIAL_FORM)
    setFormErrors({})
    setShowModal(true)
  }

  const openEdit = (slot) => {
    setEditing(slot)
    setForm({
      serviceName: slot.serviceName || '',
      dayOfWeek: slot.dayOfWeek ?? 0,
      startTime: slot.startTime || '08:00',
      endTime: slot.endTime || '09:00',
      maxPatients: slot.maxPatients || 1,
    })
    setFormErrors({})
    setShowModal(true)
  }

  const closeModal = () => {
    setShowModal(false)
    setEditing(null)
    setForm(INITIAL_FORM)
    setFormErrors({})
  }

  const handleFieldChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }))
    if (formErrors[field]) {
      setFormErrors((prev) => ({ ...prev, [field]: '' }))
    }
  }

  // ─── Mutation Handlers ───────────────────────────────────────────────────────
  const handleSave = async () => {
    const errors = {}
    if (!form.serviceName.trim()) {
      errors.serviceName = 'Service name is required'
    }
    if (form.startTime >= form.endTime) {
      errors.endTime = 'End time must be later than start time'
    }
    if (form.maxPatients < 1) {
      errors.maxPatients = 'Must allow at least 1 patient'
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors)
      return
    }

    setSaving(true)
    try {
      if (editing?._id) {
        await timeSlotsApi.update(editing._id, form)
        showToast('Time slot updated')
      } else {
        await timeSlotsApi.create({ ...form, clinicId })
        showToast('Time slot created')
      }
      closeModal()
      loadSchedule()
    } catch (e) {
      showToast(e?.response?.data?.message || 'Failed to save time slot')
    } finally {
      setSaving(false)
    }
  }

  const handleRemove = async (id) => {
    if (!window.confirm('Remove this time slot?')) return
    try {
      await timeSlotsApi.delete(id)
      showToast('Time slot removed')
      loadSchedule()
    } catch (e) {
      showToast(e?.response?.data?.message || 'Failed to remove time slot')
    }
  }

  // ─── Memoized Schedule Mapping ───────────────────────────────────────────────
  const slotsByDay = useMemo(() => {
    const map = {}
    DAYS.forEach((_, idx) => {
      map[idx] = slots
        .filter((s) => s.dayOfWeek === idx)
        .sort((a, b) => a.startTime.localeCompare(b.startTime))
    })
    return map
  }, [slots])

  return (
    <div className={styles.page}>
      {toast && <div className={styles.toast}>{toast}</div>}

      {/* ── Header ── */}
      <div className={styles.header}>
        <div>
          <div className={styles.title}>Schedule & Time Slots</div>
          <div className={styles.sub}>Manage appointment time slots for each day of the week</div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={openAdd}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add Time Slot
        </button>
      </div>

      {/* ── Day Columns ── */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 48, color: 'var(--muted)' }}>
          Loading schedule…
        </div>
      ) : (
        <div className={styles.grid}>
          {DAYS.map((day, dayIndex) => {
            const daySlots = slotsByDay[dayIndex] || []

            return (
              <div key={day} className={`card ${styles.dayCard}`}>
                <div className={styles.dayTitle}>{day}</div>
                {daySlots.length === 0 ? (
                  <div className={styles.empty}>No slots</div>
                ) : (
                  daySlots.map((s) => (
                    <div key={s._id} className={styles.slotItem}>
                      <div className={styles.slotTime}>
                        {s.label || s.startTime} – {s.endTime}
                      </div>
                      <div className={styles.slotService}>{s.serviceName}</div>
                      <div className={styles.slotMeta}>Max: {s.maxPatients} patients</div>
                      <div className={styles.slotActions}>
                        <button
                          className="btn btn-icon btn-outline"
                          onClick={() => openEdit(s)}
                          title="Edit slot"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </button>
                        <button
                          className="btn btn-icon"
                          style={{ background: 'var(--error-lt)', color: 'var(--error)' }}
                          onClick={() => handleRemove(s._id)}
                          title="Delete slot"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Add / Edit Slot Modal ── */}
      {showModal && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">{editing ? 'Edit Time Slot' : 'Add Time Slot'}</div>
              <button className="modal-close" onClick={closeModal}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Service Name *</label>
                <input
                  className="form-input"
                  placeholder="e.g. General Consultation"
                  value={form.serviceName}
                  style={{ border: formErrors.serviceName ? '1px solid #DC2626' : undefined }}
                  onChange={(e) => handleFieldChange('serviceName', e.target.value)}
                />
                {formErrors.serviceName && (
                  <div style={{ color: '#DC2626', fontSize: 12, marginTop: 4 }}>
                    {formErrors.serviceName}
                  </div>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">Day of Week</label>
                <select
                  className="form-select"
                  value={form.dayOfWeek}
                  onChange={(e) => handleFieldChange('dayOfWeek', Number(e.target.value))}
                >
                  {DAYS.map((d, idx) => (
                    <option key={d} value={idx}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div className="form-group">
                  <label className="form-label">Start Time</label>
                  <select
                    className="form-select"
                    value={form.startTime}
                    onChange={(e) => handleFieldChange('startTime', e.target.value)}
                  >
                    {TIME_OPTIONS.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">End Time</label>
                  <select
                    className="form-select"
                    value={form.endTime}
                    style={{ border: formErrors.endTime ? '1px solid #DC2626' : undefined }}
                    onChange={(e) => handleFieldChange('endTime', e.target.value)}
                  >
                    {TIME_OPTIONS.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  {formErrors.endTime && (
                    <div style={{ color: '#DC2626', fontSize: 12, marginTop: 4 }}>
                      {formErrors.endTime}
                    </div>
                  )}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Max Patients per Slot</label>
                <input
                  className="form-input"
                  type="number"
                  min="1"
                  max="50"
                  value={form.maxPatients}
                  style={{ border: formErrors.maxPatients ? '1px solid #DC2626' : undefined }}
                  onChange={(e) => handleFieldChange('maxPatients', Number(e.target.value))}
                />
                {formErrors.maxPatients && (
                  <div style={{ color: '#DC2626', fontSize: 12, marginTop: 4 }}>
                    {formErrors.maxPatients}
                  </div>
                )}
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn btn-outline" onClick={closeModal}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Slot'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
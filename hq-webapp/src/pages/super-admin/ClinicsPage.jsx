import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { clinicsApi } from '../../services/api'
import styles from './super-admin.module.css'

const STATUS_BADGE = {
  active: 'badge-green',
  inactive: 'badge-gray',
  maintenance: 'badge-warn',
}

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'maintenance', label: 'Maintenance' },
]

const EMPTY_FORM = {
  name: '',
  address: '',
  city: '',
  province: '',
  contactNumber: '',
  email: '',
  operatingHours: '8:00 AM - 5:00 PM',
  maxQueueCapacity: 60,
  acceptsWalkIn: true,
  acceptsAppointment: true,
  status: 'active',
}

export default function ClinicsPage() {
  const [clinics, setClinics] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formErrors, setFormErrors] = useState({})
  const [search, setSearch] = useState('')
  const [toast, setToast] = useState('')
  const [deletingId, setDeletingId] = useState(null)
  const [saving, setSaving] = useState(false)

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
  const loadClinics = useCallback(async () => {
    setLoading(true)
    try {
      const res = await clinicsApi.list()
      setClinics(Array.isArray(res?.data) ? res.data : [])
    } catch {
      showToast('Failed to load clinics')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => {
    loadClinics()
  }, [loadClinics])

  // ─── Modal & Form Handlers ───────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setFormErrors({})
    setShowModal(true)
  }

  const openEdit = (clinic) => {
    setEditing(clinic)
    setForm({
      name: clinic.name || '',
      address: clinic.address || '',
      city: clinic.city || '',
      province: clinic.province || '',
      contactNumber: clinic.contactNumber || '',
      email: clinic.email || '',
      operatingHours: clinic.operatingHours || '8:00 AM - 5:00 PM',
      maxQueueCapacity: clinic.maxQueueCapacity ?? 60,
      acceptsWalkIn: clinic.acceptsWalkIn ?? true,
      acceptsAppointment: clinic.acceptsAppointment ?? true,
      status: clinic.status || 'active',
    })
    setFormErrors({})
    setShowModal(true)
  }

  const closeModal = () => {
    setShowModal(false)
    setEditing(null)
    setForm(EMPTY_FORM)
    setFormErrors({})
  }

  const handleFieldChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }))
    if (formErrors[field]) {
      setFormErrors((prev) => ({ ...prev, [field]: '' }))
    }
  }

  // ─── Mutations ───────────────────────────────────────────────────────────────
  const handleSave = async () => {
    const errors = {}
    if (!form.name.trim()) errors.name = 'Clinic name is required'
    if (!form.address.trim()) errors.address = 'Address is required'
    if (!form.city.trim()) errors.city = 'City is required'

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors)
      return
    }

    setSaving(true)
    try {
      const payload = {
        ...form,
        name: form.name.trim(),
        address: form.address.trim(),
        city: form.city.trim(),
        maxQueueCapacity: Number(form.maxQueueCapacity) || 60,
      }

      if (editing?._id) {
        await clinicsApi.update(editing._id, payload)
        showToast('Clinic updated successfully')
      } else {
        await clinicsApi.create(payload)
        showToast('Clinic created successfully')
      }

      closeModal()
      await loadClinics()
    } catch (e) {
      showToast(e?.response?.data?.message || 'Failed to save clinic')
    } finally {
      setSaving(false)
    }
  }

  const handleRemove = async (id) => {
    try {
      await clinicsApi.delete(id)
      showToast('Clinic removed')
      setDeletingId(null)
      await loadClinics()
    } catch (e) {
      showToast(e?.response?.data?.message || 'Failed to remove clinic')
    }
  }

  // ─── Memoized Selectors ───────────────────────────────────────────────────────
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

  const totalActive = useMemo(() => {
    return clinics.filter((c) => c.status === 'active').length
  }, [clinics])

  return (
    <div className={styles.page}>
      {toast && <div className={styles.toast}>{toast}</div>}

      {/* Header */}
      <div className={styles.header}>
        <div>
          <div className={styles.title}>Clinic Management</div>
          <div className={styles.sub}>Manage all registered health facilities on the platform</div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={openCreate}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add Clinic
        </button>
      </div>

      {/* Stats Cards */}
      <div className={styles.statsRow}>
        <div className={`card ${styles.statCard}`}>
          <div className={styles.statLabel}>Total Clinics</div>
          <div className={styles.statValue}>{clinics.length}</div>
        </div>
        <div className={`card ${styles.statCard}`}>
          <div className={styles.statLabel}>Active</div>
          <div className={styles.statValue} style={{ color: '#16A34A' }}>
            {totalActive}
          </div>
        </div>
        <div className={`card ${styles.statCard}`}>
          <div className={styles.statLabel}>Inactive</div>
          <div className={styles.statValue} style={{ color: '#6B7280' }}>
            {clinics.length - totalActive}
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className={styles.toolbar}>
        <div className="search-bar" style={{ flex: 1, maxWidth: 320 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            placeholder="Search clinic name or city..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button className="btn btn-outline btn-sm" onClick={loadClinics} disabled={loading}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
          Refresh
        </button>
      </div>

      {/* Clinics Table */}
      <div className="card">
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading clinics…</div>
        ) : (
          <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Clinic Name</th>
                  <th>Location</th>
                  <th>Contact</th>
                  <th>Capacity</th>
                  <th>Walk-in</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredClinics.length === 0 ? (
                  <tr>
                    <td colSpan="7" style={{ textAlign: 'center', padding: 32, color: 'var(--muted)' }}>
                      No clinics found
                    </td>
                  </tr>
                ) : (
                  filteredClinics.map((c) => (
                    <tr key={c._id}>
                      <td>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{c.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{c.email || '—'}</div>
                      </td>
                      <td style={{ fontSize: 13 }}>
                        {c.city}
                        {c.province ? `, ${c.province}` : ''}
                      </td>
                      <td style={{ fontSize: 13 }}>{c.contactNumber || '—'}</td>
                      <td style={{ fontSize: 13 }}>{c.maxQueueCapacity || 60} patients</td>
                      <td>
                        <span className={`badge ${c.acceptsWalkIn ? 'badge-green' : 'badge-gray'}`}>
                          {c.acceptsWalkIn ? 'Yes' : 'No'}
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${STATUS_BADGE[c.status] || 'badge-gray'}`}>
                          {c.status || 'active'}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn btn-outline btn-sm" onClick={() => openEdit(c)}>
                            Edit
                          </button>
                          <button
                            className="btn btn-sm"
                            style={{ background: 'var(--error-lt)', color: 'var(--error)' }}
                            onClick={() => setDeletingId(c._id)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {deletingId && (
        <div className="modal-overlay" onClick={() => setDeletingId(null)}>
          <div className="modal" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Confirm Delete</div>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 14, color: 'var(--text-2)' }}>
                Are you sure you want to remove this clinic? This action cannot be undone.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setDeletingId(null)}>
                Cancel
              </button>
              <button
                className="btn btn-sm"
                style={{ background: 'var(--error)', color: '#fff' }}
                onClick={() => handleRemove(deletingId)}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create / Edit Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">{editing ? 'Edit Clinic' : 'Add New Clinic'}</div>
              <button className="modal-close" onClick={closeModal}>
                ×
              </button>
            </div>
            <div className="modal-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
              <div style={{ gridColumn: '1/-1' }}>
                <FormField
                  label="Clinic Name *"
                  value={form.name}
                  error={formErrors.name}
                  onChange={(val) => handleFieldChange('name', val)}
                />
              </div>

              <FormField
                label="Address *"
                value={form.address}
                error={formErrors.address}
                onChange={(val) => handleFieldChange('address', val)}
              />

              <FormField
                label="City *"
                value={form.city}
                error={formErrors.city}
                onChange={(val) => handleFieldChange('city', val)}
              />

              <FormField
                label="Province"
                value={form.province}
                onChange={(val) => handleFieldChange('province', val)}
              />

              <FormField
                label="Contact Number"
                value={form.contactNumber}
                onChange={(val) => handleFieldChange('contactNumber', val)}
              />

              <FormField
                label="Email"
                type="email"
                value={form.email}
                onChange={(val) => handleFieldChange('email', val)}
              />

              <FormField
                label="Operating Hours"
                value={form.operatingHours}
                onChange={(val) => handleFieldChange('operatingHours', val)}
              />

              <FormField
                label="Max Queue Capacity"
                type="number"
                value={form.maxQueueCapacity}
                onChange={(val) => handleFieldChange('maxQueueCapacity', Number(val))}
              />

              <SelectField
                label="Status"
                value={form.status}
                options={STATUS_OPTIONS}
                onChange={(val) => handleFieldChange('status', val)}
              />

              <div className="form-group">
                <label className="form-label">Accepts Walk-in</label>
                <Toggle
                  value={!!form.acceptsWalkIn}
                  onChange={(val) => handleFieldChange('acceptsWalkIn', val)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Accepts Appointments</label>
                <Toggle
                  value={!!form.acceptsAppointment}
                  onChange={(val) => handleFieldChange('acceptsAppointment', val)}
                />
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn btn-outline" onClick={closeModal}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Clinic'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function FormField({ label, type = 'text', value, error, onChange }) {
  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <input
        className="form-input"
        type={type}
        value={value ?? ''}
        style={{ border: error ? '1px solid #DC2626' : undefined }}
        onChange={(e) => onChange(e.target.value)}
      />
      {error && (
        <div style={{ color: '#DC2626', fontSize: 12, marginTop: 4, fontWeight: 500 }}>
          {error}
        </div>
      )}
    </div>
  )
}

function SelectField({ label, value, options, onChange }) {
  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <select className="form-select" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value ?? o} value={o.value ?? o}>
            {o.label ?? o}
          </option>
        ))}
      </select>
    </div>
  )
}

function Toggle({ value, onChange }) {
  return (
    <button
      type="button"
      style={{
        width: 44,
        height: 24,
        borderRadius: 99,
        background: value ? '#2563EB' : 'var(--border)',
        border: 'none',
        cursor: 'pointer',
        position: 'relative',
        marginTop: 4,
        display: 'block',
      }}
      onClick={() => onChange(!value)}
    >
      <span
        style={{
          position: 'absolute',
          top: 3,
          left: value ? 22 : 3,
          width: 18,
          height: 18,
          background: '#fff',
          borderRadius: '50%',
          transition: 'left .2s',
          display: 'block',
          boxShadow: '0 1px 3px rgba(0,0,0,.2)',
        }}
      />
    </button>
  )
}
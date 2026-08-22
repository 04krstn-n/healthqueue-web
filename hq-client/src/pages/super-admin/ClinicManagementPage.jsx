import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { clinicsApi } from '../../services/api'
import styles from './super-admin.module.css'

const STATUS_BADGE = {
  open: 'badge-green',
  active: 'badge-green',
  busy: 'badge-warn',
  closed: 'badge-gray',
  maintenance: 'badge-warn',
  inactive: 'badge-gray',
}

const FACILITY_TYPES = [
  'City Health Center',
  'Rural Health Unit',
  'Barangay Health Center',
  'Government Hospital',
  'Private Clinic',
  'Lying-in Clinic',
]

const STATUS_OPTIONS = ['Open', 'Closed', 'Maintenance', 'Active', 'Inactive']

const EMPTY_FORM = {
  name: '',
  city: '',
  address: '',
  province: '',
  region: 'NCR',
  contactNumber: '',
  email: '',
  operatingHours: '8:00 AM - 5:00 PM',
  maxQueueCapacity: 60,
  acceptsWalkIn: true,
  acceptsAppointment: true,
  status: 'Open',
  facilityType: 'City Health Center',
  services: [],
}

export default function ClinicManagementPage() {
  const [clinics, setClinics] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  const [modal, setModal] = useState(null) // null | 'add' | 'edit' | 'view'
  const [selected, setSelected] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formErrors, setFormErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [toast, setToast] = useState('')

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
      showToast('Failed to load clinic list')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => {
    loadClinics()
  }, [loadClinics])

  // ─── Modal & Form Handlers ───────────────────────────────────────────────────
  const openAdd = () => {
    setSelected(null)
    setForm(EMPTY_FORM)
    setFormErrors({})
    setModal('add')
  }

  const openEdit = (clinic) => {
    setSelected(clinic)
    setForm({
      name: clinic.name || '',
      city: clinic.city || '',
      address: clinic.address || '',
      province: clinic.province || '',
      region: clinic.region || 'NCR',
      contactNumber: clinic.contactNumber || '',
      email: clinic.email || '',
      operatingHours: clinic.operatingHours || '8:00 AM - 5:00 PM',
      maxQueueCapacity: clinic.maxQueueCapacity || 60,
      acceptsWalkIn: clinic.acceptsWalkIn ?? true,
      acceptsAppointment: clinic.acceptsAppointment ?? true,
      status: clinic.status || 'Open',
      facilityType: clinic.facilityType || 'City Health Center',
      services: clinic.services || [],
    })
    setFormErrors({})
    setModal('edit')
  }

  const openView = (clinic) => {
    setSelected(clinic)
    setModal('view')
  }

  const closeModal = () => {
    setModal(null)
    setSelected(null)
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
    if (!form.name.trim()) {
      errors.name = 'Clinic name is required'
    }
    if (!form.city.trim()) {
      errors.city = 'City is required'
    }
    if (form.contactNumber && !/^\d{11}$/.test(form.contactNumber)) {
      errors.contactNumber = 'Contact number must contain exactly 11 digits'
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors)
      return
    }

    setSaving(true)
    try {
      const payload = {
        ...form,
        name: form.name.trim(),
        city: form.city.trim(),
        maxQueueCapacity: Number(form.maxQueueCapacity) || 60,
      }

      if (modal === 'edit' && selected?._id) {
        await clinicsApi.update(selected._id, payload)
        showToast('Clinic updated successfully')
      } else {
        await clinicsApi.create(payload)
        showToast('Clinic added to the system')
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
      showToast('Clinic removed successfully')
      setDeletingId(null)
      await loadClinics()
    } catch (e) {
      showToast(e?.response?.data?.message || 'Cannot delete clinic with existing records')
    }
  }

  // ─── Memoized Selectors & Stats ──────────────────────────────────────────────
  const { filteredClinics, activeCount, totalServicesCount } = useMemo(() => {
    const query = search.trim().toLowerCase()
    const filtered = clinics.filter((c) => {
      const matchStatus = statusFilter === 'all' || c.status === statusFilter
      const matchSearch =
        !query ||
        c.name?.toLowerCase().includes(query) ||
        c.city?.toLowerCase().includes(query) ||
        c.province?.toLowerCase().includes(query)

      return matchStatus && matchSearch
    })

    const activeCount = clinics.filter((c) => ['active', 'open'].includes(c.status)).length
    const totalServicesCount = clinics.reduce((acc, c) => acc + (c.services?.length || 0), 0)

    return {
      filteredClinics: filtered,
      activeCount,
      totalServicesCount,
    }
  }, [clinics, search, statusFilter])

  return (
    <div className={styles.page}>
      {toast && <div className={styles.toast}>{toast}</div>}

      {/* Header & Controls */}
      <div className={styles.header}>
        <div>
          <div className={styles.title}>Clinic Management</div>
          <div className={styles.sub}>Manage all registered health facilities</div>
        </div>
        <div className={styles.toolbar}>
          <input
            className="form-input"
            style={{ width: 200 }}
            placeholder="Search clinics, city…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="form-select"
            style={{ width: 130 }}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All Status</option>
            <option value="open">Open</option>
            <option value="active">Active</option>
            <option value="closed">Closed</option>
            <option value="maintenance">Maintenance</option>
            <option value="inactive">Inactive</option>
          </select>
          <button className="btn btn-primary" onClick={openAdd}>
            + Add Clinic
          </button>
        </div>
      </div>

      {/* KPI Stats */}
      <div className={styles.statsRow} style={{ gridTemplateColumns: 'repeat(3,1fr)', marginBottom: 20 }}>
        <div className={`card ${styles.statCard}`}>
          <div className={styles.statLabel}>Total Clinics</div>
          <div className={styles.statValue}>{clinics.length}</div>
        </div>
        <div className={`card ${styles.statCard}`}>
          <div className={styles.statLabel}>Active / Open</div>
          <div className={styles.statValue} style={{ color: '#16A34A' }}>
            {activeCount}
          </div>
        </div>
        <div className={`card ${styles.statCard}`}>
          <div className={styles.statLabel}>Total Services</div>
          <div className={styles.statValue}>{totalServicesCount}</div>
        </div>
      </div>

      {/* Clinic Cards Grid */}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading clinics…</div>
      ) : filteredClinics.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>No clinics found.</div>
      ) : (
        <div className={styles.clinicGrid}>
          {filteredClinics.map((c) => (
            <div key={c._id} className={`card ${styles.clinicCard}`}>
              <div className={styles.clinicHead}>
                <div>
                  <div className={styles.clinicName}>{c.name}</div>
                  <div className={styles.clinicMeta}>
                    <span>{c.facilityType || 'Health Clinic'}</span>
                    <span>
                      {c.city || '—'}, {c.province || '—'}
                    </span>
                    {c.contactNumber && <span>{c.contactNumber}</span>}
                    {c.operatingHours && <span>{c.operatingHours}</span>}
                  </div>
                </div>
                <span className={`badge ${STATUS_BADGE[c.status] || 'badge-gray'}`}>{c.status}</span>
              </div>

              {/* Services Tags */}
              {(c.services || []).length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
                  {c.services.slice(0, 4).map((s, idx) => (
                    <span key={idx} className="badge badge-blue" style={{ fontSize: 10 }}>
                      {typeof s === 'string' ? s : s.name}
                    </span>
                  ))}
                  {c.services.length > 4 && (
                    <span className="badge badge-gray" style={{ fontSize: 10 }}>
                      +{c.services.length - 4} more
                    </span>
                  )}
                </div>
              )}

              {/* Quick Specs */}
              <div className={styles.clinicStats} style={{ marginTop: 12 }}>
                <div className={styles.cStat}>
                  <div className={styles.cStatVal}>{c.services?.length || 0}</div>
                  <div className={styles.cStatLbl}>Services</div>
                </div>
                <div className={styles.cStat}>
                  <div className={styles.cStatVal}>{c.maxQueueCapacity || 60}</div>
                  <div className={styles.cStatLbl}>Max Queue</div>
                </div>
                <div className={styles.cStat}>
                  <div className={styles.cStatVal}>{c.acceptsWalkIn ? 'Yes' : 'No'}</div>
                  <div className={styles.cStatLbl}>Walk-in</div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className={styles.clinicActions} style={{ marginTop: 12 }}>
                <button className="btn btn-outline" style={{ flex: 0, fontSize: 12, padding: '6px 50px',
                  }} onClick={() => openView(c)}>
                  View
                </button>
                <button className="btn btn-outline" style={{  flex: 0, fontSize: 12, padding: '6px 50px', }} 
                onClick={() => openEdit(c)}>
                  Edit
                </button>
                <button
                  className="btn"
                  style={{
                    flex: 0,
                    fontSize: 12,
                    padding: '6px 50px',
                    color: 'var(--error)',
                    background: 'var(--error-lt)',
                    border: 'none',
                  }}
                  onClick={() => setDeletingId(c._id)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── ADD / EDIT MODAL ── */}
      {(modal === 'add' || modal === 'edit') && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">{modal === 'edit' ? 'Edit Clinic' : 'Add New Clinic'}</span>
              <button className="modal-close" onClick={closeModal}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div className={styles.formGrid2}>
                <FormField
                  label={<> Clinic Name <span style={{ color: 'var(--error)' }}>*</span> </>}
                  value={form.name}
                  error={formErrors.name}
                  onChange={(val) => handleFieldChange('name', val)}
                />

                <SelectField
                  label="Facility Type"
                  value={form.facilityType}
                  options={FACILITY_TYPES}
                  onChange={(val) => handleFieldChange('facilityType', val)}
                />

                <FormField
                  label="Address"
                  value={form.address}
                  onChange={(val) => handleFieldChange('address', val)}
                />

                <FormField
                  label={<> City <span style={{ color: 'var(--error)' }}>*</span> </>}
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
                  label="Region"
                  value={form.region}
                  onChange={(val) => handleFieldChange('region', val)}
                />

                <FormField
                  label="Contact Number"
                  type="tel"
                  inputMode="numeric"
                  maxLength={11}
                  value={form.contactNumber}
                  error={formErrors.contactNumber}
                  onChange={(val) => handleFieldChange('contactNumber', val.replace(/\D/g, '').slice(0, 11))}
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
              </div>

              <div className={styles.formGrid2} style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Toggle
                    value={!!form.acceptsWalkIn}
                    onChange={(val) => handleFieldChange('acceptsWalkIn', val)}
                  />
                  <span style={{ fontSize: 13, color: 'var(--text-2)' }}>Accepts Walk-in</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Toggle
                    value={!!form.acceptsAppointment}
                    onChange={(val) => handleFieldChange('acceptsAppointment', val)}
                  />
                  <span style={{ fontSize: 13, color: 'var(--text-2)' }}>Accepts Appointment</span>
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn btn-outline" onClick={closeModal}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : modal === 'edit' ? 'Save Changes' : 'Add Clinic'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── VIEW MODAL ── */}
      {modal === 'view' && selected && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">{selected.name}</span>
              <button className="modal-close" onClick={closeModal}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              <p><strong>Type:</strong> {selected.facilityType || '—'}</p>
              <p><strong>Address:</strong> {selected.address || '—'}</p>
              <p><strong>City/Province:</strong> {selected.city || '—'}, {selected.province || '—'}</p>
              <p><strong>Contact:</strong> {selected.contactNumber || '—'}</p>
              <p><strong>Hours:</strong> {selected.operatingHours || '—'}</p>
              <p>
                <strong>Status:</strong>{' '}
                <span className={`badge ${STATUS_BADGE[selected.status] || 'badge-gray'}`}>
                  {selected.status}
                </span>
              </p>
              <p><strong>Max Queue:</strong> {selected.maxQueueCapacity || 60}</p>
              <p>
                <strong>Walk-in:</strong> {selected.acceptsWalkIn ? 'Yes' : 'No'} &nbsp;
                <strong>Appointment:</strong> {selected.acceptsAppointment ? 'Yes' : 'No'}
              </p>

              <div style={{ marginTop: 12 }}>
                <strong>Services ({(selected.services || []).length}):</strong>
                {(selected.services || []).length === 0 ? (
                  <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>No services listed.</p>
                ) : (
                  <ul style={{ marginTop: 6, paddingLeft: 18 }}>
                    {selected.services.map((s, i) => (
                      <li key={i} style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 3 }}>
                        {typeof s === 'string'
                          ? s
                          : `${s.name}${s.durationMinutes ? ` (${s.durationMinutes} min)` : ''}`}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={closeModal}>
                Close
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  const item = selected
                  closeModal()
                  openEdit(item)
                }}
              >
                Edit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── DELETE CONFIRMATION MODAL ── */}
      {deletingId && (
        <div className="modal-overlay" onClick={() => setDeletingId(null)}>
          <div className="modal" style={{ maxWidth: 360 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Confirm Delete</span>
            </div>
            <div className="modal-body">
              <p>Are you sure you want to remove this clinic? This action cannot be undone.</p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setDeletingId(null)}>
                Cancel
              </button>
              <button
                className="btn"
                style={{ background: 'var(--error)', color: '#fff', border: 'none' }}
                onClick={() => handleRemove(deletingId)}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function FormField({ label, type = 'text', inputMode, maxLength, value, error, onChange }) {
  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <input
        className="form-input"
        type={type}
        inputMode={inputMode}
        maxLength={maxLength}
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

function SelectField({ label, value, options, onChange }) {
  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <select className="form-select" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  )
}
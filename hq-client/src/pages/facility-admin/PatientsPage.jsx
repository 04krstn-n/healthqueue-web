import { useState, useEffect, useCallback, useMemo } from 'react'
import { patientsApi } from '../../services/api'
import styles from './facility-admin.module.css'

const PER_PAGE = 10
const FILTER_TYPES = ['All', 'Regular', 'Senior Citizen', 'PWD', 'Pregnant', 'Priority']
const GENDERS = ['Male', 'Female', 'Other']
const BLOOD_TYPES = ['', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'Unknown']
const PATIENT_TYPES = ['Regular', 'Senior Citizen', 'PWD', 'Pregnant', 'Priority']

const TYPE_BADGES = {
  Regular: 'badge-blue',
  'Senior Citizen': 'badge-orange',
  PWD: 'badge-purple',
  Pregnant: 'badge-teal',
  Priority: 'badge-red',
}

const GENDER_BADGES = {
  Male: 'badge-blue',
  Female: 'badge-teal',
  Other: 'badge-gray',
}

const EMPTY_FORM = {
  fullName: '',
  email: '',
  phone: '',
  dateOfBirth: '',
  gender: 'Male',
  address: '',
  patientType: 'Regular',
  philHealthNumber: '',
  hmoProvider: '',
  bloodType: '',
  allergies: '',
  medicalNotes: '',
}

export default function PatientsPage() {
  const [patients, setPatients] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('All')
  const [page, setPage] = useState(1)

  const [modal, setModal] = useState(null) // null | 'add' | 'edit' | 'view'
  const [selected, setSelected] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formErrors, setFormErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [listView, setListView] = useState('active') // 'active' | 'deactivated'
  const [deactivateTarget, setDeactivateTarget] = useState(null)
  const [deactivating, setDeactivating] = useState(false)
  const [reactivating, setReactivating] = useState(false)

  const showToast = useCallback((message) => {
    setToast(message)
    setTimeout(() => setToast(''), 3000)
  }, [])

  // ─── Data Fetching ───────────────────────────────────────────────────────────
  const loadPatients = useCallback(async () => {
    setLoading(true)
    try {
      const res = await patientsApi.list()
      setPatients(Array.isArray(res?.data) ? res.data : [])
    } catch {
      setPatients([])
      showToast('Failed to load patients list')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => {
    loadPatients()
  }, [loadPatients])

  // ─── Modal & Form Handlers ───────────────────────────────────────────────────
  const openAdd = () => {
    setSelected(null)
    setForm(EMPTY_FORM)
    setFormErrors({})
    setModal('add')
  }

  const openView = (patient) => {
    setSelected(patient)
    setModal('view')
  }

  const openEdit = (p) => {
    setSelected(p)
    setForm({
      fullName: p.fullName || '',
      email: p.email || '',
      phone: p.phone || '',
      dateOfBirth: p.dateOfBirth ? new Date(p.dateOfBirth).toISOString().slice(0, 10) : '',
      gender: p.gender || 'Male',
      address: p.address || '',
      patientType: p.patientType || 'Regular',
      philHealthNumber: p.philHealthNumber || '',
      hmoProvider: p.hmoProvider || '',
      bloodType: p.bloodType || '',
      allergies: p.allergies || '',
      medicalNotes: p.medicalNotes || '',
    })
    setFormErrors({})
    setModal('edit')
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
    if (!form.fullName.trim()) {
      errors.fullName = 'Full name is required'
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors)
      return
    }

    setSaving(true)
    try {
      if (modal === 'edit' && selected?._id) {
        await patientsApi.update(selected._id, form)
        showToast('Patient updated successfully')
      } else {
        await patientsApi.create(form)
        showToast('Patient added successfully')
      }
      closeModal()
      loadPatients()
    } catch (e) {
      showToast(e?.response?.data?.message || 'Failed to save patient record')
    } finally {
      setSaving(false)
    }
  }

  const handleReactivate = async (p) => {
    setReactivating(true)
    try {
      await patientsApi.update(p._id, { isActive: true })
      showToast('Patient reactivated')
      loadPatients()
    } catch (e) {
      showToast(e?.response?.data?.message || 'Failed to reactivate patient')
    } finally {
      setReactivating(false)
    }
  }

  const handleExportCSV = () => {
    const rows = [
      ['Name', 'Type', 'Gender', 'Phone', 'Email', 'PhilHealth', 'Blood Type', 'Last Updated'],
    ]
    filteredPatients.forEach((p) =>
      rows.push([
        p.fullName,
        p.patientType || 'Regular',
        p.gender || '',
        p.phone || '',
        p.email || '',
        p.philHealthNumber || '',
        p.bloodType || '',
        p.updatedAt ? new Date(p.updatedAt).toLocaleDateString('en-PH') : '',
      ])
    )
    const csv = rows
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `patients_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    showToast('Exported to CSV')
  }

  // ─── Filter & Pagination Calculations ────────────────────────────────────────
  const filteredPatients = useMemo(() => {
    const q = search.trim().toLowerCase()

    return patients.filter((p) => {
      const matchView = listView === 'active' ? p.isActive !== false : p.isActive === false
      const matchType = typeFilter === 'All' || p.patientType === typeFilter
      const matchSearch =
        !q ||
        p.fullName?.toLowerCase().includes(q) ||
        p.phone?.toLowerCase().includes(q) ||
        p.email?.toLowerCase().includes(q) ||
        p.philHealthNumber?.toLowerCase().includes(q)

      return matchView && matchType && matchSearch
    })
  }, [patients, search, typeFilter, listView])

  const activeCount = useMemo(() => patients.filter((p) => p.isActive !== false).length, [patients])
  const inactiveCount = useMemo(() => patients.filter((p) => p.isActive === false).length, [patients])

  const pageCount = Math.max(1, Math.ceil(filteredPatients.length / PER_PAGE))
  const paginatedPatients = useMemo(() => {
    return filteredPatients.slice((page - 1) * PER_PAGE, page * PER_PAGE)
  }, [filteredPatients, page])

  return (
    <div className={styles.page}>
      {toast && <div className={styles.toast}>{toast}</div>}

      {/* Active / Deactivated View Toggle */}
      <div
        style={{
          display: 'flex',
          background: 'var(--bg-2)',
          borderRadius: 8,
          padding: 3,
          gap: 0,
          width: 'fit-content',
          marginBottom: 12,
        }}
      >
        {[
          ['active', `Active Patients (${activeCount})`],
          ['deactivated', `Deactivated Patients (${inactiveCount})`],
        ].map(([v, label]) => (
          <button
            key={v}
            onClick={() => {
              setListView(v)
              setPage(1)
            }}
            style={{
              padding: '7px 16px',
              borderRadius: 6,
              border: 'none',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
              background: listView === v ? 'var(--primary)' : 'transparent',
              color: listView === v ? '#fff' : 'var(--text-2)',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="card">
        {/* Header */}
        <div
          className={styles.header}
          style={{ padding: '20px 24px', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <div>
            <div className={styles.title}>Patient Records</div>
            <div className={styles.sub}>{patients.length} total patients</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 4 }}>
            <button className="btn btn-outline" onClick={handleExportCSV}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Export CSV
            </button>
            <button className="btn btn-primary" onClick={openAdd}>
              + Add Patient
            </button>
          </div>
        </div>

        {/* Filters */}
        <div
          className={styles.toolbar}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '16px 24px 20px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <input
            className="form-input"
            style={{ flex: 1, minWidth: 0 }}
            placeholder="Search name, phone, email, PhilHealth…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
          />

          <select
            className="form-select"
            style={{ width: 180, flexShrink: 0 }}
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value)
              setPage(1)
            }}
          >
            {FILTER_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>

          <button
            className="btn btn-outline"
            style={{ flexShrink: 0, whiteSpace: 'nowrap' }}
            onClick={loadPatients}
            disabled={loading}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            Refresh
          </button>
        </div>

        {/* Table */}
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Gender</th>
              <th>Phone</th>
              <th>PhilHealth #</th>
              <th>Blood Type</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: 32, color: 'var(--muted)' }}>
                  Loading patient records…
                </td>
              </tr>
            ) : paginatedPatients.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: 32, color: 'var(--muted)' }}>
                  {listView === 'active' ? 'No active patients found.' : 'No deactivated patients found.'}
                </td>
              </tr>
            ) : (
              paginatedPatients.map((p) => (
                <tr key={p._id}>
                  <td>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{p.fullName}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{p.email || '—'}</div>
                  </td>
                  <td>
                    <span className={`badge ${TYPE_BADGES[p.patientType] || 'badge-gray'}`}>
                      {p.patientType || 'Regular'}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${GENDER_BADGES[p.gender] || 'badge-gray'}`}>
                      {p.gender || '—'}
                    </span>
                  </td>
                  <td style={{ fontSize: 13 }}>{p.phone || '—'}</td>
                  <td style={{ fontSize: 13 }}>{p.philHealthNumber || '—'}</td>
                  <td style={{ fontSize: 13 }}>{p.bloodType || '—'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        className="btn btn-outline btn-sm"
                        title="View"
                        onClick={() => openView(p)}
                        style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                      >
                        View
                      </button>
                      <button
                        className="btn btn-outline btn-sm"
                        title="Edit"
                        onClick={() => openEdit(p)}
                        style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                      >
                        Edit
                      </button>
                      {p.isActive === false ? (
                        <button
                          className="btn btn-outline btn-sm"
                          title="Reactivate"
                          onClick={() => handleReactivate(p)}
                          disabled={reactivating}
                          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                        >
                          {reactivating ? 'Reactivating…' : 'Reactivate'}
                        </button>
                      ) : (
                        <button
                          className="btn btn-sm"
                          style={{
                            background: 'var(--error-lt)',
                            color: 'var(--error)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                          }}
                          title="Deactivate"
                          onClick={() => setDeactivateTarget(p)}
                        >
                          Deactivate
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Pagination */}
        {pageCount > 1 && (
          <div
            className={styles.pagination}
            style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 8 }}
          >
            <button
              className="btn btn-outline"
              disabled={page === 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              ← Prev
            </button>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>
              Page {page} of {pageCount}
            </span>
            <button
              className="btn btn-outline"
              disabled={page === pageCount}
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            >
              Next →
            </button>
          </div>
        )}
      </div>

      {/* ── ADD / EDIT MODAL ── */}
      {(modal === 'add' || modal === 'edit') && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">{modal === 'edit' ? 'Edit Patient' : 'Add New Patient'}</span>
              <button className="modal-close" onClick={closeModal}>
                ✕
              </button>
            </div>
            <div className="modal-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <FormField
                label={ <> Full Name <span style={{ color: 'var(--error)' }}>*</span> </> }
                value={form.fullName}
                error={formErrors.fullName}
                onChange={(val) => handleFieldChange('fullName', val)}
              />
              <FormField
                label="Email Address"
                type="email"
                value={form.email}
                error={formErrors.email}
                onChange={(val) => handleFieldChange('email', val)}
              />
              <FormField
                  label="Phone Number"
                  type="tel"
                  inputMode="numeric"
                  maxLength={11}
                  value={form.phone}
                  error={formErrors.phone}
                  onChange={(val) => handleFieldChange('phone', val.replace(/\D/g, '').slice(0, 11))}
                />
                
              <FormField
                label="Date of Birth"
                type="date"
                value={form.dateOfBirth}
                error={formErrors.dateOfBirth}
                onChange={(val) => handleFieldChange('dateOfBirth', val)}
              />

              <SelectField
                label="Gender"
                value={form.gender}
                options={GENDERS}
                onChange={(val) => handleFieldChange('gender', val)}
              />
              <SelectField
                label="Patient Type"
                value={form.patientType}
                options={PATIENT_TYPES}
                onChange={(val) => handleFieldChange('patientType', val)}
              />
              <SelectField
                label="Blood Type"
                value={form.bloodType}
                options={BLOOD_TYPES}
                onChange={(val) => handleFieldChange('bloodType', val)}
              />

              <FormField
                label="PhilHealth #"
                value={form.philHealthNumber}
                error={formErrors.philHealthNumber}
                onChange={(val) => handleFieldChange('philHealthNumber', val)}
              />
              <FormField
                label="HMO Provider"
                value={form.hmoProvider}
                error={formErrors.hmoProvider}
                onChange={(val) => handleFieldChange('hmoProvider', val)}
              />

              <div className="form-group" style={{ gridColumn: '1/-1' }}>
                <label className="form-label">Address</label>
                <input
                  className="form-input"
                  value={form.address}
                  onChange={(e) => handleFieldChange('address', e.target.value)}
                />
              </div>

              <div className="form-group" style={{ gridColumn: '1/-1' }}>
                <label className="form-label">Allergies</label>
                <input
                  className="form-input"
                  value={form.allergies}
                  onChange={(e) => handleFieldChange('allergies', e.target.value)}
                />
              </div>

              <div className="form-group" style={{ gridColumn: '1/-1' }}>
                <label className="form-label">Medical Notes</label>
                <textarea
                  className="form-input"
                  rows={2}
                  value={form.medicalNotes}
                  onChange={(e) => handleFieldChange('medicalNotes', e.target.value)}
                />
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn btn-outline" onClick={closeModal}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : modal === 'edit' ? 'Save Changes' : 'Add Patient'}
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
              <span className="modal-title">{selected.fullName}</span>
              <button className="modal-close" onClick={closeModal}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 24px' }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>Patient Type</div>
                  <span className={`badge ${TYPE_BADGES[selected.patientType] || 'badge-gray'}`}>
                    {selected.patientType || 'Regular'}
                  </span>
                </div>

                <div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>Gender</div>
                  <span className={`badge ${GENDER_BADGES[selected.gender] || 'badge-gray'}`}>
                    {selected.gender || '—'}
                  </span>
                </div>

                <div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>Date of Birth</div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>
                    {selected.dateOfBirth ? new Date(selected.dateOfBirth).toLocaleDateString('en-PH') : '—'}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>Blood Type</div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>
                    {selected.bloodType || '—'}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>Phone</div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>
                    {selected.phone || '—'}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>Email</div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>
                    {selected.email || '—'}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>PhilHealth #</div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>
                    {selected.philHealthNumber || '—'}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>HMO Provider</div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>
                    {selected.hmoProvider || '—'}
                  </div>
                </div>

                {selected.address && (
                  <div style={{ gridColumn: '1/-1' }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>Address</div>
                    <div style={{ fontSize: 13, color: 'var(--text)' }}>{selected.address}</div>
                  </div>
                )}

                {selected.allergies && (
                  <div style={{ gridColumn: '1/-1' }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>Allergies</div>
                    <div style={{ fontSize: 13, color: 'var(--text)' }}>{selected.allergies}</div>
                  </div>
                )}

                {selected.medicalNotes && (
                  <div style={{ gridColumn: '1/-1' }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>Medical Notes</div>
                    <div style={{ fontSize: 13, color: 'var(--text)' }}>{selected.medicalNotes}</div>
                  </div>
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
                  const p = selected
                  closeModal()
                  openEdit(p)
                }}
              >
                Edit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── DEACTIVATE CONFIRMATION MODAL ── */}
      {deactivateTarget && (
        <div className="modal-overlay" onClick={() => setDeactivateTarget(null)}>
          <div className="modal" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Deactivate Patient</span>
              <button className="modal-close" onClick={() => setDeactivateTarget(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>
                Are you sure you want to deactivate{' '}
                <strong style={{ color: 'var(--text)' }}>{deactivateTarget.fullName}</strong>? Their record
                will be marked inactive.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setDeactivateTarget(null)}>Cancel</button>
              <button
                className="btn btn-sm"
                style={{ background: 'var(--error)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 6 }}
                onClick={() => handleDeactivate(deactivateTarget._id)}
                disabled={deactivating}
              >
                {deactivating ? 'Deactivating…' : 'Yes, Deactivate'}
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
        value={value || ''}
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
      <select className="form-select" value={value || ''} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o || '— select —'}
          </option>
        ))}
      </select>
    </div>
  )
}
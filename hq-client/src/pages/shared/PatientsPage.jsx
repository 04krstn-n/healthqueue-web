import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { patientsApi } from '../../services/api'
import styles from './PatientsPage.module.css'

const PER_PAGE = 10
const TYPES = ['all', 'Regular', 'Senior Citizen', 'PWD', 'Pregnant', 'Priority']
const GENDERS = ['Male', 'Female', 'Other']

const TYPE_BADGES = {
  Regular: 'badge-blue',
  'Senior Citizen': 'badge-orange',
  PWD: 'badge-purple',
  Pregnant: 'badge-teal',
  Priority: 'badge-red',
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
  bloodType: '',
  emergencyContact: {
    name: '',
    phone: '',
  },
}

export default function PatientsPage() {
  const [patients, setPatients] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [page, setPage] = useState(1)

  const [modal, setModal] = useState(null) // null | 'view' | 'add' | 'edit'
  const [selected, setSelected] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formErrors, setFormErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [listView, setListView] = useState('active') // 'active' | 'deactivated'
  const [deactivateTarget, setDeactivateTarget] = useState(null)
  const [deactivating, setDeactivating] = useState(false)
  const [reactivating, setReactivating] = useState(false)

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

  // ─── Data Fetching ───────────────────────────────────────────────────────────
  const loadPatients = useCallback(async () => {
    setLoading(true)
    try {
      const res = await patientsApi.list()
      setPatients(Array.isArray(res?.data) ? res.data : [])
    } catch {
      showToast('Failed to load patient records')
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

  const openEdit = (patient) => {
    setSelected(patient)
    setForm({
      fullName: patient.fullName || '',
      email: patient.email || '',
      phone: patient.phone || '',
      dateOfBirth: patient.dateOfBirth
        ? new Date(patient.dateOfBirth).toISOString().slice(0, 10)
        : '',
      gender: patient.gender || 'Male',
      address: patient.address || '',
      patientType: patient.patientType || 'Regular',
      philHealthNumber: patient.philHealthNumber || '',
      bloodType: patient.bloodType || '',
      emergencyContact: {
        name: patient.emergencyContact?.name || '',
        phone: patient.emergencyContact?.phone || '',
      },
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

  const handleFieldChange = (field, value, nestedKey = null) => {
    if (nestedKey) {
      setForm((prev) => ({
        ...prev,
        [nestedKey]: {
          ...prev[nestedKey],
          [field]: value,
        },
      }))
    } else {
      setForm((prev) => ({ ...prev, [field]: value }))
      if (formErrors[field]) {
        setFormErrors((prev) => ({ ...prev, [field]: '' }))
      }
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
      const payload = {
        ...form,
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
      }

      if (modal === 'edit' && selected?._id) {
        await patientsApi.update(selected._id, payload)
        showToast('Patient updated successfully')
      } else {
        await patientsApi.create(payload)
        showToast('Patient added successfully')
      }

      closeModal()
      await loadPatients()
    } catch (e) {
      showToast(e?.response?.data?.message || 'Failed to save patient record')
    } finally {
      setSaving(false)
    }
  }

  const handleDeactivate = async (id) => {
    setDeactivating(true)
    try {
      await patientsApi.deactivate(id)
      setDeactivateTarget(null)
      showToast('Patient deactivated')
      await loadPatients()
    } catch (e) {
      showToast(e?.response?.data?.message || 'Failed to deactivate patient')
    } finally {
      setDeactivating(false)
    }
  }

  const handleReactivate = async (patient) => {
    setReactivating(true)
    try {
      await patientsApi.update(patient._id, { isActive: true })
      showToast('Patient reactivated')
      await loadPatients()
    } catch (e) {
      showToast(e?.response?.data?.message || 'Failed to reactivate patient')
    } finally {
      setReactivating(false)
    }
  }

  const handleExportCSV = () => {
    const rows = [
      ['Name', 'Type', 'Gender', 'Phone', 'Email', 'PhilHealth #', 'Total Visits'],
    ]
    filteredPatients.forEach((p) =>
      rows.push([
        p.fullName,
        p.patientType || 'Regular',
        p.gender || '',
        p.phone || '',
        p.email || '',
        p.philHealthNumber || '',
        p.totalVisits || 0,
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

  // ─── Filtering & Pagination ──────────────────────────────────────────────────
  const filteredPatients = useMemo(() => {
    const query = search.trim().toLowerCase()
    return patients.filter((p) => {
      const matchView = listView === 'active' ? p.isActive !== false : p.isActive === false
      const matchType = typeFilter === 'all' || p.patientType === typeFilter
      const matchSearch =
        !query ||
        p.fullName?.toLowerCase().includes(query) ||
        p.phone?.includes(query) ||
        p.email?.toLowerCase().includes(query) ||
        p.philHealthNumber?.toLowerCase().includes(query)

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, position: 'relative' }}>
      {toast && (
        <div
          style={{
            position: 'fixed',
            top: 20,
            right: 24,
            zIndex: 9999,
            background: '#1F2937',
            color: '#fff',
            padding: '10px 18px',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          {toast}
        </div>
      )}

      {/* Active / Deactivated View Toggle */}
      <div
        style={{
          display: 'flex',
          background: 'var(--bg-2)',
          borderRadius: 8,
          padding: 3,
          gap: 0,
          width: 'fit-content',
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
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '18px 20px 0' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Patient Records</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              {patients.length} total patients
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-outline btn-sm" onClick={handleExportCSV}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Export CSV
            </button>
            <button className="btn btn-primary btn-sm" onClick={openAdd}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add Patient
            </button>
          </div>
        </div>

        {/* Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 20px', borderBottom: '1px solid var(--border-lt)' }}>
          <div className="search-bar" style={{ flex: 1, maxWidth: 320 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              placeholder="Search name, phone, email..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
            />
          </div>
          <select
            className="dropdown-select"
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value)
              setPage(1)
            }}
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t === 'all' ? 'All Types' : t}
              </option>
            ))}
          </select>
          <button className="btn btn-outline btn-sm" onClick={loadPatients} disabled={loading}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            Refresh
          </button>
        </div>

        {/* Patients Table */}
        <div className="table-wrap" style={{ borderRadius: 0, border: 'none' }}>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Gender</th>
                <th>Contact</th>
                <th>PhilHealth #</th>
                <th>Visits</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: 32, color: 'var(--muted)' }}>
                    Loading patients…
                  </td>
                </tr>
              ) : paginatedPatients.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: 32, color: 'var(--muted)' }}>
                    {listView === 'active' ? 'No active patients found' : 'No deactivated patients found'}
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
                    <td style={{ fontSize: 13 }}>{p.gender || '—'}</td>
                    <td style={{ fontSize: 13 }}>{p.phone || '—'}</td>
                    <td style={{ fontSize: 13 }}>{p.philHealthNumber || '—'}</td>
                    <td style={{ fontSize: 13 }}>{p.totalVisits || 0}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button
                          className="btn btn-icon btn-outline"
                          title="View"
                          onClick={() => openView(p)}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                        </button>
                        <button
                          className="btn btn-icon btn-outline"
                          title="Edit"
                          onClick={() => openEdit(p)}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </button>
                        {p.isActive === false ? (
                          <button
                            className="btn btn-icon btn-outline"
                            title="Reactivate"
                            onClick={() => handleReactivate(p)}
                            disabled={reactivating}
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="23 4 23 10 17 10" />
                              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                            </svg>
                          </button>
                        ) : (
                          <button
                            className="btn btn-icon"
                            style={{ background: 'var(--error-lt)', color: 'var(--error)' }}
                            title="Deactivate"
                            onClick={() => setDeactivateTarget(p)}
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <circle cx="12" cy="12" r="10" />
                              <line x1="15" y1="9" x2="9" y2="15" />
                              <line x1="9" y1="9" x2="15" y2="15" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pageCount > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center', padding: 14 }}>
            <button
              className="btn btn-outline btn-sm"
              disabled={page === 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              ← Prev
            </button>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>
              Page {page} of {pageCount}
            </span>
            <button
              className="btn btn-outline btn-sm"
              disabled={page === pageCount}
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            >
              Next →
            </button>
          </div>
        )}
      </div>

      {/* ── VIEW MODAL ── */}
      {modal === 'view' && selected && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Patient Profile</div>
              <button className="modal-close" onClick={closeModal}>×</button>
            </div>
            <div className="modal-body">
              {[
                ['Full Name', selected.fullName],
                ['Type', selected.patientType || 'Regular'],
                ['Gender', selected.gender || '—'],
                ['Date of Birth', selected.dateOfBirth ? new Date(selected.dateOfBirth).toLocaleDateString('en-PH') : '—'],
                ['Phone', selected.phone || '—'],
                ['Email', selected.email || '—'],
                ['Address', selected.address || '—'],
                ['PhilHealth #', selected.philHealthNumber || '—'],
                ['Blood Type', selected.bloodType || '—'],
                ['Total Visits', selected.totalVisits || 0],
              ].map(([label, val]) => (
                <div
                  key={label}
                  style={{ display: 'flex', padding: '8px 0', borderBottom: '1px solid var(--border-lt)', gap: 12 }}
                >
                  <div style={{ minWidth: 140, fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>
                    {label}
                  </div>
                  <div style={{ fontSize: 13 }}>{val}</div>
                </div>
              ))}
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={closeModal}>Close</button>
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

      {/* ── ADD / EDIT MODAL ── */}
      {(modal === 'add' || modal === 'edit') && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" style={{ maxWidth: 540 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">{modal === 'edit' ? 'Edit Patient' : 'Add New Patient'}</div>
              <button className="modal-close" onClick={closeModal}>×</button>
            </div>
            <div className="modal-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
              <div style={{ gridColumn: '1/-1' }}>
                <FormField
                  label="Full Name *"
                  value={form.fullName}
                  error={formErrors.fullName}
                  onChange={(val) => handleFieldChange('fullName', val)}
                />
              </div>

              <FormField
                label="Email"
                type="email"
                value={form.email}
                onChange={(val) => handleFieldChange('email', val)}
              />

              <FormField
                label="Phone"
                placeholder="09XXXXXXXXX"
                value={form.phone}
                onChange={(val) => handleFieldChange('phone', val)}
              />

              <FormField
                label="Date of Birth"
                type="date"
                value={form.dateOfBirth}
                onChange={(val) => handleFieldChange('dateOfBirth', val)}
              />

              <div className="form-group">
                <label className="form-label">Gender</label>
                <select
                  className="form-select"
                  value={form.gender}
                  onChange={(e) => handleFieldChange('gender', e.target.value)}
                >
                  {GENDERS.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group" style={{ gridColumn: '1/-1' }}>
                <label className="form-label">Patient Type</label>
                <select
                  className="form-select"
                  value={form.patientType}
                  onChange={(e) => handleFieldChange('patientType', e.target.value)}
                >
                  {TYPES.filter((t) => t !== 'all').map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ gridColumn: '1/-1' }}>
                <FormField
                  label="Address"
                  value={form.address}
                  onChange={(val) => handleFieldChange('address', val)}
                />
              </div>

              <FormField
                label="PhilHealth #"
                value={form.philHealthNumber}
                onChange={(val) => handleFieldChange('philHealthNumber', val)}
              />

              <FormField
                label="Blood Type"
                value={form.bloodType}
                onChange={(val) => handleFieldChange('bloodType', val)}
              />

              <FormField
                label="Emergency Contact Name"
                value={form.emergencyContact?.name}
                onChange={(val) => handleFieldChange('name', val, 'emergencyContact')}
              />

              <FormField
                label="Emergency Contact Phone"
                value={form.emergencyContact?.phone}
                onChange={(val) => handleFieldChange('phone', val, 'emergencyContact')}
              />
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={closeModal}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : modal === 'edit' ? 'Save Changes' : 'Add Patient'}
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
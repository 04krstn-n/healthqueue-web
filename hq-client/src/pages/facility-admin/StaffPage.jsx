import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { staffApi } from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import styles from './facility-admin.module.css'

const SPECIALIZATION_OPTIONS = [
  { value: 'Healthcare Staff', label: 'Healthcare Staff' },
  { value: 'Doctor', label: 'Doctor' },
  { value: 'Nurse', label: 'Nurse' },
  { value: 'Midwife', label: 'Midwife' },
  { value: 'Med Tech', label: 'Med Tech' },
  { value: 'Pharmacist', label: 'Pharmacist' },
  { value: 'Admin Staff', label: 'Admin Staff' },
]

const SPEC_BADGE = {
  'healthcare staff': 'badge-teal',
  doctor: 'badge-blue',
  nurse: 'badge-green',
  midwife: 'badge-teal',
  'med tech': 'badge-purple',
  med_tech: 'badge-purple',
  pharmacist: 'badge-orange',
  'admin staff': 'badge-gray',
}

const GENDERS = ['Male', 'Female', 'Other', 'Prefer not to say']

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
]

const EMPTY_FORM = {
  fullName: '',
  email: '',
  phone: '',
  gender: 'Male',
  role: 'staff',
  specialization: 'Healthcare Staff',
  customSpecialization: '',
  status: 'active',
}

export default function StaffPage() {
  const { user } = useAuth()
  const clinicId = user?.clinicId?._id || user?.clinicId

  const [staff, setStaff] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [specFilter, setSpecFilter] = useState('All')
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
  const loadStaff = useCallback(async () => {
    if (!clinicId) {
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const res = await staffApi.list({ clinicId: String(clinicId) })

      const list = Array.isArray(res?.data)
        ? res.data
        : Array.isArray(res?.data?.data)
        ? res.data.data
        : Array.isArray(res?.data?.staff)
        ? res.data.staff
        : Array.isArray(res?.data?.users)
        ? res.data.users
        : []

      setStaff(list)
    } catch (err) {
      console.error('Failed to load staff records:', err)
      setStaff([])
      showToast(err?.response?.data?.message || 'Failed to load staff list')
    } finally {
      setLoading(false)
    }
  }, [clinicId, showToast])

  useEffect(() => {
    loadStaff()
  }, [loadStaff])

  // ─── Modal & Form Handlers ───────────────────────────────────────────────────
  const openAdd = () => {
    setSelected(null)
    setForm(EMPTY_FORM)
    setFormErrors({})
    setModal('add')
  }

  const openEdit = (staffMember) => {
    setSelected(staffMember)
    const existingSpec = staffMember.specialization || 'Healthcare Staff'
    const isStandard = SPECIALIZATION_OPTIONS.some(
      (opt) => opt.value.toLowerCase() === existingSpec.toLowerCase()
    )

    setForm({
      fullName: staffMember.fullName || '',
      email: staffMember.email || '',
      phone: staffMember.phone || '',
      gender: staffMember.gender || 'Male',
      role: 'staff',
      specialization: isStandard ? existingSpec : 'Other',
      customSpecialization: isStandard ? '' : existingSpec,
      status: staffMember.isActive ? 'active' : 'inactive',
    })
    setFormErrors({})
    setModal('edit')
  }

  const openView = (staffMember) => {
    setSelected(staffMember)
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
    if (!clinicId) {
      showToast('Your account is not linked to a clinic. Please contact System Administrator.')
      return
    }

    const errors = {}
    if (!form.fullName.trim()) errors.fullName = 'Full name is required'
    if (!form.email.trim()) errors.email = 'Email is required'
    if (form.phone && !/^\d{11}$/.test(form.phone)) {
      errors.phone = 'Phone number must contain exactly 11 digits'
    }

    const targetSpecialization =
      form.specialization === 'Other'
        ? form.customSpecialization.trim()
        : form.specialization

    if (!targetSpecialization) {
      errors.specialization = 'Specialization title is required'
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors)
      return
    }

    setSaving(true)
    try {
      const payload = {
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        gender: form.gender,
        role: 'staff', // Fixed as staff by default
        specialization: targetSpecialization,
        isActive: form.status === 'active',
        clinicId: String(clinicId),
      }

      if (modal === 'edit' && selected?._id) {
        await staffApi.update(selected._id, payload)
        showToast('Staff member updated successfully')
      } else {
        await staffApi.create({
          ...payload,
          password: 'Staff@123',
        })
        showToast('Staff member added — default password: Staff@123')
      }

      closeModal()
      await loadStaff()
    } catch (e) {
      showToast(e?.response?.data?.message || 'Failed to save staff member')
    } finally {
      setSaving(false)
    }
  }

  const handleReactivate = async (s) => {
    setReactivating(true)
    try {
      await staffApi.update(s._id, { isActive: true })
      showToast('Staff member reactivated')
      await loadStaff()
    } catch (e) {
      showToast(e?.response?.data?.message || 'Failed to reactivate staff member')
    } finally {
      setReactivating(false)
    }
  }

  const handleExportCSV = () => {
    const rows = [
      ['Name', 'Gender', 'Role', 'Specialization', 'Phone', 'Email', 'Status'],
    ]
    filteredStaff.forEach((s) => {
      rows.push([
        s.fullName || '',
        s.gender || '—',
        'Staff',
        s.specialization || 'Healthcare Staff',
        s.phone || '',
        s.email || '',
        s.isActive ? 'Active' : 'Inactive',
      ])
    })
    const csv = rows
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `staff_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    showToast('Exported to CSV')
  }

  // ─── Filtered Data ───────────────────────────────────────────────────────────
  const filteredStaff = useMemo(() => {
    const q = search.trim().toLowerCase()
    return staff.filter((s) => {
      if (s._id === user?._id) return false
      if (s.role === 'facility_admin' || s.role === 'superadmin') return false

      const matchView = listView === 'active' ? s.isActive : !s.isActive

      const specKey = (s.specialization || '').toLowerCase()
      const matchSpec =
        specFilter === 'All' ||
        specKey === specFilter.toLowerCase() ||
        s.specialization === specFilter

      const matchSearch =
        !q ||
        (s.fullName || '').toLowerCase().includes(q) ||
        (s.email || '').toLowerCase().includes(q) ||
        (s.phone || '').toLowerCase().includes(q) ||
        (s.specialization || '').toLowerCase().includes(q)

      return matchView && matchSpec && matchSearch
    })
  }, [staff, search, specFilter, user, listView])

  const activeCount = useMemo(
    () => staff.filter((s) => s.isActive && s._id !== user?._id && s.role !== 'facility_admin' && s.role !== 'superadmin').length,
    [staff, user]
  )
  const inactiveCount = useMemo(
    () => staff.filter((s) => !s.isActive && s._id !== user?._id && s.role !== 'facility_admin' && s.role !== 'superadmin').length,
    [staff, user]
  )

  return (
    <div className={styles.page}>
      {toast && <div className={styles.toast}>{toast}</div>}

      {!clinicId && (
        <div
          style={{
            padding: '12px 16px',
            background: '#FEF3C7',
            border: '1px solid #F59E0B',
            borderRadius: 8,
            marginBottom: 12,
            fontSize: 13,
            color: '#92400E',
          }}
        >
          <strong>No clinic assigned.</strong> Your facility admin account is not linked to a clinic. Ask a System Administrator to assign your account to a clinic.
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
          marginBottom: 12,
        }}
      >
        {[
          ['active', `Active Staff (${activeCount})`],
          ['deactivated', `Deactivated Staff (${inactiveCount})`],
        ].map(([v, label]) => (
          <button
            key={v}
            onClick={() => setListView(v)}
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
        <div className={styles.header} style={{ padding: '20px 24px' }}>
          <div>
            <div className={styles.title}>Staff Management</div>
            <div className={styles.sub}>{filteredStaff.length} staff members in this facility</div>
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
            <button className="btn btn-primary" onClick={openAdd} disabled={!clinicId}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add Staff
            </button>
          </div>
        </div>

        {/* Toolbar */}
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
          <div className="search-bar" style={{ flex: 1, minWidth: 0, maxWidth: 'none' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="search"
              name="staff_filter_search"
              autoComplete="off"
              placeholder="Search by name, email, phone, or specialization..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <select
            className="dropdown-select"
            style={{ width: 200, flexShrink: 0 }}
            value={specFilter}
            onChange={(e) => setSpecFilter(e.target.value)}
          >
            <option value="All">All Specializations</option>
            {SPECIALIZATION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          <button
            className="btn btn-outline"
            style={{ flexShrink: 0, whiteSpace: 'nowrap' }}
            onClick={loadStaff}
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
        <div className="table-wrap" style={{ borderRadius: 0, border: 'none', borderTop: '1px solid var(--border)' }}>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Gender</th>
                <th>Specialization</th>
                <th>Contact</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: 32, color: 'var(--muted)' }}>
                    Loading staff…
                  </td>
                </tr>
              ) : filteredStaff.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: 32, color: 'var(--muted)' }}>
                    {listView === 'active' ? 'No active staff found' : 'No deactivated staff found'}
                  </td>
                </tr>
              ) : (
                filteredStaff.map((s) => {
                  const specKey = (s.specialization || '').toLowerCase()
                  return (
                    <tr key={s._id}>
                      <td>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{s.fullName || '—'}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{s.email || '—'}</div>
                      </td>
                      <td style={{ fontSize: 13 }}>{s.gender || '—'}</td>
                      <td>
                        <span className={`badge ${SPEC_BADGE[specKey] || 'badge-teal'}`}>
                          {s.specialization || 'Healthcare Staff'}
                        </span>
                      </td>
                      <td style={{ fontSize: 13 }}>{s.phone || '—'}</td>
                      <td>
                        <span className={`badge ${s.isActive ? 'badge-green' : 'badge-gray'}`}>
                          {s.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            className="btn btn-outline btn-sm"
                            title="View"
                            onClick={() => openView(s)}
                            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                          >
                            View
                          </button>
                          <button
                            className="btn btn-outline btn-sm"
                            title="Edit"
                            onClick={() => openEdit(s)}
                            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                          >
                            Edit
                          </button>
                          {s.isActive ? (
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
                              onClick={() => setDeactivateTarget(s)}
                            >
                              Deactivate
                            </button>
                          ) : (
                            <button
                              className="btn btn-outline btn-sm"
                              title="Reactivate"
                              onClick={() => handleReactivate(s)}
                              disabled={reactivating}
                              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                            >
                              {reactivating ? 'Reactivating…' : 'Reactivate'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── VIEW MODAL ── */}
      {modal === 'view' && selected && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Staff Profile</div>
              <button className="modal-close" onClick={closeModal}>×</button>
            </div>
            <div className="modal-body">
              {[
                ['Full Name', selected.fullName],
                ['Gender', selected.gender || '—'],
                ['Specialization', selected.specialization || 'Healthcare Staff'],
                ['Phone', selected.phone || '—'],
                ['Email', selected.email || '—'],
                ['Status', selected.isActive ? 'Active' : 'Inactive'],
              ].map(([label, val]) => (
                <div
                  key={label}
                  style={{ display: 'flex', padding: '8px 0', borderBottom: '1px solid var(--border-lt)', gap: 12 }}
                >
                  <span style={{ minWidth: 130, fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>
                    {label}
                  </span>
                  <span style={{ fontSize: 13 }}>{val}</span>
                </div>
              ))}
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={closeModal}>
                Close
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  const s = selected
                  closeModal()
                  openEdit(s)
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
          <div className="modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">{modal === 'edit' ? 'Edit Staff Member' : 'Add New Staff'}</div>
              <button className="modal-close" onClick={closeModal}>×</button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <FormField
                  label={ <> Full Name <span style={{ color: 'var(--error)' }}>*</span> </> }
                  value={form.fullName}
                  error={formErrors.fullName}
                  onChange={(val) => handleFieldChange('fullName', val)}
                />
                <FormField
                  label={ <> Email Address <span style={{ color: 'var(--error)' }}>*</span> </> }
                  type="email"
                  value={form.email}
                  error={formErrors.email}
                  onChange={(val) => handleFieldChange('email', val)}
                />
                
                <FormField
                  label="Phone Number"
                  type="tel"
                  inputMode="numeric"
                  placeholder="09XXXXXXXXX"
                  maxLength={11}
                  value={form.phone}
                  error={formErrors.phone}
                  onChange={(val) => handleFieldChange('phone', val.replace(/\D/g, '').slice(0, 11))}
                />
                <SelectField
                  label="Gender"
                  value={form.gender}
                  options={GENDERS.map((g) => ({ value: g, label: g }))}
                  onChange={(val) => handleFieldChange('gender', val)}
                />
                <SelectField
                  label={ <> Specialization <span style={{ color: 'var(--error)' }}>*</span> </> }
                  value={form.specialization}
                  options={[
                    ...SPECIALIZATION_OPTIONS,
                    { value: 'Other', label: 'Other (Custom)' },
                  ]}
                  onChange={(val) => handleFieldChange('specialization', val)}
                />
                {form.specialization === 'Other' && (
                  <FormField
                  label={ <> Custom Specialization <span style={{ color: 'var(--error)' }}>*</span> </> }
                    value={form.customSpecialization}
                    error={formErrors.specialization}
                    onChange={(val) => handleFieldChange('customSpecialization', val)}
                  />
                )}
                <SelectField
                  label="Status"
                  value={form.status}
                  options={STATUS_OPTIONS}
                  onChange={(val) => handleFieldChange('status', val)}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={closeModal}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : modal === 'edit' ? 'Save Changes' : 'Add Staff'}
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
              <span className="modal-title">Deactivate Staff Member</span>
              <button className="modal-close" onClick={() => setDeactivateTarget(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>
                Are you sure you want to deactivate{' '}
                <strong style={{ color: 'var(--text)' }}>{deactivateTarget.fullName}</strong>? They will no longer
                be able to log in or be assigned to the queue.
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

function FormField({ label, type = 'text', inputMode, maxLength, value, error, onChange }) {
  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <input
        className="form-input"
        type={type}
        inputMode={inputMode}
        maxLength={maxLength}
        autoComplete="off"
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
          <option key={o.value ?? o} value={o.value ?? o}>
            {o.label ?? o}
          </option>
        ))}
      </select>
    </div>
  )
}
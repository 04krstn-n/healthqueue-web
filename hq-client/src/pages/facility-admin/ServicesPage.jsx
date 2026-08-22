import { useState, useEffect, useCallback, useRef } from 'react'
import { clinicsApi, servicesApi } from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import styles from './facility-admin.module.css'

const EMPTY_SVC = {
  name: '',
  description: '',
  durationMinutes: 30,
  isAvailable: true,
}

const CLINIC_INFO_FIELDS = [
  ['address', 'Address'],
  ['contactNumber', 'Contact Number'],
  ['email', 'Email'],
  ['operatingHours', 'Operating Hours'],
]

export default function ServicesPage() {
  const { user } = useAuth()
  const clinicId = user?.clinicId

  const [clinic, setClinic] = useState(null)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')
  const [modal, setModal] = useState(null) // null | 'add' | 'edit' | 'view'
  const [selected, setSelected] = useState(null)
  const [form, setForm] = useState(EMPTY_SVC)
  const [formErrors, setFormErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [editingInfo, setEditingInfo] = useState(false)
  const [infoForm, setInfoForm] = useState({})
  const [savingInfo, setSavingInfo] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

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
      const [clinicRes, serviceRes] = await Promise.all([
        clinicsApi.get(clinicId),
        servicesApi.list(clinicId),
      ])

      const clinicData = clinicRes?.data || {}
      const servicesList = Array.isArray(serviceRes?.data) ? serviceRes.data : clinicData.services || []

      setClinic({ ...clinicData, services: servicesList })
      setInfoForm(clinicData)
    } catch {
      showToast('Failed to load clinic data')
    } finally {
      setLoading(false)
    }
  }, [clinicId, showToast])

  useEffect(() => {
    loadData()
  }, [loadData])

  // ───  Clinic Details Mutations ───────────────────────────────────────────────────
  const openEditInfo = () => {
    setInfoForm(clinic || {})
    setEditingInfo(true)
  }

  const closeEditInfo = () => {
    setEditingInfo(false)
  }

  const handleSaveInfo = async () => {
    if (!clinic?._id) return

    setSavingInfo(true)
    try {
      const res = await clinicsApi.update(clinic._id, infoForm)
      const updatedData = res?.data || infoForm
      setClinic((prev) => ({ ...prev, ...updatedData }))
      setEditingInfo(false)
      showToast(' Clinic Details updated successfully')
    } catch (err) {
      showToast(err?.response?.data?.message || 'Failed to update  clinic Details')
    } finally {
      setSavingInfo(false)
    }
  }

  // ─── Service Modal Handlers ──────────────────────────────────────────────────
  const openAdd = () => {
    setSelected(null)
    setForm(EMPTY_SVC)
    setFormErrors({})
    setModal('add')
  }

  const openEdit = (svc, idx) => {
    setSelected({ svc, idx })
    setForm({
      name: svc.name || '',
      description: svc.description || '',
      durationMinutes: svc.durationMinutes ?? 30,
      isAvailable: svc.isAvailable ?? true,
    })
    setFormErrors({})
    setModal('edit')
  }

  const openView = (svc, idx) => {
    setSelected({ svc, idx })
    setModal('view')
  }

  const closeModal = () => {
    setModal(null)
    setSelected(null)
    setForm(EMPTY_SVC)
    setFormErrors({})
  }

  const handleFieldChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }))
    if (formErrors[field]) {
      setFormErrors((prev) => ({ ...prev, [field]: '' }))
    }
  }

  // ─── Service CRUD Operations ─────────────────────────────────────────────────
  const handleSaveService = async () => {
    const errors = {}
    if (!form.name.trim()) {
      errors.name = 'Service name is required'
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors)
      return
    }

    setSaving(true)
    try {
      const payload = {
        clinicId: clinic._id,
        name: form.name.trim(),
        description: form.description?.trim() || '',
        durationMinutes: Number(form.durationMinutes) || 30,
        isAvailable: !!form.isAvailable,
      }

      if (modal === 'edit' && selected?.svc?._id) {
        await servicesApi.update(clinic._id, selected.svc._id, payload)
        showToast('Service updated successfully')
      } else {
        await servicesApi.add(payload)
        showToast('Service added successfully')
      }

      closeModal()
      await loadData()
    } catch (err) {
      showToast(err?.response?.data?.message || 'Failed to save service')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteService = async (serviceId) => {
    setDeleting(true)
    try {
      if (!serviceId) throw new Error('Service ID is missing')
      await servicesApi.delete(clinic._id, serviceId)
      setDeleteTarget(null)
      showToast('Service removed successfully')
      await loadData()
    } catch (err) {
      showToast(err?.response?.data?.message || 'Failed to remove service')
    } finally {
      setDeleting(false)
    }
  }

  const handleToggleAvailable = async (svc) => {
    if (!svc?._id) return

    try {
      await servicesApi.update(clinic._id, svc._id, { isAvailable: !svc.isAvailable })
      showToast(`Service marked as ${!svc.isAvailable ? 'available' : 'unavailable'}`)
      await loadData()
    } catch (err) {
      showToast(err?.response?.data?.message || 'Failed to update service availability')
    }
  }

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading  clinic Details…</div>
  }

  if (!clinic) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>No clinic assigned to your account.</div>
  }

  const services = clinic.services || []

  return (
    <div className={styles.page}>
      {toast && <div className={styles.toast}>{toast}</div>}

      {/* ── Header ── */}
      <div className={styles.header}>
        <div>
          <div className={styles.title}>{clinic.name || 'Facility Portal'}</div>
          <div className={styles.sub}>
            {clinic.facilityType || 'Diagnostic Center'} · {clinic.city || '—'}, {clinic.province || '—'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline" onClick={openEditInfo}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            Update Clinic Details
          </button>
          <button className="btn btn-primary" onClick={openAdd}>
            + Add Service
          </button>
        </div>
      </div>

      {/* ── Services Table ── */}
      <div className="card" style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <span style={{ fontWeight: 700, color: 'var(--text)', fontSize: 14 }}>
            Services Offered <span style={{ color: 'var(--muted)', fontWeight: 400 }}>({services.length})</span>
          </span>
        </div>

        {services.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--muted)' }}>
            No services added yet. Click <strong>+ Add Service</strong> to get started.
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Service Name</th>
                <th>Description</th>
                <th>Duration</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {services.map((svc, idx) => (
                <tr key={svc._id || idx}>
                  <td>
                    <strong>{svc.name || '—'}</strong>
                  </td>
                  <td style={{ color: 'var(--muted)', fontSize: 13 }}>{svc.description || '—'}</td>
                  <td>{svc.durationMinutes || 30} min</td>
                  <td>
                    <span className={`badge ${svc.isAvailable ? 'badge-green' : 'badge-gray'}`}>
                      {svc.isAvailable ? 'Available' : 'Unavailable'}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        className="btn btn-outline"
                        style={{ fontSize: 11, padding: '3px 8px' }}
                        onClick={() => openView(svc, idx)}
                      >
                        View
                      </button>
                      <button
                        className="btn btn-outline"
                        style={{ fontSize: 11, padding: '3px 8px' }}
                        onClick={() => openEdit(svc, idx)}
                      >
                        Edit
                      </button>
                      <button
                        className="btn btn-outline"
                        style={{
                          fontSize: 11,
                          padding: '3px 8px',
                          color: svc.isAvailable ? 'var(--muted)' : 'var(--success)',
                        }}
                        onClick={() => handleToggleAvailable(svc)}
                      >
                        {svc.isAvailable ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        className="btn"
                        style={{
                          fontSize: 11,
                          padding: '3px 8px',
                          color: 'var(--error)',
                          background: 'var(--error-lt)',
                          border: 'none',
                        }}
                        onClick={() => setDeleteTarget(svc)}
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Update Clinic Details Modal ── */}
      {editingInfo && (
        <div className="modal-overlay" onClick={closeEditInfo}>
          <div className="modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Update Clinic Details</span>
              <button className="modal-close" onClick={closeEditInfo}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 16, rowGap: 20 }}>
                {CLINIC_INFO_FIELDS.map(([field, label]) => (
                  <div key={field} className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ display: 'block', marginBottom: 6 }}>{label}</label>
                    <input
                      className="form-input"
                      value={infoForm[field] || ''}
                      inputMode={field === 'contactNumber' ? 'numeric' : undefined}
                      maxLength={field === 'contactNumber' ? 11 : undefined}
                      onChange={(e) => {
                        let val = e.target.value
                        if (field === 'contactNumber') {
                          val = val.replace(/\D/g, '').slice(0, 11)
                        }
                        setInfoForm((prev) => ({ ...prev, [field]: val }))
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={closeEditInfo} disabled={savingInfo}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleSaveInfo} disabled={savingInfo}>
                {savingInfo ? 'Saving…' : 'Save Info'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add / Edit Service Modal ── */}
      {(modal === 'add' || modal === 'edit') && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">{modal === 'edit' ? 'Edit Service' : 'Add New Service'}</span>
              <button className="modal-close" onClick={closeModal}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">
                  Service Name <span style={{ color: 'var(--error)' }}>*</span>
                </label>
                <input
                  className="form-input"
                  value={form.name}
                  style={{ border: formErrors.name ? '1px solid #DC2626' : undefined }}
                  placeholder="e.g. Consultation, Blood Test"
                  onChange={(e) => handleFieldChange('name', e.target.value)}
                />
                {formErrors.name && (
                  <div style={{ color: '#DC2626', fontSize: 12, marginTop: 4, fontWeight: 500 }}>
                    {formErrors.name}
                  </div>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">Description</label>
                <textarea
                  className="form-input"
                  rows={2}
                  value={form.description}
                  placeholder="Brief description of this service"
                  onChange={(e) => handleFieldChange('description', e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Duration (minutes)</label>
                <input
                  className="form-input"
                  type="number"
                  min={5}
                  max={480}
                  value={form.durationMinutes}
                  onChange={(e) => handleFieldChange('durationMinutes', e.target.value)}
                />
              </div>

              <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                <Toggle
                  value={!!form.isAvailable}
                  onChange={(val) => handleFieldChange('isAvailable', val)}
                />
                <span style={{ color: 'var(--text-2)', fontSize: 13 }}>Currently available to patients</span>
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn btn-outline" onClick={closeModal}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleSaveService} disabled={saving}>
                {saving ? 'Saving…' : modal === 'edit' ? 'Save Changes' : 'Add Service'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── View Service Modal ── */}
      {modal === 'view' && selected?.svc && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" style={{ maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">{selected.svc.name}</span>
              <button className="modal-close" onClick={closeModal}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ marginBottom: 8 }}>
                <strong>Description:</strong> {selected.svc.description || '—'}
              </p>
              <p style={{ marginBottom: 8 }}>
                <strong>Duration:</strong> {selected.svc.durationMinutes || 30} minutes
              </p>
              <p style={{ marginBottom: 0 }}>
                <strong>Status:</strong>{' '}
                <span className={`badge ${selected.svc.isAvailable ? 'badge-green' : 'badge-gray'}`}>
                  {selected.svc.isAvailable ? 'Available' : 'Unavailable'}
                </span>
              </p>
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
                  openEdit(item.svc, item.idx)
                }}
              >
                Edit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── DELETE SERVICE CONFIRMATION MODAL ── */}
      {deleteTarget && (
        <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="modal" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Remove Service</span>
              <button className="modal-close" onClick={() => setDeleteTarget(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>
                Are you sure you want to remove{' '}
                <strong style={{ color: 'var(--text)' }}>{deleteTarget.name}</strong>? This cannot be undone.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button
                className="btn btn-sm"
                style={{ background: 'var(--error)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 6 }}
                onClick={() => handleDeleteService(deleteTarget._id)}
                disabled={deleting}
              >
                {deleting ? 'Removing…' : 'Yes, Remove'}
              </button>
            </div>
          </div>
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
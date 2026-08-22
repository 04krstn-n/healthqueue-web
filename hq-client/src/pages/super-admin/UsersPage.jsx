import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { usersApi, clinicsApi } from '../../services/api'
import styles from './super-admin.module.css'

const ROLE_LABELS = {
  super_admin: 'System Administrator',
  facility_admin: 'Facility Admin',
  staff: 'Staff',
  patient: 'Patient',
}

const ROLE_BADGE = {
  super_admin: 'badge-purple',
  facility_admin: 'badge-blue',
  staff: 'badge-teal',
  patient: 'badge-green',
}

const CREATE_ROLES = ['facility_admin', 'staff', 'super_admin']

const PERMISSIONS = {
  'Patient Management': ['Patient Check-in', 'View Patient Records', 'Edit Patient Records'],
  'Queue Management': ['View Queue', 'Manage Queue'],
  'Staff Management': ['View Staff', 'Manage Staff'],
  Analytics: ['View Reports', 'Export Reports'],
  'System Settings': ['View Settings', 'Manage Settings'],
}

const PERM_OPTIONS = [
  'full-access',
  'queue-management',
  'patient-view',
  'patient-checkin',
  'reports-view',
  'reports-export',
  'analytics',
  'staff-view',
  'staff-manage',
  'queue-view',
  'settings-view',
  'settings-manage',
]

const SYSTEM_ROLES = [
  {
    _id: '1',
    name: 'Facility Admin',
    type: 'system',
    users: 24,
    desc: 'Full administrative access to facility operations',
    perms: ['full-access'],
  },
  {
    _id: '2',
    name: 'Staff',
    type: 'system',
    users: 42,
    desc: 'Manage patient queues and flow',
    perms: ['queue-management', 'patient-view', 'reports-view'],
  },
  {
    _id: '3',
    name: 'System Admin',
    type: 'system',
    users: 24,
    desc: 'Full administrative access to all operations',
    perms: ['full-access'],
  },
]

const PERM_BADGE = {
  'full-access': 'badge-blue',
  'queue-management': 'badge-teal',
  'patient-view': 'badge-green',
  'patient-checkin': 'badge-green',
  'reports-view': 'badge-purple',
  'reports-export': 'badge-purple',
  analytics: 'badge-orange',
  'staff-view': 'badge-gray',
  'staff-manage': 'badge-gray',
  'queue-view': 'badge-teal',
  'settings-view': 'badge-gray',
  'settings-manage': 'badge-gray',
}

const EMPTY_USER_FORM = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  role: 'facility_admin',
  clinicId: '',
  permissions: [],
}

export default function UserManagementPage() {
  const [tab, setTab] = useState('list') // 'list' | 'create'
  const [listView, setListView] = useState('active') // 'active' | 'deactivated'
  const [toast, setToast] = useState('')

  const [users, setUsers] = useState([])
  const [clinics, setClinics] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')

  const [userForm, setUserForm] = useState(EMPTY_USER_FORM)
  const [formErrors, setFormErrors] = useState({})
  const [savingUser, setSavingUser] = useState(false)
  const [userSuccess, setUserSuccess] = useState('')
  const [userError, setUserError] = useState('')

  const [assignModalUser, setAssignModalUser] = useState(null)
  const [assignClinicId, setAssignClinicId] = useState('')
  const [assigning, setAssigning] = useState(false)
  const [deactivateTarget, setDeactivateTarget] = useState(null)
  const [reactivateTarget, setReactivateTarget] = useState(null)
  const [reactivating, setReactivating] = useState(false)

  // Role Management State
  const [showRoleManager, setShowRoleManager] = useState(false)
  const [customRoles, setCustomRoles] = useState([])
  const [roleModal, setRoleModal] = useState(null) // null | 'create' | 'edit'
  const [editingRole, setEditingRole] = useState(null)
  const [roleForm, setRoleForm] = useState({ name: '', desc: '', perms: [] })
  const [roleError, setRoleError] = useState('')

  const toastTimerRef = useRef(null)

  const showToast = useCallback((msg) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToast(msg)
    toastTimerRef.current = setTimeout(() => setToast(''), 3000)
  }, [])

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    }
  }, [])

  // ─── Data Loading ────────────────────────────────────────────────────────────
  const loadUsers = useCallback(async () => {
    setLoading(true)
    try {
      const res = await usersApi.list()
      setUsers(Array.isArray(res?.data) ? res.data : [])
    } catch (e) {
      showToast(e?.response?.data?.message || 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  const loadClinics = useCallback(async () => {
    try {
      const res = await clinicsApi.list()
      setClinics(Array.isArray(res?.data) ? res.data : [])
    } catch (e) {
      console.error('Failed to load clinics:', e)
    }
  }, [])

  useEffect(() => {
    loadUsers()
    loadClinics()
  }, [loadUsers, loadClinics])

  // ─── User Creation Handlers ──────────────────────────────────────────────────
  const toggleUserPerm = (perm) => {
    setUserForm((f) => ({
      ...f,
      permissions: f.permissions.includes(perm)
        ? f.permissions.filter((p) => p !== perm)
        : [...f.permissions, perm],
    }))
  }

  const handleCreateUser = async () => {
    const errors = {}
    if (!userForm.firstName.trim()) errors.firstName = 'First name is required'
    if (!userForm.email.trim()) errors.email = 'Email address is required'
    if (!userForm.role) errors.role = 'Role is required'
    if (userForm.role === 'facility_admin' && !userForm.clinicId) {
      errors.clinicId = 'Facility Admin must be assigned to a clinic.'
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors)
      setUserError('Please resolve required fields.')
      return
    }

    setSavingUser(true)
    setUserError('')
    setUserSuccess('')
    setFormErrors({})

    try {
      await usersApi.create({
        fullName: `${userForm.firstName.trim()} ${userForm.lastName.trim()}`.trim(),
        email: userForm.email.trim(),
        phone: userForm.phone.trim(),
        role: userForm.role,
        clinicId: userForm.clinicId || null,
        password: 'HealthQueue@2025',
      })
      setUserSuccess('User created successfully! Default password: HealthQueue@2025')
      setUserForm(EMPTY_USER_FORM)
      await loadUsers()
    } catch (e) {
      setUserError(e?.response?.data?.message || 'Failed to create user.')
    } finally {
      setSavingUser(false)
    }
  }

  // ─── Assign / Deactivate Handlers ────────────────────────────────────────────
  const openAssign = (u) => {
    setAssignModalUser(u)
    setAssignClinicId(u.clinicId?._id || u.clinicId || '')
  }

  const handleAssign = async () => {
    if (!assignModalUser) return
    setAssigning(true)
    try {
      await usersApi.update(assignModalUser._id, {
        clinicId: assignClinicId || null,
      })
      setAssignModalUser(null)
      showToast('Clinic assigned successfully')
      await loadUsers()
    } catch (e) {
      showToast(e?.response?.data?.message || 'Failed to assign clinic.')
    } finally {
      setAssigning(false)
    }
  }

  const handleDeactivate = async (u) => {
    try {
      await usersApi.deactivate(u._id)
      setDeactivateTarget(null)
      showToast('User deactivated')
      await loadUsers()
    } catch (e) {
      showToast(e?.response?.data?.message || 'Failed to deactivate user.')
    }
  }

  const handleReactivate = async (u) => {
    setReactivating(true)
    try {
      await usersApi.update(u._id, { isActive: true })
      setReactivateTarget(null)
      showToast('User reactivated')
      await loadUsers()
    } catch (e) {
      showToast(e?.response?.data?.message || 'Failed to reactivate user.')
    } finally {
      setReactivating(false)
    }
  }

  const getClinicDisplayName = useCallback(
    (u) => {
      const id = u.clinicId?._id || u.clinicId
      if (!id) return '—'
      const match = clinics.find((c) => c._id === id)
      return match ? match.name.replace('Hi-Precision Diagnostics - ', '') : '—'
    },
    [clinics]
  )

  // ─── Custom Role Handlers ────────────────────────────────────────────────────
  const allRoles = useMemo(() => [...SYSTEM_ROLES, ...customRoles], [customRoles])

  const openCreateRole = () => {
    setEditingRole(null)
    setRoleForm({ name: '', desc: '', perms: [] })
    setRoleError('')
    setRoleModal('create')
  }

  const openEditRole = (r) => {
    setEditingRole(r)
    setRoleForm({ name: r.name, desc: r.desc, perms: [...r.perms] })
    setRoleError('')
    setRoleModal('edit')
  }

  const closeRoleModal = () => {
    setRoleModal(null)
    setEditingRole(null)
    setRoleError('')
  }

  const toggleRolePerm = (perm) => {
    setRoleForm((prev) => ({
      ...prev,
      perms: prev.perms.includes(perm)
        ? prev.perms.filter((p) => p !== perm)
        : [...prev.perms, perm],
    }))
  }

  const saveRole = () => {
    if (!roleForm.name.trim()) {
      setRoleError('Role name is required')
      return
    }

    if (roleModal === 'edit' && editingRole?.type === 'system') {
      showToast('System roles cannot be modified')
      return
    }

    if (roleModal === 'edit') {
      setCustomRoles((prev) =>
        prev.map((r) => (r._id === editingRole._id ? { ...r, ...roleForm } : r))
      )
      showToast('Role updated')
    } else {
      setCustomRoles((prev) => [
        ...prev,
        { _id: String(Date.now()), type: 'custom', users: 0, ...roleForm },
      ])
      showToast('Role created successfully')
    }
    closeRoleModal()
  }

  const duplicateRole = (r) => {
    setCustomRoles((prev) => [
      ...prev,
      { ...r, _id: String(Date.now()), name: `${r.name} (Copy)`, type: 'custom', users: 0 },
    ])
    showToast(`"${r.name}" duplicated`)
  }

  const removeRole = (e, id) => {
    e.stopPropagation()
    if (!window.confirm('Delete this custom role? This cannot be undone.')) return
    setCustomRoles((prev) => prev.filter((r) => r._id !== id))
    showToast('Role deleted')
  }

  // ─── Memoized Selectors ───────────────────────────────────────────────────────
  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase()
    return users.filter((u) => {
      const matchView = listView === 'active' ? u.isActive : !u.isActive
      const matchRole = roleFilter === 'all' || u.role === roleFilter
      const matchSearch =
        !query ||
        u.fullName?.toLowerCase().includes(query) ||
        u.email?.toLowerCase().includes(query)
      return matchView && matchRole && matchSearch
    })
  }, [users, search, roleFilter, listView])

  const userStats = useMemo(() => {
    return {
      total: users.length,
      superAdmin: users.filter((u) => u.role === 'super_admin').length,
      facilityAdmin: users.filter((u) => u.role === 'facility_admin').length,
      staff: users.filter((u) => u.role === 'staff').length,
      active: users.filter((u) => u.isActive).length,
      inactive: users.filter((u) => !u.isActive).length,
      unassignedAdmins: users.filter((u) => u.role === 'facility_admin' && !u.clinicId).length,
    }
  }, [users])

  return (
    <div className={styles.page}>
      {toast && <div className={styles.toast}>{toast}</div>}

      {/* Header */}
      <div className={styles.header}>
        <div>
          <div className={styles.title}>User Management</div>
          <div className={styles.sub}>Add, edit, and manage system access for all personnel</div>
        </div>
        <button
          className="btn btn-outline"
          onClick={() => setShowRoleManager(true)}
          style={{ display: 'flex', gap: 6, alignItems: 'center' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          Manage Roles & Permissions
        </button>
      </div>

      {/* Navigation Tabs */}
      <div className={styles.pageTabs}>
        <button
          className={`${styles.pageTab} ${tab === 'list' ? styles.pageTabActive : ''}`}
          onClick={() => setTab('list')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="8" y1="6" x2="21" y2="6" />
            <line x1="8" y1="12" x2="21" y2="12" />
            <line x1="8" y1="18" x2="21" y2="18" />
            <line x1="3" y1="6" x2="3.01" y2="6" />
            <line x1="3" y1="12" x2="3.01" y2="12" />
            <line x1="3" y1="18" x2="3.01" y2="18" />
          </svg>
          User List
        </button>
        <button
          className={`${styles.pageTab} ${tab === 'create' ? styles.pageTabActive : ''}`}
          onClick={() => setTab('create')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <line x1="19" y1="8" x2="19" y2="14" />
            <line x1="22" y1="11" x2="16" y2="11" />
          </svg>
          Create New User
        </button>
      </div>

      {/* ── 1. USER LIST TAB ── */}
      {tab === 'list' && (
        <>
          {userStats.unassignedAdmins > 0 && (
            <div
              style={{
                padding: '10px 14px',
                background: '#FEF3C7',
                border: '1px solid #F59E0B',
                borderRadius: 8,
                marginBottom: 12,
                fontSize: 13,
                color: '#92400E',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <span>
                <strong>
                  {userStats.unassignedAdmins} Facility Admin
                  {userStats.unassignedAdmins > 1 ? 's' : ''}
                </strong>{' '}
                without a clinic assignment. Use the <strong>Assign Clinic</strong> button below.
              </span>
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
              ['active', `Active Accounts (${userStats.active})`],
              ['deactivated', `Deactivated Accounts (${userStats.inactive})`],
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
            {/* Toolbar */}
            <div className={styles.toolbar}>
              <div className="search-bar" style={{ flex: 1, maxWidth: 300 }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  placeholder="Search by name or email..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <select
                className="dropdown-select"
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
              >
                <option value="all">All Roles</option>
                <option value="super_admin">System Administrator</option>
                <option value="facility_admin">Facility Admin</option>
                <option value="staff">Staff</option>
                <option value="patient">Patient</option>
              </select>
              <button className="btn btn-outline btn-sm" onClick={loadUsers} disabled={loading}>
                Refresh
              </button>
            </div>

            {/* Quick Metrics */}
            <div style={{ display: 'flex', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
              {[
                ['Total Users', userStats.total, 'var(--text)'],
                ['Sys Admin', userStats.superAdmin, '#7C3AED'],
                ['Facility Admin', userStats.facilityAdmin, '#2563EB'],
                ['Staff', userStats.staff, '#0D9488'],
                ['Active', userStats.active, '#16A34A'],
                ['Inactive', userStats.inactive, '#6B7280'],
              ].map(([label, val, color]) => (
                <div
                  key={label}
                  style={{
                    flex: 1,
                    textAlign: 'center',
                    padding: '8px 4px',
                    background: 'var(--bg)',
                    borderRadius: 8,
                  }}
                >
                  <div style={{ fontSize: 20, fontWeight: 700, color }}>{val}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{label}</div>
                </div>
              ))}
            </div>

            {/* Table */}
            <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Role</th>
                    <th>Assigned Clinic</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', padding: 32, color: 'var(--muted)' }}>
                        Loading users…
                      </td>
                    </tr>
                  ) : filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', padding: 32, color: 'var(--muted)' }}>
                        {listView === 'active' ? 'No active users found' : 'No deactivated users found'}
                      </td>
                    </tr>
                  ) : (
                    filteredUsers.map((u) => (
                      <tr key={u._id}>
                        <td>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{u.fullName}</div>
                          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{u.email}</div>
                        </td>
                        <td>
                          <span className={`badge ${ROLE_BADGE[u.role] || 'badge-gray'}`}>
                            {ROLE_LABELS[u.role] || u.role}
                          </span>
                        </td>
                        <td style={{ fontSize: 13 }}>
                          {u.role === 'facility_admin' ? (
                            <span
                              style={{
                                color: u.clinicId ? 'var(--text)' : '#D97706',
                                fontWeight: u.clinicId ? 400 : 600,
                              }}
                            >
                              {getClinicDisplayName(u) === '—' ? '⚠ Not assigned' : getClinicDisplayName(u)}
                            </span>
                          ) : (
                            getClinicDisplayName(u)
                          )}
                        </td>
                        <td>
                          <span className={`badge ${u.isActive ? 'badge-green' : 'badge-gray'}`}>
                            {u.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--muted)' }}>
                          {u.createdAt
                            ? new Date(u.createdAt).toLocaleDateString('en-PH', {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                              })
                            : '—'}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {u.role === 'facility_admin' && u.isActive && (
                              <button className="btn btn-primary btn-sm" onClick={() => openAssign(u)}>
                                Assign Clinic
                              </button>
                            )}
                            {u.isActive ? (
                              <button
                                className="btn btn-sm"
                                style={{ background: 'var(--error-lt)', color: 'var(--error)', border: 'none' }}
                                onClick={() => setDeactivateTarget(u)}
                              >
                                Deactivate
                              </button>
                            ) : (
                              <button className="btn btn-outline btn-sm" onClick={() => setReactivateTarget(u)}>
                                Reactivate
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
          </div>
        </>
      )}

      {/* ── 2. CREATE USER TAB ── */}
      {tab === 'create' && (
        <div style={{ maxWidth: 640, margin: '0 auto' }}>
          <div className={`card ${styles.banner}`}>
            <div className={styles.bannerIcon}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <line x1="19" y1="8" x2="19" y2="14" />
                <line x1="22" y1="11" x2="16" y2="11" />
              </svg>
            </div>
            <div>
              <div className={styles.bannerTitle}>Create New User</div>
              <div className={styles.bannerSub}>
                Add a new user to the HealthQueue+ system. Default password: <strong>HealthQueue@2025</strong>
              </div>
            </div>
          </div>

          {userSuccess && <div className="alert alert-success">{userSuccess}</div>}
          {userError && <div className="alert alert-error">{userError}</div>}

          <div className={`card ${styles.section}`}>
            <div className={styles.sectionTitle}>Personal Information</div>
            <div className={styles.formGrid2}>
              <div className="form-group">
                <label className="form-label">
                  First Name <span className={styles.req}>*</span>
                </label>
                <input
                  className="form-input"
                  placeholder="First name"
                  value={userForm.firstName}
                  style={{ border: formErrors.firstName ? '1px solid #DC2626' : undefined }}
                  onChange={(e) => {
                    setUserForm((f) => ({ ...f, firstName: e.target.value }))
                    if (formErrors.firstName) setFormErrors((f) => ({ ...f, firstName: '' }))
                  }}
                />
                {formErrors.firstName && (
                  <div style={{ color: '#DC2626', fontSize: 12, marginTop: 4, fontWeight: 500 }}>
                    {formErrors.firstName}
                  </div>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">Last Name</label>
                <input
                  className="form-input"
                  placeholder="Last name"
                  value={userForm.lastName}
                  onChange={(e) => setUserForm((f) => ({ ...f, lastName: e.target.value }))}
                />
              </div>

              <div className="form-group">
                <label className="form-label">
                  Email Address <span className={styles.req}>*</span>
                </label>
                <input
                  className="form-input"
                  type="email"
                  placeholder="user@example.com"
                  value={userForm.email}
                  style={{ border: formErrors.email ? '1px solid #DC2626' : undefined }}
                  onChange={(e) => {
                    setUserForm((f) => ({ ...f, email: e.target.value }))
                    if (formErrors.email) setFormErrors((f) => ({ ...f, email: '' }))
                  }}
                />
                {formErrors.email && (
                  <div style={{ color: '#DC2626', fontSize: 12, marginTop: 4, fontWeight: 500 }}>
                    {formErrors.email}
                  </div>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">Phone Number</label>
                <input
                  className="form-input"
                  placeholder="09XXXXXXXXX"
                  value={userForm.phone}
                 onChange={(e) => { const digitsOnly = e.target.value.replace(/\D/g, '').slice(0, 11)
                   setUserForm((f) => ({ ...f, phone: digitsOnly })) }}
                />
              </div>
            </div>
          </div>

          <div className={`card ${styles.section}`}>
            <div className={styles.sectionTitle}>Account Information</div>
            <div className={styles.formGrid2}>
              <div className="form-group">
                <label className="form-label">
                  Role <span className={styles.req}>*</span>
                </label>
                <select
                  className="form-select"
                  value={userForm.role}
                  onChange={(e) => setUserForm((f) => ({ ...f, role: e.target.value, clinicId: '' }))}
                >
                  {CREATE_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r] || r}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">
                  Assign Clinic
                  {userForm.role === 'facility_admin' && <span className={styles.req}> *</span>}
                </label>
                <select
                  className="form-select"
                  value={userForm.clinicId}
                  style={{ border: formErrors.clinicId ? '1px solid #DC2626' : undefined }}
                  onChange={(e) => {
                    setUserForm((f) => ({ ...f, clinicId: e.target.value }))
                    if (formErrors.clinicId) setFormErrors((f) => ({ ...f, clinicId: '' }))
                  }}
                >
                  <option value="">
                    {userForm.role === 'facility_admin' ? '— Select clinic (required) —' : '— None —'}
                  </option>
                  {clinics.map((cl) => (
                    <option key={cl._id} value={cl._id}>
                      {cl.name.replace('Hi-Precision Diagnostics - ', '')}
                    </option>
                  ))}
                </select>
                {userForm.role === 'facility_admin' && !userForm.clinicId && (
                  <div style={{ fontSize: 11, color: '#D97706', marginTop: 4 }}>
                    Facility Admin must be assigned to a clinic.
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className={`card ${styles.section}`}>
            <div className={styles.sectionTitle}>Permissions</div>
            {Object.entries(PERMISSIONS).map(([group, perms]) => (
              <div key={group} className={styles.permGroup}>
                <div className={styles.permGroupTitle}>{group}</div>
                <div className={styles.permGrid}>
                  {perms.map((p) => (
                    <label key={p} className={styles.permItem}>
                      <input
                        type="checkbox"
                        checked={userForm.permissions.includes(p)}
                        onChange={() => toggleUserPerm(p)}
                        className={styles.permCheck}
                      />
                      <span className={styles.permLabel}>{p}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className={styles.actions}>
            <button
              className="btn btn-outline"
              onClick={() => {
                setUserForm(EMPTY_USER_FORM)
                setFormErrors({})
                setUserError('')
                setUserSuccess('')
              }}
            >
              Clear
            </button>
            <button className="btn btn-outline" onClick={() => setTab('list')}>
              Back to List
            </button>
            <button className="btn btn-primary" onClick={handleCreateUser} disabled={savingUser}>
              {savingUser ? 'Creating…' : 'Create User'}
            </button>
          </div>
        </div>
      )}

      {/* ── ROLE MANAGEMENT DIRECTORY MODAL ── */}
      {showRoleManager && (
        <div className="modal-overlay" onClick={() => setShowRoleManager(false)}>
          <div
            className="modal"
            style={{ maxWidth: 1040, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <span className="modal-title">Role & Permissions Directory</span>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                  Manage system access levels for your organization
                </div>
              </div>
              <button className="modal-close" onClick={() => setShowRoleManager(false)}>
                ✕
              </button>
            </div>

            <div className="modal-body" style={{ overflowY: 'auto', flex: 1, padding: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
                <button className="btn btn-primary btn-sm" onClick={openCreateRole}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  Create Custom Role
                </button>
              </div>

              <div className={styles.rolesGrid}>
                {allRoles.map((role) => (
                  <div key={role._id} className={`card ${styles.roleCard}`}>
                    <div className={styles.roleHeader}>
                      <div className={styles.roleIcon}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2">
                          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                        </svg>
                      </div>
                      <div>
                        <div className={styles.roleName}>{role.name}</div>
                        <span
                          className={`badge ${role.type === 'system' ? 'badge-gray' : 'badge-blue'}`}
                          style={{ fontSize: 10 }}
                        >
                          {role.type}
                        </span>
                      </div>
                    </div>

                    <div className={styles.roleDesc}>{role.desc}</div>

                    <div className={styles.roleUsers}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                      </svg>
                      {role.users} users
                    </div>

                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', marginTop: 8 }}>
                      Permissions:
                    </div>
                    <div className={styles.perms} style={{ marginTop: 6 }}>
                      {role.perms.slice(0, 3).map((p) => (
                        <span key={p} className={`${styles.permTag} ${PERM_BADGE[p] || 'badge-gray'}`}>
                          {p}
                        </span>
                      ))}
                      {role.perms.length > 3 && (
                        <span className={styles.permTag} style={{ background: '#F1F5F9', color: 'var(--muted)' }}>
                          +{role.perms.length - 3} more
                        </span>
                      )}
                    </div>

                    <div className={styles.roleActions} style={{ marginTop: 12 }}>
                      <button className={styles.actBtn} onClick={() => openEditRole(role)}>
                        Edit
                      </button>
                      <button className={styles.actBtn} onClick={() => duplicateRole(role)}>
                        Duplicate
                      </button>
                      {role.type === 'custom' && (
                        <button
                          className={`${styles.actBtn} ${styles.actDel}`}
                          onClick={(e) => removeRole(e, role._id)}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── CREATE / EDIT ROLE MODAL ── */}
      {roleModal && (
        <div className="modal-overlay" onClick={closeRoleModal}>
          <div className="modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">{roleModal === 'edit' ? 'Edit Role' : 'Create Custom Role'}</span>
              <button className="modal-close" onClick={closeRoleModal}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              {roleModal === 'edit' && editingRole?.type === 'system' && (
                <div
                  style={{
                    padding: '10px 14px',
                    background: '#FFF7ED',
                    borderRadius: 8,
                    fontSize: 12,
                    color: '#92400E',
                    marginBottom: 16,
                    borderLeft: '3px solid #D97706',
                  }}
                >
                  System roles are read-only. Duplicate this role to create a custom variant.
                </div>
              )}

              <div className="form-group">
                <label className="form-label">Role Name *</label>
                <input
                  className="form-input"
                  value={roleForm.name}
                  style={{ border: roleError ? '1px solid #DC2626' : undefined }}
                  onChange={(e) => {
                    setRoleForm((f) => ({ ...f, name: e.target.value }))
                    if (roleError) setRoleError('')
                  }}
                  placeholder="e.g. Laboratory Supervisor"
                  disabled={roleModal === 'edit' && editingRole?.type === 'system'}
                />
                {roleError && (
                  <div style={{ color: '#DC2626', fontSize: 12, marginTop: 4, fontWeight: 500 }}>
                    {roleError}
                  </div>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">Description</label>
                <input
                  className="form-input"
                  value={roleForm.desc}
                  onChange={(e) => setRoleForm((f) => ({ ...f, desc: e.target.value }))}
                  placeholder="Describe what this role can do"
                  disabled={roleModal === 'edit' && editingRole?.type === 'system'}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Permissions</label>
                <div className={styles.permGrid}>
                  {PERM_OPTIONS.map((p) => {
                    const isChecked = roleForm.perms.includes(p)
                    const isDisabled = roleModal === 'edit' && editingRole?.type === 'system'

                    return (
                      <label
                        key={p}
                        className={`${styles.permCheck2} ${isChecked ? styles.permChecked : ''}`}
                        style={{ cursor: isDisabled ? 'not-allowed' : 'pointer' }}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => !isDisabled && toggleRolePerm(p)}
                          style={{ display: 'none' }}
                          disabled={isDisabled}
                        />
                        <span className={styles.permCheckBox}>
                          {isChecked && (
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </span>
                        {p}
                      </label>
                    )
                  })}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={closeRoleModal}>
                Cancel
              </button>
              {!(roleModal === 'edit' && editingRole?.type === 'system') ? (
                <button className="btn btn-primary" onClick={saveRole}>
                  {roleModal === 'edit' ? 'Save Changes' : 'Create Role'}
                </button>
              ) : (
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    duplicateRole(editingRole)
                    closeRoleModal()
                  }}
                >
                  Duplicate & Customize
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── ASSIGN CLINIC MODAL ── */}
      {assignModalUser && (
        <div className="modal-overlay" onClick={() => setAssignModalUser(null)}>
          <div className="modal" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Assign Clinic</span>
              <button className="modal-close" onClick={() => setAssignModalUser(null)}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 13, marginBottom: 16, color: 'var(--muted)' }}>
                Assigning clinic for <strong style={{ color: 'var(--text)' }}>{assignModalUser.fullName}</strong> (
                {assignModalUser.email})
              </p>
              <div className="form-group">
                <label className="form-label">Select Clinic</label>
                <select
                  className="form-select"
                  value={assignClinicId}
                  onChange={(e) => setAssignClinicId(e.target.value)}
                >
                  <option value="">— Remove clinic assignment —</option>
                  {clinics
                    .filter((cl) => cl.status === 'open')
                    .map((cl) => (
                      <option key={cl._id} value={cl._id}>
                        {cl.name.replace('Hi-Precision Diagnostics - ', '')}
                      </option>
                    ))}
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setAssignModalUser(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleAssign} disabled={assigning}>
                {assigning ? 'Saving…' : 'Save Assignment'}
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
              <span className="modal-title">Deactivate User</span>
              <button className="modal-close" onClick={() => setDeactivateTarget(null)}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>
                Are you sure you want to deactivate{' '}
                <strong style={{ color: 'var(--text)' }}>{deactivateTarget.fullName}</strong>? They will no longer be
                able to log in.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setDeactivateTarget(null)}>
                Cancel
              </button>
              <button
                className="btn btn-sm"
                style={{
                  background: 'var(--error)',
                  color: '#fff',
                  border: 'none',
                  padding: '8px 16px',
                  borderRadius: 6,
                }}
                onClick={() => handleDeactivate(deactivateTarget)}
              >
                Yes, Deactivate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── REACTIVATE CONFIRMATION MODAL ── */}
      {reactivateTarget && (
        <div className="modal-overlay" onClick={() => setReactivateTarget(null)}>
          <div className="modal" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Reactivate User</span>
              <button className="modal-close" onClick={() => setReactivateTarget(null)}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>
                Are you sure you want to reactivate{' '}
                <strong style={{ color: 'var(--text)' }}>{reactivateTarget.fullName}</strong>? They will regain
                access to log in.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setReactivateTarget(null)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={() => handleReactivate(reactivateTarget)}
                disabled={reactivating}
              >
                {reactivating ? 'Reactivating…' : 'Yes, Reactivate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
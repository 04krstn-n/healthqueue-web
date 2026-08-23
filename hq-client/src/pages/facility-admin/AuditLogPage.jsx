import { useState, useEffect, useCallback } from 'react'
import { auditLogsApi } from '../../services/api'
import styles from './facility-admin.module.css'

// The backend already scopes facility_admin requests to req.user.clinicId,
// so every entry here belongs to this admin's own clinic branch — no
// clinicId param is sent, and there's no cross-clinic data to filter out.
const ACTION_LABELS = {
  call: 'Called ticket',
  complete: 'Completed',
  no_show: 'Marked no-show',
  skip: 'Skipped',
  resolve: 'Resolved escalation',
  create: 'Created',
  update: 'Updated',
  deactivate: 'Deactivated',
  reactivate: 'Reactivated',
  delete: 'Deleted',
  login: 'Logged in',
  logout: 'Logged out',
}

const ACTION_BADGE = {
  call: 'badge-blue',
  complete: 'badge-green',
  no_show: 'badge-red',
  skip: 'badge-gray',
  resolve: 'badge-teal',
  create: 'badge-green',
  update: 'badge-blue',
  deactivate: 'badge-red',
  reactivate: 'badge-teal',
  delete: 'badge-red',
  login: 'badge-gray',
  logout: 'badge-gray',
}

const ACTION_FILTER_OPTIONS = [
  { value: 'all', label: 'All Actions' },
  { value: 'call', label: 'Called ticket' },
  { value: 'complete', label: 'Completed' },
  { value: 'no_show', label: 'Marked no-show' },
  { value: 'skip', label: 'Skipped' },
  { value: 'resolve', label: 'Resolved escalation' },
  { value: 'create', label: 'Created' },
  { value: 'update', label: 'Updated' },
  { value: 'deactivate', label: 'Deactivated' },
  { value: 'reactivate', label: 'Reactivated' },
  { value: 'delete', label: 'Deleted' },
  { value: 'login', label: 'Logged in' },
  { value: 'logout', label: 'Logged out' },
]

export default function AuditLogPage({ onBack }) {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [actionFilter, setActionFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 })

  const loadLogs = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await auditLogsApi.list({
        page,
        limit: 25,
        ...(actionFilter !== 'all' ? { action: actionFilter } : {}),
      })
      const body = res?.data ?? {}
      setLogs(Array.isArray(body.data) ? body.data : [])
      setPagination(body.pagination || { page: 1, pages: 1, total: 0 })
    } catch (e) {
      setError(e?.response?.data?.message || 'Failed to load audit logs.')
      setLogs([])
    } finally {
      setLoading(false)
    }
  }, [page, actionFilter])

  useEffect(() => {
    loadLogs()
  }, [loadLogs])

  const filteredLogs = logs.filter((log) => {
    if (!search.trim()) return true
    const q = search.trim().toLowerCase()
    return (
      log.actorName?.toLowerCase().includes(q) ||
      log.targetLabel?.toLowerCase().includes(q) ||
      log.targetType?.toLowerCase().includes(q)
    )
  })

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <div>
          <div className={styles.title}>Audit Log</div>
          <div className={styles.sub}>A record of staff and admin actions at your clinic</div>
        </div>
        <button className="btn btn-outline" onClick={onBack} style={{ display: 'flex', gap: 6, alignItems: 'center' }} >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          Back to Dashboard
        </button>
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
              placeholder="Search by staff or target..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className="dropdown-select"
            value={actionFilter}
            onChange={(e) => {
              setActionFilter(e.target.value)
              setPage(1)
            }}
          >
            {ACTION_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <button className="btn btn-outline btn-sm" onClick={loadLogs} disabled={loading}>
            Refresh
          </button>
        </div>

        {error && (
          <div style={{ padding: '10px 16px', color: 'var(--error)', fontSize: 13 }}>{error}</div>
        )}

        {/* Table */}
        <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Staff / Admin</th>
                <th>Action</th>
                <th>Target</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', padding: 32, color: 'var(--muted)' }}>
                    Loading audit logs…
                  </td>
                </tr>
              ) : filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', padding: 32, color: 'var(--muted)' }}>
                    No audit log entries found
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => (
                  <tr key={log._id}>
                    <td style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                      {log.createdAt
                        ? new Date(log.createdAt).toLocaleString('en-PH', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : '—'}
                    </td>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{log.actorName || '—'}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{log.actorRole || ''}</div>
                    </td>
                    <td>
                      <span className={`badge ${ACTION_BADGE[log.action] || 'badge-gray'}`}>
                        {ACTION_LABELS[log.action] || log.action}
                      </span>
                    </td>
                    <td style={{ fontSize: 13 }}>
                      {log.targetType}
                      {log.targetLabel ? `: ${log.targetLabel}` : ''}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination.pages > 1 && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              gap: 12,
              padding: '14px 0',
            }}
          >
            <button
              className="btn btn-outline btn-sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </button>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              Page {pagination.page} of {pagination.pages} ({pagination.total} entries)
            </span>
            <button
              className="btn btn-outline btn-sm"
              disabled={page >= pagination.pages}
              onClick={() => setPage((p) => Math.min(pagination.pages, p + 1))}
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

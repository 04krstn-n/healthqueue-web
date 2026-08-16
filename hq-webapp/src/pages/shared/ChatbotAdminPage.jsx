import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { chatbotAdminApi } from '../../services/api'
import styles from './ChatbotAdminPage.module.css'

const CATEGORIES = ['General Info', 'Queue Information', 'Appointments', 'Account', 'Clinic']

const CAT_BADGE = {
  'Queue Information': 'badge-blue',
  'Appointments': 'badge-green',
  'General Info': 'badge-teal',
  'Account': 'badge-purple',
  'Clinic': 'badge-orange',
}

const EMPTY_FORM = {
  question: '',
  answer: '',
  category: 'General Info',
  keywords: '',
  isActive: true,
}

export default function ChatbotAdminPage() {
  const [tab, setTab] = useState('Responses') // 'Responses' | 'Settings' | 'Analytics'
  const [faqs, setFaqs] = useState([])
  const [logs, setLogs] = useState([])
  const [analytics, setAnalytics] = useState(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('All')

  const [modal, setModal] = useState(null) // null | 'add' | 'edit'
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formErrors, setFormErrors] = useState({})
  const [saving, setSaving] = useState(false)
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

  // ─── Data Loaders ────────────────────────────────────────────────────────────
  const loadFAQs = useCallback(async () => {
    setLoading(true)
    try {
      const res = await chatbotAdminApi.getFAQs()
      setFaqs(Array.isArray(res?.data) ? res.data : [])
    } catch {
      showToast('Failed to load chatbot responses')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  const loadLogs = useCallback(async () => {
    try {
      const res = await chatbotAdminApi.getLogs()
      setLogs(Array.isArray(res?.data) ? res.data : [])
    } catch {
      setLogs([])
    }
  }, [])

  const loadAnalytics = useCallback(async () => {
    try {
      const res = await chatbotAdminApi.getAnalytics()
      setAnalytics(res?.data ?? null)
    } catch {
      setAnalytics(null)
    }
  }, [])

  useEffect(() => {
    loadFAQs()
  }, [loadFAQs])

  useEffect(() => {
    if (tab === 'Analytics') {
      loadLogs()
      loadAnalytics()
    }
  }, [tab, loadLogs, loadAnalytics])

  // ─── Modal & Form Handlers ───────────────────────────────────────────────────
  const openAdd = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setFormErrors({})
    setModal('add')
  }

  const openEdit = (faq) => {
    setEditing(faq)
    setForm({
      question: faq.question || '',
      answer: faq.answer || '',
      category: faq.category || 'General Info',
      keywords: Array.isArray(faq.keywords) ? faq.keywords.join(', ') : faq.keywords || '',
      isActive: faq.isActive ?? true,
    })
    setFormErrors({})
    setModal('edit')
  }

  const closeModal = () => {
    setModal(null)
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
    if (!form.question.trim()) {
      errors.question = 'Question / Intent is required'
    }
    if (!form.answer.trim()) {
      errors.answer = 'Answer is required'
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors)
      return
    }

    setSaving(true)
    try {
      const payload = {
        question: form.question.trim(),
        answer: form.answer.trim(),
        category: form.category,
        keywords: form.keywords,
        isActive: form.isActive,
      }

      if (editing?._id) {
        await chatbotAdminApi.updateFAQ(editing._id, payload)
        showToast('Response updated successfully')
      } else {
        await chatbotAdminApi.createFAQ(payload)
        showToast('Response added successfully')
      }

      closeModal()
      await loadFAQs()
    } catch (e) {
      showToast(e?.response?.data?.message || 'Failed to save response')
    } finally {
      setSaving(false)
    }
  }

  const handleRemove = async (id) => {
    if (!window.confirm('Are you sure you want to delete this response?')) return
    try {
      await chatbotAdminApi.deleteFAQ(id)
      showToast('Response deleted')
      await loadFAQs()
    } catch {
      showToast('Failed to delete response')
    }
  }

  const handleToggleActive = async (faq) => {
    try {
      await chatbotAdminApi.updateFAQ(faq._id, { isActive: !faq.isActive })
      showToast(faq.isActive ? 'Response disabled' : 'Response enabled')
      await loadFAQs()
    } catch {
      showToast('Failed to update response status')
    }
  }

  // ─── Memoized Selectors ───────────────────────────────────────────────────────
  const activeFAQsCount = useMemo(() => {
    return faqs.filter((f) => f.isActive).length
  }, [faqs])

  const filteredFAQs = useMemo(() => {
    const query = search.trim().toLowerCase()
    return faqs.filter((f) => {
      const matchCat = catFilter === 'All' || f.category === catFilter
      const matchSearch =
        !query ||
        f.question?.toLowerCase().includes(query) ||
        f.answer?.toLowerCase().includes(query) ||
        f.keywords?.some((k) => k.toLowerCase().includes(query))

      return matchCat && matchSearch
    })
  }, [faqs, search, catFilter])

  const monthlyLogsCount = useMemo(() => {
    const thirtyDaysAgo = Date.now() - 30 * 86400000
    return logs.filter((l) => new Date(l.createdAt || 0).getTime() > thirtyDaysAgo).length
  }, [logs])

  return (
    <div className={styles.page}>
      {toast && <div className={styles.toast}>{toast}</div>}

      {/* ── Page Header Card ── */}
      <div className={`card ${styles.pageHeader}`}>
        <div className={styles.headerLeft}>
          <div className={styles.headerIcon}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <div>
            <div className={styles.headerTitle}>Chatbot Administration</div>
            <div className={styles.headerSub}>Manage automated responses and chatbot settings</div>
          </div>
        </div>
        <div className={styles.statusBadge}>
          <span className={styles.statusDot} />
          Chatbot Status: <strong>Active</strong>
          <span className="badge badge-green" style={{ marginLeft: 6 }}>
            Active
          </span>
        </div>
      </div>

      {/* ── Tab Switcher ── */}
      <div className={styles.tabs}>
        {['Responses', 'Settings', 'Analytics'].map((t) => (
          <button
            key={t}
            className={`${styles.tab} ${tab === t ? styles.tabActive : ''}`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {/* ── RESPONSES TAB ── */}
      {tab === 'Responses' && (
        <>
          <div className={styles.toolbar}>
            <div className="search-bar" style={{ flex: 1, maxWidth: 320 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                placeholder="Search responses or keywords..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select
              className="dropdown-select"
              value={catFilter}
              onChange={(e) => setCatFilter(e.target.value)}
            >
              <option value="All">All Categories</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <button className="btn btn-outline btn-sm" onClick={loadFAQs} disabled={loading}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
              Refresh
            </button>
            <button className="btn btn-primary btn-sm" onClick={openAdd}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add Response
            </button>
          </div>

          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading responses…</div>
          ) : filteredFAQs.length === 0 ? (
            <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
              No responses found. Click "Add Response" to create one.
            </div>
          ) : (
            <div className={styles.faqList}>
              {filteredFAQs.map((faq) => (
                <div key={faq._id} className={`card ${styles.faqCard}`}>
                  <div className={styles.faqTop}>
                    <div className={styles.faqMeta}>
                      <span className={styles.faqQuestion}>{faq.question}</span>
                      <span className={`badge ${CAT_BADGE[faq.category] || 'badge-gray'}`}>{faq.category}</span>
                      <span className={`badge ${faq.isActive ? 'badge-green' : 'badge-gray'}`}>
                        {faq.isActive ? 'Active' : 'Disabled'}
                      </span>
                    </div>
                  </div>

                  {/* Keywords Tag List */}
                  {faq.keywords?.length > 0 && (
                    <div className={styles.keywordsRow}>
                      <span className={styles.kwLabel}>Keywords:</span>
                      {faq.keywords.map((k) => (
                        <span key={k} className={styles.kwTag}>
                          {k}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Answer Text */}
                  <div className={styles.faqAnswer}>{faq.answer}</div>

                  {/* Footer Actions */}
                  <div className={styles.faqFooter}>
                    <span className={styles.usageText}>Used {faq.usageCount || 0} times</span>
                    <div className={styles.faqActions}>
                      <button className={styles.actionBtn} onClick={() => openEdit(faq)}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                        Edit
                      </button>
                      <button className={styles.actionBtn} onClick={() => handleToggleActive(faq)}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="10" />
                          <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                        </svg>
                        {faq.isActive ? 'Disable' : 'Enable'}
                      </button>
                      <button className={`${styles.actionBtn} ${styles.actionDelete}`} onClick={() => handleRemove(faq._id)}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6l-1 14H6L5 6" />
                          <path d="M10 11v6M14 11v6" />
                        </svg>
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── SETTINGS TAB ── */}
      {tab === 'Settings' && (
        <div className="card" style={{ padding: 28 }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 20 }}>Chatbot Settings</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 480 }}>
            {[
              ['Chatbot Mode', 'FAQ Fallback (No Rasa server configured)'],
              ['Default Language', 'Filipino / English (Bilingual)'],
              ['Max Response Length', '500 characters'],
              ['Fallback Message', '"Sorry, I didn\'t understand. Please visit our reception desk."'],
            ].map(([label, value]) => (
              <div
                key={label}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '10px 0',
                  borderBottom: '1px solid var(--border-lt)',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-2)' }}>{label}</div>
                <div style={{ fontSize: 13, color: 'var(--muted)', maxWidth: 260, textAlign: 'right' }}>
                  {value}
                </div>
              </div>
            ))}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '10px 0',
                borderBottom: '1px solid var(--border-lt)',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-2)' }}>Active Responses</div>
              <span className="badge badge-green">
                {activeFAQsCount} / {faqs.length}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── ANALYTICS TAB ── */}
      {tab === 'Analytics' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14 }}>
            {[
              ['Total Responses', analytics?.totalFAQs ?? faqs.length, '#2563EB'],
              ['Active Responses', analytics?.activeFAQs ?? activeFAQsCount, '#16A34A'],
              ['Total Interactions', analytics?.totalLogs ?? logs.length, '#D97706'],
              ['This Month', monthlyLogsCount, '#7C3AED'],
            ].map(([label, val, color]) => (
              <div key={label} className="card" style={{ padding: '18px 20px' }}>
                <div style={{ fontSize: 24, fontWeight: 800, color }}>{val}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Most Used FAQs */}
          <div className="card" style={{ padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Most Used Responses</div>
            {(analytics?.topFAQs || faqs.slice(0, 5)).map((f, i) => (
              <div
                key={f._id || i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '8px 0',
                  borderBottom: '1px solid var(--border-lt)',
                }}
              >
                <span
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    background: '#EFF6FF',
                    color: '#2563EB',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 11,
                    fontWeight: 800,
                    flexShrink: 0,
                  }}
                >
                  {i + 1}
                </span>
                <div style={{ flex: 1, fontSize: 13 }}>{f.question}</div>
                <span className={`badge ${CAT_BADGE[f.category] || 'badge-gray'}`}>{f.category}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>
                  {f.usageCount || 0}x
                </span>
              </div>
            ))}
          </div>

          {/* Recent Interaction Logs */}
          {logs.length > 0 && (
            <div className="card" style={{ padding: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Recent Interactions</div>
              <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Patient</th>
                      <th>Message</th>
                      <th>Response</th>
                      <th>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.slice(0, 10).map((l) => (
                      <tr key={l._id}>
                        <td style={{ fontSize: 12 }}>{l.patient?.fullName || 'Anonymous'}</td>
                        <td style={{ fontSize: 12, maxWidth: 200 }}>
                          {l.message?.slice(0, 60)}
                          {l.message?.length > 60 ? '…' : ''}
                        </td>
                        <td style={{ fontSize: 12, maxWidth: 200 }}>
                          {l.response?.slice(0, 60)}
                          {l.response?.length > 60 ? '…' : ''}
                        </td>
                        <td style={{ fontSize: 11, color: 'var(--muted)' }}>
                          {new Date(l.createdAt).toLocaleTimeString('en-PH', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── ADD / EDIT MODAL ── */}
      {(modal === 'add' || modal === 'edit') && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" style={{ maxWidth: 500 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">{modal === 'edit' ? 'Edit Response' : 'Add New Response'}</div>
              <button className="modal-close" onClick={closeModal}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Question / Intent *</label>
                <input
                  className="form-input"
                  value={form.question}
                  style={{ border: formErrors.question ? '1px solid #DC2626' : undefined }}
                  onChange={(e) => handleFieldChange('question', e.target.value)}
                  placeholder="e.g. How do I book an appointment?"
                />
                {formErrors.question && (
                  <div style={{ color: '#DC2626', fontSize: 12, marginTop: 6, fontWeight: 500 }}>
                    {formErrors.question}
                  </div>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">Answer *</label>
                <textarea
                  className="form-textarea"
                  rows={4}
                  value={form.answer}
                  style={{ border: formErrors.answer ? '1px solid #DC2626' : undefined }}
                  onChange={(e) => handleFieldChange('answer', e.target.value)}
                  placeholder="Type the chatbot's response…"
                />
                {formErrors.answer && (
                  <div style={{ color: '#DC2626', fontSize: 12, marginTop: 6, fontWeight: 500 }}>
                    {formErrors.answer}
                  </div>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">Keywords</label>
                <input
                  className="form-input"
                  value={form.keywords}
                  onChange={(e) => handleFieldChange('keywords', e.target.value)}
                  placeholder="appointment, schedule, booking (comma-separated)"
                />
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                  Separate keywords with commas. The chatbot uses these to match patient messages.
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Category</label>
                <select
                  className="form-select"
                  value={form.category}
                  onChange={(e) => handleFieldChange('category', e.target.value)}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                  type="checkbox"
                  id="isActive"
                  checked={form.isActive}
                  onChange={(e) => handleFieldChange('isActive', e.target.checked)}
                  style={{ width: 16, height: 16 }}
                />
                <label htmlFor="isActive" style={{ fontSize: 13, color: 'var(--text-2)', cursor: 'pointer' }}>
                  Active (visible to patients)
                </label>
              </div>

              {/* Keyword preview */}
              {form.keywords.trim() && (
                <div style={{ padding: '10px 12px', background: 'var(--border-lt)', borderRadius: 8, marginTop: 4 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 6 }}>
                    Keyword preview:
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {form.keywords
                      .split(',')
                      .map((k) => k.trim())
                      .filter(Boolean)
                      .map((k) => (
                        <span key={k} className={styles.kwTag}>
                          {k}
                        </span>
                      ))}
                  </div>
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button className="btn btn-outline" onClick={closeModal}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : modal === 'edit' ? 'Save Changes' : 'Add Response'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
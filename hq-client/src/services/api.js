import axios from 'axios'

/**
 * HealthQueue+ Web API client
 *
 * The updated hq-server returns a mixture of:
 *   { success, data: [...] }
 *   { success, data: {...} }
 *   { success, ...metrics }
 *
 * List/detail helpers below normalize the `data` envelope so pages can
 * consume the actual records directly.
 */
const BASE = (import.meta.env.VITE_API_URL)
  .replace(/\/api\/?$/, '')
  .replace(/\/$/, '')

const api = axios.create({
  baseURL: BASE,
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('hq_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      const onLoginPage = window.location.pathname.startsWith('/login')
      if (!onLoginPage) {
        localStorage.removeItem('hq_token')
        localStorage.removeItem('hq_user')
        window.location.href = '/login'
      }
    }
    return Promise.reject(err)
  }
)

const unwrap = (response, fallback = null) => ({
  ...response,
  data: response?.data?.data ?? fallback,
})

// ── Auth ──────────────────────────────────────────────────────────────────────
export const authApi = {
  login: (email, password) => api.post('/api/auth/login', { email, password }),
  me: () => api.get('/api/auth/me'),
  logout: () => api.post('/api/auth/logout'),
}

// ── Health ────────────────────────────────────────────────────────────────────
export const healthApi = {
  check: () => api.get('/health'),
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
export const dashboardApi = {
  superAdmin: () => api.get('/api/dashboard/super-admin'),
  facility: (clinicId) => api.get('/api/dashboard/facility', { params: { clinicId } }),
}

// ── Clinics ───────────────────────────────────────────────────────────────────
export const clinicsApi = {
  list: () => api.get('/api/clinics').then(r => unwrap(r, [])),
  get: (id) => api.get(`/api/clinics/${id}`).then(r => unwrap(r, null)),
  create: (data) => api.post('/api/clinics', data).then(r => unwrap(r, null)),
  update: (id, data) => api.put(`/api/clinics/${id}`, data).then(r => unwrap(r, null)),
  delete: (id) => api.delete(`/api/clinics/${id}`),
  directory: () => api.get('/api/clinics/directory').then(r => unwrap(r, [])),
  recommend: (params) => api.get('/api/clinics/recommend', { params }),
}

// ── Users ─────────────────────────────────────────────────────────────────────
export const usersApi = {
  list: (params) =>
    api.get('/api/users', { params }),

  get: (id) =>
    api.get(`/api/users/${id}`),

  create: (data) =>
    api.post('/api/users', data),

  update: (id, data) =>
    api.put(`/api/users/${id}`, data),

  deactivate: (id) =>
    api.delete(`/api/users/${id}`),
}

// ── Staff ─────────────────────────────────────────────────────────────────────
export const staffApi = {
  list: (params) => api.get('/api/users', { params: { ...params, role: 'staff' } }),
  create: (data) => api.post('/api/users', data),
  update: (id, data) => api.put(`/api/users/${id}`, data),
  deactivate: (id) => api.delete(`/api/users/${id}`),
}

// ── Patients ──────────────────────────────────────────────────────────────────
export const patientsApi = {
  list: (params) => api.get('/api/patients', { params }).then(r => unwrap(r, [])),
  get: (id) => api.get(`/api/patients/${id}`).then(r => unwrap(r, null)),
  create: (data) => api.post('/api/patients', data),
  update: (id, data) => api.put(`/api/patients/${id}`, data),
  deactivate: (id) => api.delete(`/api/patients/${id}`),
}

// ── Services ──────────────────────────────────────────────────────────────────
export const servicesApi = {
  list: (clinicId) =>
    api.get('/api/services', { params: clinicId ? { clinicId } : undefined })
      .then(r => ({
        ...r,
        data: r.data?.services ?? [],
      })),
  add: (data) => api.post('/api/services', data),
  update: (clinicId, serviceId, data) =>
    api.put(`/api/services/${clinicId}/${serviceId}`, data),
  delete: (clinicId, serviceId) =>
    api.delete(`/api/services/${clinicId}/${serviceId}`),
}

// ── Queue ─────────────────────────────────────────────────────────────────────
export const queueApi = {
  list: (params) => api.get('/api/queues', { params }).then(r => unwrap(r, [])),
  metrics: (clinicId) =>
    api.get('/api/queues/metrics', { params: clinicId ? { clinicId } : undefined }),
  myStatus: () => api.get('/api/queues/my-status'),
  join: (data) => api.post('/api/queues/join', data),
  addWalkin: (data) => api.post('/api/queues/add-walkin', data),
  call: (id) => api.put(`/api/queues/${id}/call`),
  complete: (id) => api.put(`/api/queues/${id}/complete`),
  skip: (id) => api.put(`/api/queues/${id}/skip`),
  noShow: (id) => api.put(`/api/queues/${id}/no-show`),
  cancel: (id) => api.put(`/api/queues/${id}/cancel`),
}

// ── Appointments ──────────────────────────────────────────────────────────────
export const appointmentsApi = {
  list: (params) => api.get('/api/appointments', { params }).then(r => unwrap(r, [])),
  // The updated server's /today endpoint does not apply clinicId. Use the
  // normal scoped list endpoint with today's date for facility admins.
  today: (clinicId) => {
    const now = new Date()
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    return api.get('/api/appointments', {
      params: { date, ...(clinicId ? { clinicId } : {}) },
    }).then(r => unwrap(r, []))
  },
  my: () => api.get('/api/appointments/my').then(r => unwrap(r, [])),
  get: (id) => api.get(`/api/appointments/${id}`).then(r => unwrap(r, null)),
  book: (data) => api.post('/api/appointments', data),
  update: (id, data) => api.put(`/api/appointments/${id}`, data),
  cancel: (id, reason) => api.put(`/api/appointments/${id}/cancel`, { reason }),
  updateStatus: (id, status) => api.put(`/api/appointments/${id}/status`, { status }),
  availableSlots: (clinicId, date) =>
    api.get('/api/appointments/available-slots', { params: { clinicId, date } })
      .then(r => unwrap(r, [])),
}

// ── Time Slots ────────────────────────────────────────────────────────────────
export const timeSlotsApi = {
  list: (params) => api.get('/api/appointments/timeslots', { params }).then(r => unwrap(r, [])),
  create: (data) => api.post('/api/appointments/timeslots', data),
  update: (id, data) => api.put(`/api/appointments/timeslots/${id}`, data),
  delete: (id) => api.delete(`/api/appointments/timeslots/${id}`),
}

// ── Chatbot (Patient & Staff) ────────────────────────────────────────────────
export const chatbotApi = {
  // Patient interactions
  sendMessage: (message, sessionId) =>
    api.post('/api/chatbot/message', { message, sessionId }).then(r => unwrap(r, null)),

  escalate: (data) =>
    api.post('/api/chatbot/escalate', data).then(r => unwrap(r, null)),

  // Staff resolution
  resolveEscalation: (id, resolutionNotes) =>
    api.put(`/api/chatbot/resolve/${id}`, { resolutionNotes }).then(r => unwrap(r, null)),
}

// ── Chatbot Admin ─────────────────────────────────────────────────────────────
export const chatbotAdminApi = {
  getFAQs: (params) => api.get('/api/chatbot-admin/faqs', { params }).then(r => unwrap(r, [])),
  createFAQ: (data) => api.post('/api/chatbot-admin/faqs', data),
  updateFAQ: (id, data) => api.put(`/api/chatbot-admin/faqs/${id}`, data),
  deleteFAQ: (id) => api.delete(`/api/chatbot-admin/faqs/${id}`),
  getLogs: (params) => api.get('/api/chatbot-admin/logs', { params }).then(r => unwrap(r, [])),
  getEscalated: (params) => api.get('/api/chatbot-admin/escalated', { params }).then(r => unwrap(r, [])),
  getAnalytics: () => api.get('/api/chatbot-admin/analytics').then(r => unwrap(r, {})),
  getRasaStatus: () => api.get('/api/chatbot-admin/rasa-status'),
  test: (message) => api.post('/api/chatbot-admin/test', { message }),
}

// ── System Config ─────────────────────────────────────────────────────────────
export const systemConfigApi = {
  list: () =>
    api.get('/api/system-config'),

  getByKey: (key) =>
    api.get(`/api/system-config/key/${key}`),

  create: (data) =>
    api.post('/api/system-config', data),

  update: (id, value) =>
    api.put(`/api/system-config/${id}`, { value }),
}

// ── Analytics ─────────────────────────────────────────────────────────────────
export const analyticsApi = {
  aiInsights: (clinicId) =>
    api.get('/api/analytics/ai-insights', { params: { clinicId } }),
}

// ── Notifications ─────────────────────────────────────────────────────────────
export const notificationsApi = {
  list: () => api.get('/api/notifications').then(r => unwrap(r, [])),
  markRead: (id) => api.put(`/api/notifications/${id}/read`),
  markAllRead: () => api.put('/api/notifications/read-all'),
}

// ── Audit Logs ────────────────────────────────────────────────────────────────
export const auditLogsApi = {
  list: (params) => api.get('/api/audit-logs', { params }),
}

export default api

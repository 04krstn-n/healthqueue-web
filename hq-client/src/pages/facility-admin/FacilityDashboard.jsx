import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
} from 'recharts'
import { dashboardApi } from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import AuditLogPage from './AuditLogPage'
import styles from './facility-admin.module.css'

export default function FacilityDashboard() {
  const { user } = useAuth()
  const clinicId = user?.clinicId

  const [view, setView] = useState('dashboard') // 'dashboard' | 'audit-log'
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)

  // ─── Data Loading ────────────────────────────────────────────────────────────
  const loadDashboard = useCallback(async () => {
    if (!clinicId) {
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const response = await dashboardApi.facility(clinicId)
      // Handles both wrapped { success, data: {...} } and direct payload returns
      const payload = response?.data?.data ?? response?.data ?? null
      setStats(payload)
    } catch {
      setStats(null)
    } finally {
      setLoading(false)
    }
  }, [clinicId])

  useEffect(() => {
    loadDashboard()
  }, [loadDashboard])

  // ─── Memoized Metrics & Chart Data ───────────────────────────────────────────
  const {
    kpis,
    queueByService,
    pieData,
    weeklyTrend,
    recentActivity,
  } = useMemo(() => {
    const s = stats || {}

    // Trend calculation
    const trends = s.weeklyTrend || []
    let trendPct = 0
    if (trends.length >= 2) {
      const last = trends[trends.length - 1]?.count ?? 0
      const prev = trends[trends.length - 2]?.count ?? 0
      trendPct = prev > 0 ? Math.round(((last - prev) / prev) * 100) : 0
    }

    const todayPatients = s.todayPatients ?? 0
    const activeQueue = s.activeQueue ?? 0
    const avgWaitTime = s.avgWaitTime ?? 0
    const completedToday = s.completedToday ?? 0

    // KPI Card Definitions
    const kpis = [
      {
        label: 'Total Patients Today',
        value: todayPatients,
        sub: `${trendPct >= 0 ? '+' : ''}${trendPct}% from yesterday`,
        subColor: trendPct >= 0 ? '#16A34A' : '#EF4444',
        iconBg: '#2563EB',
        icon: (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
        ),
      },
      {
        label: 'In Queue',
        value: activeQueue,
        sub: 'Across all services',
        subColor: 'var(--muted)',
        iconBg: '#D97706',
        icon: (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        ),
      },
      {
        label: 'Avg. Wait Time',
        value: `${avgWaitTime} min`,
        sub: avgWaitTime <= 30 ? '−5 min from avg' : 'Above average',
        subColor: avgWaitTime <= 30 ? '#16A34A' : '#EF4444',
        iconBg: '#16A34A',
        icon: (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
            <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
          </svg>
        ),
      },
      {
        label: 'Consultations Done',
        value: completedToday,
        sub: `${activeQueue} patients in queue`,
        subColor: 'var(--muted)',
        iconBg: '#7C3AED',
        icon: (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
        ),
      },
    ]

    // Service Bar Chart
    const queueByService = (s.serviceDist || []).map((x) => ({
      name: x.name || x._id || 'Unknown',
      count: x.count || 0,
    }))

    // Patient Status Donut
    const waiting = activeQueue
    const serving = Math.max(0, todayPatients - completedToday - waiting)
    const pieData = [
      { name: 'Waiting', value: waiting, color: '#D97706' },
      { name: 'In Consultation', value: serving, color: '#2563EB' },
      { name: 'Completed', value: completedToday, color: '#16A34A' },
    ].filter((d) => d.value > 0)

    // Weekly Line Chart
    const weeklyTrend = trends.map((w) => ({
      day: w.day || '—',
      count: w.count || 0,
    }))

    // Activity Log
    const recentActivity = (s.recentActivity || []).map((a) => {
      let action = a.status || '—'
      let color = '#D97706'

      if (a.status === 'waiting') {
        action = 'Checked in'
        color = '#D97706'
      } else if (a.status === 'serving') {
        action = 'Consultation started'
        color = '#2563EB'
      } else if (a.status === 'completed' || a.status === 'done') {
        action = 'Completed'
        color = '#16A34A'
      }

      return {
        name: a.patientName || 'Anonymous',
        action,
        service: a.serviceName || '',
        time: a.joinedAt
          ? new Date(a.joinedAt).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })
          : '',
        color,
      }
    })

    return { kpis, queueByService, pieData, weeklyTrend, recentActivity }
  }, [stats])

  if (view === 'audit-log') {
    return <AuditLogPage onBack={() => setView('dashboard')} />
  }

  return (
    <div className={styles.page}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>Dashboard</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Overview for your clinic</div>
        </div>
        <button className="btn btn-outline" onClick={() => setView('audit-log')} style={{ display: 'flex', gap: 6, alignItems: 'center' }} >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="9" y1="15" x2="15" y2="15" />
            <line x1="9" y1="11" x2="15" y2="11" />
          </svg>
          View Audit Log
        </button>
      </div>

      {/* ── KPI Cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 20 }}>
        {kpis.map((card) => (
          <div key={card.label} className="card" style={{ padding: 20, display: 'flex', alignItems: 'center', gap: 16 }}>
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: 14,
                background: card.iconBg,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {card.icon}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>{card.label}</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--text)', lineHeight: 1 }}>
                {loading ? '…' : card.value}
              </div>
              <div style={{ fontSize: 11, color: card.subColor, marginTop: 4 }}>{card.sub}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Row 1: Queue by Service + Patient Status Donut ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 16, marginBottom: 16 }}>
        {/* Queue Status by Service (Bar Chart) */}
        <div className="card" style={{ padding: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', marginBottom: 16 }}>
            Queue Status by Service
          </div>
          {queueByService.length === 0 ? (
            <EmptyState loading={loading} label="No queue entries yet — add walk-ins to see data" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={queueByService} margin={{ top: 8, right: 8, left: -20, bottom: 50 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-20} textAnchor="end" interval={0} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="count" name="Patients" fill="#16A34A" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Patient Status Donut */}
        <div className="card" style={{ padding: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', marginBottom: 16 }}>
            Patient Status
          </div>
          {pieData.length === 0 ? (
            <EmptyState loading={loading} label="No patient data today" />
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
                <ResponsiveContainer width={180} height={180}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={52}
                      outerRadius={80}
                      paddingAngle={pieData.length > 1 ? 4 : 0}
                      dataKey="value"
                    >
                      {pieData.map((d, index) => (
                        <Cell key={`cell-${index}`} fill={d.color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {pieData.map((d) => (
                  <div
                    key={d.name}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: '50%',
                          background: d.color,
                          display: 'inline-block',
                        }}
                      />
                      <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{d.name}</span>
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{d.value}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Row 2: Weekly Trend + Recent Activity ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 16 }}>
        {/* Patient Traffic This Week */}
        <div className="card" style={{ padding: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', marginBottom: 16 }}>
            Patient Traffic (This Week)
          </div>
          {weeklyTrend.every((d) => d.count === 0) ? (
            <EmptyState loading={loading} label="No traffic data this week" />
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={weeklyTrend} margin={{ top: 8, right: 8, left: -20, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                <Line
                  type="monotone"
                  dataKey="count"
                  stroke="#2563EB"
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: '#2563EB', stroke: '#fff', strokeWidth: 2 }}
                  name="Patients"
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Recent Activity */}
        <div className="card" style={{ padding: 20 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 14,
            }}
          >
            <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>Recent Activity</span>
            <button
              className="btn btn-outline"
              style={{ fontSize: 11, padding: '3px 8px' }}
              onClick={loadDashboard}
              disabled={loading}
            >
              {loading ? '…' : 'Refresh'}
            </button>
          </div>
          {recentActivity.length === 0 ? (
            <EmptyState loading={loading} label="No activity recorded today" />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {recentActivity.map((a, index) => (
                <div key={index} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      background: a.color,
                      marginTop: 3,
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{a.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                      {a.action}
                      {a.service ? ` — ${a.service}` : ''}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>{a.time}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function EmptyState({ loading, label }) {
  return (
    <div
      style={{
        height: 180,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--muted)',
        fontSize: 13,
        fontStyle: 'italic',
        textAlign: 'center',
        padding: '0 16px',
      }}
    >
      {loading ? 'Loading…' : label}
    </div>
  )
}
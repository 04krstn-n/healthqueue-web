import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { dashboardApi } from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import styles from './facility-admin.module.css'

const PIE_COLORS = ['#2563EB', '#16A34A', '#D97706', '#7C3AED', '#DB2777', '#0D9488', '#EA580C']

const INSIGHT_THEMES = {
  warning: { bg: '#FFFBEB', border: '#FDE68A', icon: '⚠️' },
  success: { bg: '#DCFCE7', border: '#86EFAC', icon: '✅' },
  info: { bg: '#DBEAFE', border: '#93C5FD', icon: '💡' },
}

export default function FacilityReportsPage() {
  const { user } = useAuth()
  const clinicId = user?.clinicId

  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState('Last 7 Days')
  const [error, setError] = useState('')

  // ─── Data Loading ────────────────────────────────────────────────────────────
  const loadReports = useCallback(async () => {
    if (!clinicId) {
      setLoading(false)
      return
    }

    setLoading(true)
    setError('')

    try {
      const response = await dashboardApi.facility(clinicId)
      const payload = response?.data?.data ?? response?.data ?? null
      setStats(payload)
    } catch {
      setError('Failed to load facility analytics.')
    } finally {
      setLoading(false)
    }
  }, [clinicId])

  useEffect(() => {
    loadReports()
  }, [loadReports])

  // ─── Memoized Metric & Chart Selectors ─────────────────────────────────────────
  const {
    clinicName,
    weeklyTrend,
    hourlyData,
    distData,
    totalDist,
    waitByService,
    completionRate,
    avgWaitTime,
    todayPatients,
    activeQueue,
    completedToday,
    todayAppointments,
    peakHour,
    trendPct,
    insights,
  } = useMemo(() => {
    const s = stats || {}

    const weeklyTrend = (s.weeklyTrend || []).map((w) => ({
      date: w.day || '—',
      patients: w.count || 0,
    }))

    const hourlyData = s.hourlyData || []

    const distData = (s.serviceDist || []).map((svc, i) => ({
      name: svc.name || 'Unknown',
      value: svc.count || 1,
      color: PIE_COLORS[i % PIE_COLORS.length],
    }))

    const totalDist = distData.reduce((t, d) => t + d.value, 0)

    const waitByService = (s.serviceDist || []).map((svc, i) => ({
      name: svc.name?.length > 10 ? `${svc.name.slice(0, 10)}…` : svc.name || 'Service',
      wait: svc.avgWait || Math.round(15 + i * 3),
    }))

    const completionRate = s.completionRate ?? 0
    const avgWaitTime = s.avgWaitTime ?? 0
    const todayPatients = s.todayPatients ?? 0
    const activeQueue = s.activeQueue ?? 0
    const completedToday = s.completedToday ?? 0
    const todayAppointments = s.todayAppointments ?? 0

    // Peak hour calculation
    let peakHour = '—'
    if (hourlyData.length > 0) {
      const highest = hourlyData.reduce((a, b) => ((a.count || 0) > (b.count || 0) ? a : b), hourlyData[0])
      peakHour = highest?.hour || '—'
    }

    // Weekly Trend % vs previous day
    let trendPct = 0
    if (weeklyTrend.length >= 2) {
      const todayCount = weeklyTrend[weeklyTrend.length - 1]?.patients ?? 0
      const yesterCount = weeklyTrend[weeklyTrend.length - 2]?.patients ?? 0
      trendPct = yesterCount > 0 ? Math.round(((todayCount - yesterCount) / yesterCount) * 100) : 0
    }

    const insights = s.insights || []

    return {
      clinicName: s.clinicName || 'Facility',
      weeklyTrend,
      hourlyData,
      distData,
      totalDist,
      waitByService,
      completionRate,
      avgWaitTime,
      todayPatients,
      activeQueue,
      completedToday,
      todayAppointments,
      peakHour,
      trendPct,
      insights,
    }
  }, [stats])

  if (loading) {
    return <div style={{ padding: 60, textAlign: 'center', color: 'var(--muted)' }}>Loading analytics…</div>
  }

  if (error) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--error)' }}>
        {error}
        <button className="btn btn-primary" style={{ marginLeft: 12 }} onClick={loadReports}>
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      {/* ── Header ── */}
      <div className={styles.header}>
        <div>
          <div className={styles.title}>Prescriptive Analytics & Recommendations</div>
          <div className={styles.sub}>{clinicName}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>Date Range:</span>
          </div>

          <select className="form-select" style={{ width: 140 }} value={range} onChange={(e) => setRange(e.target.value)}>
            <option>Last 7 Days</option>
            <option>Last 30 Days</option>
            <option>Last 3 Months</option>
          </select>

          <button className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={loadReports}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Export Report
          </button>
        </div>
      </div>

      {/* ── KPI Cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 20 }}>
        <KPICard
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          }
          label="Avg. Daily Patients"
          value={todayPatients}
          trend={trendPct}
          trendLabel={`${trendPct >= 0 ? '+' : ''}${trendPct}%`}
          color="#2563EB"
        />

        <KPICard
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          }
          label="Avg. Wait Time"
          value={`${avgWaitTime} min`}
          trend={avgWaitTime > 30 ? -1 : 1}
          trendLabel={avgWaitTime > 30 ? 'Above target' : 'On target'}
          color="#16A34A"
        />

        <KPICard
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2">
              <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
            </svg>
          }
          label="Completion Rate"
          value={`${completionRate}%`}
          trend={completionRate >= 85 ? 1 : -1}
          trendLabel={completionRate >= 85 ? '+Good' : 'Below 85%'}
          color="#D97706"
        />

        <KPICard
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" strokeWidth="2">
              <line x1="18" y1="20" x2="18" y2="10" />
              <line x1="12" y1="20" x2="12" y2="4" />
              <line x1="6" y1="20" x2="6" y2="14" />
            </svg>
          }
          label="Peak Hour"
          value={peakHour}
          trend={0}
          trendLabel={`${activeQueue} active now`}
          color="#7C3AED"
        />
      </div>

      {/* ── Row 1: Patient Volume Trend + Service Distribution ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16, marginBottom: 16 }}>
        {/* Area Chart: Volume Trend */}
        <div className="card" style={{ padding: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', marginBottom: 16 }}>
            Patient Volume Trend
          </div>
          {weeklyTrend.every((d) => d.patients === 0) ? (
            <EmptyState label="No queue data this week" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={weeklyTrend} margin={{ top: 8, right: 8, left: -24, bottom: 4 }}>
                <defs>
                  <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#7C3AED" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#7C3AED" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                <Area
                  type="monotone"
                  dataKey="patients"
                  stroke="#7C3AED"
                  strokeWidth={2.5}
                  fill="url(#areaGrad)"
                  name="Patients"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Donut Chart: Service Distribution */}
        <div className="card" style={{ padding: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', marginBottom: 16 }}>
            Service Distribution
          </div>
          {distData.length === 0 ? (
            <EmptyState label="No service data" />
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ flex: '0 0 160px' }}>
                <ResponsiveContainer width={160} height={160}>
                  <PieChart>
                    <Pie
                      data={distData}
                      cx="50%"
                      cy="50%"
                      innerRadius={42}
                      outerRadius={72}
                      paddingAngle={distData.length > 1 ? 3 : 0}
                      dataKey="value"
                    >
                      {distData.map((d, i) => (
                        <Cell key={`cell-${i}`} fill={d.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ borderRadius: 8, fontSize: 12 }}
                      formatter={(v, name) => [
                        `${totalDist > 0 ? Math.round((v / totalDist) * 100) : 0}%`,
                        name,
                      ]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {distData.map((d) => {
                  const pct = totalDist > 0 ? Math.round((d.value / totalDist) * 100) : Math.round(100 / distData.length)
                  return (
                    <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: d.color, flexShrink: 0 }} />
                      <span style={{ flex: 1, fontSize: 12, color: 'var(--text-2)' }}>{d.name}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{pct}%</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Row 2: Average Wait Times + Hourly Traffic ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <div className="card" style={{ padding: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', marginBottom: 16 }}>
            Average Wait Times by Service
          </div>
          {waitByService.length === 0 ? (
            <EmptyState label="No service data" />
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={waitByService} margin={{ top: 8, right: 8, left: -24, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} unit=" min" />
                <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} formatter={(v) => [`${v} min`, 'Avg Wait']} />
                <Bar dataKey="wait" fill="#2563EB" radius={[4, 4, 0, 0]} name="Avg Wait (min)" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card" style={{ padding: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', marginBottom: 16 }}>
            Patient Traffic by Hour
          </div>
          {hourlyData.length === 0 ? (
            <EmptyState label="No queue entries recorded today" />
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={hourlyData} margin={{ top: 8, right: 8, left: -24, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="hour" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="count" fill="#16A34A" radius={[4, 4, 0, 0]} name="Patients" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ── Row 3: Performance Progress & AI Recommendations ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div className="card" style={{ padding: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', marginBottom: 16 }}>
            Today's Performance
          </div>
          {[
            { label: 'Completion Rate', value: completionRate, max: 100, unit: '%', good: 85 },
            { label: 'Active Queue', value: Math.min(activeQueue, 50), max: 50, unit: ` (${activeQueue})`, good: null },
          ].map((m) => (
            <div key={m.label} style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{m.label}</span>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: m.good && m.value >= m.good ? '#16A34A' : '#D97706',
                  }}
                >
                  {m.value}
                  {m.unit}
                </span>
              </div>
              <div style={{ height: 8, background: '#E2E8F0', borderRadius: 99, overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    borderRadius: 99,
                    transition: 'width 0.6s',
                    width: `${Math.min((m.value / m.max) * 100, 100)}%`,
                    background: m.good
                      ? m.value >= m.good
                        ? '#16A34A'
                        : m.value >= 60
                        ? '#D97706'
                        : '#EF4444'
                      : '#2563EB',
                  }}
                />
              </div>
            </div>
          ))}

          <div style={{ background: '#F8FAFC', borderRadius: 10, padding: 14, marginTop: 8 }}>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>Today's Summary</div>
            {[
              ['Patients Today', todayPatients],
              ['Completed', completedToday],
              ['Avg Wait', `${avgWaitTime} min`],
              ['Appointments', todayAppointments],
            ].map(([label, val]) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0' }}>
                <span style={{ color: 'var(--muted)' }}>{label}</span>
                <span style={{ fontWeight: 700, color: 'var(--text)' }}>{val}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card" style={{ padding: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', marginBottom: 4 }}>
            AI Recommendations
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 14 }}>
            Generated from real-time clinic data
          </div>
          {insights.length === 0 ? (
            <EmptyState label="No insights yet — add queue entries to generate recommendations" />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {insights.map((ins, i) => {
                const theme = INSIGHT_THEMES[ins.type] || INSIGHT_THEMES.info
                return (
                  <div
                    key={i}
                    style={{
                      background: theme.bg,
                      border: `1px solid ${theme.border}`,
                      borderRadius: 10,
                      padding: '10px 14px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                      <span style={{ fontSize: 13 }}>{theme.icon}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>{ins.title}</span>
                    </div>
                    <div style={{ fontSize: 12, color: '#475569', lineHeight: 1.5 }}>{ins.desc}</div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function KPICard({ icon, label, value, trend, trendLabel, color }) {
  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: `${color}18`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {icon}
        </div>
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: trend > 0 ? '#16A34A' : trend < 0 ? '#EF4444' : 'var(--muted)',
          }}
        >
          {trendLabel}
        </span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--text)' }}>{value}</div>
    </div>
  )
}

function EmptyState({ label }) {
  return (
    <div
      style={{
        height: 160,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--muted)',
        fontSize: 13,
        fontStyle: 'italic',
        textAlign: 'center',
      }}
    >
      {label}
    </div>
  )
}
import { useState, useEffect, useMemo } from 'react'
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { dashboardApi } from '../../services/api'
import styles from './super-admin.module.css'

const CHART_COLORS = ['#2563EB', '#16A34A', '#D97706', '#7C3AED', '#DB2777', '#0D9488']

const STATUS_BADGE_MAP = {
  waiting: 'badge-warn',
  serving: 'badge-blue',
  done: 'badge-green',
  completed: 'badge-green',
  cancelled: 'badge-gray',
  no_show: 'badge-red',
}

export default function SystemReportsPage() {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let isMounted = true

    async function loadReports() {
      setLoading(true)
      try {
        const res = await dashboardApi.superAdmin()
        if (!isMounted) return

        const data = res?.data?.data ?? res?.data ?? null
        setStats(data)
      } catch {
        if (isMounted) setStats(null)
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    loadReports()

    return () => {
      isMounted = false
    }
  }, [])

  // ─── Memoized Selectors & Computed Metrics ───────────────────────────────────
  const { summary, weeklyTrend, statusBreakdown, statusTotalCount } = useMemo(() => {
    const s = stats || {}

    const summary = [
      {
        label: 'Total Clinics',
        value: s.totalClinics ?? 0,
        sub: `${s.activeClinics ?? 0} active`,
      },
      {
        label: 'Total Users',
        value: s.totalUsers ?? 0,
        sub: `${s.totalPatients ?? 0} patients`,
      },
      {
        label: "Today's Queue",
        value: s.todayQueue ?? 0,
        sub: 'Across all facilities',
      },
      {
        label: "Today's Appointments",
        value: s.todayAppointments ?? 0,
        sub: 'Scheduled today',
      },
    ]

    const weeklyTrend = Array.isArray(s.weeklyTrend) ? s.weeklyTrend : []
    const statusBreakdown = Array.isArray(s.statusBreakdown) ? s.statusBreakdown : []
    const statusTotalCount = statusBreakdown.reduce((acc, row) => acc + (Number(row.count) || 0), 0)

    return {
      summary,
      weeklyTrend,
      statusBreakdown,
      statusTotalCount,
    }
  }, [stats])

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <div>
          <div className={styles.title}>System Reports</div>
          <div className={styles.sub}>Platform-wide analytics and statistics</div>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className={styles.statsRow}>
        {summary.map((card) => (
          <div key={card.label} className={`card ${styles.statCard}`}>
            <div className={styles.statLabel}>{card.label}</div>
            <div className={styles.statValue}>{loading ? '…' : card.value}</div>
            <div className={styles.statSub}>{card.sub}</div>
          </div>
        ))}
      </div>

      {/* Charts Grid */}
      <div className={styles.chartsRow}>
        {/* Weekly Queue Volume */}
        <div className={`card ${styles.chartBox}`}>
          <div className={styles.chartTitle}>Weekly Queue Volume (Last 7 Days)</div>
          {weeklyTrend.length === 0 ? (
            <EmptyState loading={loading} />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={weeklyTrend} margin={{ top: 8, right: 8, left: -24, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                <Line
                  type="monotone"
                  dataKey="count"
                  stroke="#2563EB"
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: '#2563EB', stroke: '#fff', strokeWidth: 2 }}
                  name="Volume"
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Queue Status Breakdown */}
        <div className={`card ${styles.chartBox}`}>
          <div className={styles.chartTitle}>Queue Status Breakdown (Today)</div>
          {statusBreakdown.length === 0 ? (
            <EmptyState loading={loading} />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={statusBreakdown} margin={{ top: 8, right: 8, left: -24, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="status" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]} name="Patients">
                  {statusBreakdown.map((_, i) => (
                    <Cell key={`cell-${i}`} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Status Breakdown Data Table */}
      <div className="card" style={{ padding: 20 }}>
        <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 14 }}>
          Queue Status Summary (Today)
        </div>

        {statusBreakdown.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '20px 0' }}>
            {loading ? 'Loading…' : 'No queue data today.'}
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Count</th>
                <th>Share</th>
              </tr>
            </thead>
            <tbody>
              {statusBreakdown.map((row) => {
                const count = Number(row.count) || 0
                const sharePercent =
                  statusTotalCount > 0 ? Math.round((count / statusTotalCount) * 100) : 0

                return (
                  <tr key={row.status}>
                    <td>
                      <span className={`badge ${STATUS_BADGE_MAP[row.status?.toLowerCase()] || 'badge-gray'}`}>
                        {row.status}
                      </span>
                    </td>
                    <td>
                      <strong>{count}</strong>
                    </td>
                    <td>{statusTotalCount > 0 ? `${sharePercent}%` : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function EmptyState({ loading }) {
  return (
    <div
      style={{
        height: 220,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--muted)',
        fontSize: 13,
      }}
    >
      {loading ? 'Loading…' : 'No data yet'}
    </div>
  )
}
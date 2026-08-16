export default function StatCard({ label, value, icon, color = 'primary', sub }) {
  const colorMap = {
    primary: { bg: 'var(--primary-lt)', fg: 'var(--primary)' },
    success: { bg: 'var(--success-lt)', fg: 'var(--success)' },
    warning: { bg: 'var(--warning-lt)', fg: 'var(--warning)' },
    error:   { bg: 'var(--error-lt)',   fg: 'var(--error)' },
    purple:  { bg: 'var(--purple-lt)',  fg: 'var(--purple)' },
    muted:   { bg: '#F1F5F9',           fg: 'var(--muted)' },
  }
  const { bg, fg } = colorMap[color] || colorMap.primary

  return (
    <div className="card flex items-center gap-4" style={{ padding: '18px 20px' }}>
      <div style={{
        width: 48, height: 48, borderRadius: 12,
        background: bg, display: 'flex', alignItems: 'center',
        justifyContent: 'center', flexShrink: 0, color: fg,
      }}>
        {icon}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.4px' }}>{label}</div>
        <div style={{ fontSize: 26, fontWeight: 800, color: fg, lineHeight: 1.2 }}>{value}</div>
        {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>}
      </div>
    </div>
  )
}

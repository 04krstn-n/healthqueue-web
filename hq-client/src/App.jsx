import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import AppLayout from './components/layout/AppLayout'

// Auth
import LoginPage from './pages/auth/LoginPage'

// Facility Admin
import FacilityDashboard  from './pages/facility-admin/FacilityDashboard'
import QueuePage           from './pages/facility-admin/QueuePage'
import QueueOversightPage  from './pages/facility-admin/QueueOversightPage'
import SchedulePage        from './pages/facility-admin/SchedulePage'
import StaffPage           from './pages/facility-admin/StaffPage'
import PatientsPage        from './pages/facility-admin/PatientsPage'
import ServicesPage        from './pages/facility-admin/ServicesPage'
import FacilityReportsPage from './pages/facility-admin/FacilityReportsPage'

// Super Admin
import SuperDashboard    from './pages/super-admin/SuperDashboard'
import ClinicsPage       from './pages/super-admin/ClinicsPage'
import UsersPage         from './pages/super-admin/UsersPage'
import SuperQueueOversightPage from './pages/super-admin/QueueOversightPage'
import SystemReportsPage from './pages/super-admin/SystemReportsPage'
import SystemConfigPage  from './pages/super-admin/SystemConfigPage'
import ClinicManagementPage from './pages/super-admin/ClinicManagementPage'

// Shared
import ChatbotAdminPage from './pages/shared/ChatbotAdminPage'

function ProtectedRoute({ children, allowedRoles }) {
  const { user, loading } = useAuth()
  if (loading) return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 14 }}>
      Loading…
    </div>
  )
  if (!user) return <Navigate to="/login" replace />
  if (allowedRoles && !allowedRoles.includes(user.role)) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}

function AppRoutes() {
  const { user } = useAuth()
  return (
    <Routes>
      {/* Public */}
      <Route path="/login" element={<LoginPage />} />

      {/* Facility Admin */}
      <Route
        path="/facility"
        element={
          <ProtectedRoute allowedRoles={['facility_admin']}>
            <AppLayout role="facility_admin" />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard"    element={<FacilityDashboard />} />
        <Route path="queue"        element={<QueuePage />} />
        <Route path="oversight"    element={<QueueOversightPage />} />
        <Route path="schedule"     element={<SchedulePage />} />
        <Route path="staff"        element={<StaffPage />} />
        <Route path="patients"     element={<PatientsPage />} />
        <Route path="services"     element={<ServicesPage />} />
        <Route path="reports"      element={<FacilityReportsPage />} />
        <Route path="chatbot"      element={<ChatbotAdminPage />} />
      </Route>

      {/* Super Admin */}
      <Route
        path="/super"
        element={
          <ProtectedRoute allowedRoles={['super_admin']}>
            <AppLayout role="super_admin" />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<SuperDashboard />} />
        <Route path="clinics"   element={<ClinicsPage />} />
        <Route path="users"     element={<UsersPage />} />
        <Route path="patients"  element={<PatientsPage />} />
        <Route path="queue"     element={<SuperQueueOversightPage />} />
        <Route path="reports"   element={<SystemReportsPage />} />
        <Route path="chatbot"   element={<ChatbotAdminPage />} />
        <Route path="config"    element={<SystemConfigPage />} />
        <Route path="clinic-management" element={<ClinicManagementPage />} />
      </Route>

      {/* Root redirect */}
      <Route
        path="/"
        element={
          user?.role === 'super_admin'
            ? <Navigate to="/super/dashboard" replace />
            : user?.role === 'facility_admin'
            ? <Navigate to="/facility/dashboard" replace />
            : <Navigate to="/login" replace />
        }
      />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}

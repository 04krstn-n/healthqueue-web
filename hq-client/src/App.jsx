import { useEffect, lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import AppLayout from './components/layout/AppLayout'

// Public
import LandingPage from './public/LandingPage'

// Auth
import LoginPage from './pages/auth/LoginPage'

// Facility Admin — lazy-loaded so each page's JS only downloads when visited
const FacilityDashboard  = lazy(() => import('./pages/facility-admin/FacilityDashboard'))
const QueuePage           = lazy(() => import('./pages/facility-admin/QueuePage'))
const QueueOversightPage  = lazy(() => import('./pages/facility-admin/QueueOversightPage'))
const SchedulePage        = lazy(() => import('./pages/facility-admin/SchedulePage'))
const StaffPage           = lazy(() => import('./pages/facility-admin/StaffPage'))
const PatientsPage        = lazy(() => import('./pages/facility-admin/PatientsPage'))
const ServicesPage        = lazy(() => import('./pages/facility-admin/ServicesPage'))
const FacilityReportsPage = lazy(() => import('./pages/facility-admin/FacilityReportsPage'))

// Super Admin — lazy-loaded
const SuperDashboard    = lazy(() => import('./pages/super-admin/SuperDashboard'))
const ClinicsPage       = lazy(() => import('./pages/super-admin/ClinicsPage'))
const UsersPage         = lazy(() => import('./pages/super-admin/UsersPage'))
const SuperQueueOversightPage = lazy(() => import('./pages/super-admin/QueueOversightPage'))
const SystemReportsPage = lazy(() => import('./pages/super-admin/SystemReportsPage'))
const SystemConfigPage  = lazy(() => import('./pages/super-admin/SystemConfigPage'))
const ClinicManagementPage = lazy(() => import('./pages/super-admin/ClinicManagementPage'))

// Shared — lazy-loaded
const ChatbotAdminPage = lazy(() => import('./pages/shared/ChatbotAdminPage'))

function PageLoader() {
  return (
    <div style={{ height: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 14 }}>
      Loading…
    </div>
  )
}

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
  const location = useLocation()

  useEffect(() => {
    document.title = location.pathname === '/' ? 'HealthQueue+' : 'HealthQueue+ Admin'
  }, [location.pathname])

  return (
    <Suspense fallback={<PageLoader />}>
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

        {/* Root — public landing page for guests, auto-redirect signed-in users to their dashboard */}
        <Route
          path="/"
          element={
            user?.role === 'super_admin'
              ? <Navigate to="/super/dashboard" replace />
              : user?.role === 'facility_admin'
              ? <Navigate to="/facility/dashboard" replace />
              : <LandingPage />
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
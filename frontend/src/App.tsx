import { lazy, Suspense, type ReactNode } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import Navbar from './components/Navbar'
import ProtectedRoute from './components/ProtectedRoute'

const HomePage = lazy(() => import('./pages/HomePage'))
const ResumePage = lazy(() => import('./pages/ResumePage'))
const JobDetailPage = lazy(() => import('./pages/JobDetailPage'))
const ProfilePage = lazy(() => import('./pages/ProfilePage'))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const PrivacyPage = lazy(() => import('./pages/PrivacyPage'))
const PrepareApplicationPage = lazy(() => import('./features/autofill/PrepareApplicationPage'))
const ControlledApplicationPage = lazy(() => import('./features/autofill/ControlledApplicationPage'))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'))
const InterviewPage = lazy(() => import('./pages/InterviewPage'))

function RouteFallback() {
  return <main className="route-loading" aria-busy="true" aria-label="Loading page" />
}

function RouteLoader({ children }: { children: ReactNode }) {
  return <Suspense fallback={<RouteFallback />}>{children}</Suspense>
}

export default function App() {
  const location = useLocation()
  const inInterviewRoom = /^\/interviews\/\d+$/.test(location.pathname)
  return (
    <Routes>
      {/* Public */}
      <Route path="/login" element={<RouteLoader><LoginPage /></RouteLoader>} />
      <Route path="/privacy" element={
        <>
          <Navbar />
          <RouteLoader><PrivacyPage /></RouteLoader>
        </>
      } />

      {/* Protected by sign in */}
      <Route path="/*" element={
        <ProtectedRoute>
          <>
            {!inInterviewRoom && <Navbar />}
            <RouteLoader>
            <Routes>
              <Route path="/"        element={<HomePage />} />
              <Route path="/resume"  element={<ResumePage />} />
              <Route path="/jobs/:id" element={<JobDetailPage />} />
              <Route path="/interviews" element={<InterviewPage />} />
              <Route path="/interviews/new/:jobId" element={<InterviewPage />} />
              <Route path="/interviews/:sessionId" element={<InterviewPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/application/prepare" element={<PrepareApplicationPage />} />
              <Route path="/application/preview" element={<ControlledApplicationPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
            </RouteLoader>
          </>
        </ProtectedRoute>
      } />
    </Routes>
  )
}

import { Routes, Route, useLocation } from 'react-router-dom'
import Navbar from './components/Navbar'
import ProtectedRoute from './components/ProtectedRoute'
import HomePage from './pages/HomePage'
import ResumePage from './pages/ResumePage'
import JobDetailPage from './pages/JobDetailPage'
import ProfilePage from './pages/ProfilePage'
import LoginPage from './pages/LoginPage'
import PrivacyPage from './pages/PrivacyPage'
import PrepareApplicationPage from './features/autofill/PrepareApplicationPage'
import ControlledApplicationPage from './features/autofill/ControlledApplicationPage'
import NotFoundPage from './pages/NotFoundPage'
import InterviewPage from './pages/InterviewPage'

export default function App() {
  const location = useLocation()
  const inInterviewRoom = /^\/interviews\/\d+$/.test(location.pathname)
  return (
    <Routes>
      {/* Public */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/privacy" element={
        <>
          <Navbar />
          <PrivacyPage />
        </>
      } />

      {/* Protected by sign in */}
      <Route path="/*" element={
        <ProtectedRoute>
          <>
            {!inInterviewRoom && <Navbar />}
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
          </>
        </ProtectedRoute>
      } />
    </Routes>
  )
}

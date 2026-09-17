import { Routes, Route } from 'react-router-dom'
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

export default function App() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />

      {/* Protected by sign in */}
      <Route path="/*" element={
        <ProtectedRoute>
          <>
            <Navbar />
            <Routes>
              <Route path="/"        element={<HomePage />} />
              <Route path="/resume"  element={<ResumePage />} />
              <Route path="/jobs/:id" element={<JobDetailPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/application/prepare" element={<PrepareApplicationPage />} />
              <Route path="/application/demo" element={<ControlledApplicationPage />} />
            </Routes>
          </>
        </ProtectedRoute>
      } />
    </Routes>
  )
}

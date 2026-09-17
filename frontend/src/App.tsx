import { Routes, Route } from 'react-router-dom'
import Navbar from './components/Navbar'
import ProtectedRoute from './components/ProtectedRoute'
import HomePage from './pages/HomePage'
import ResumePage from './pages/ResumePage'
import JobDetailPage from './pages/JobDetailPage'
import ProfilePage from './pages/ProfilePage'
import LoginPage from './pages/LoginPage'
import PrepareApplicationPage from './features/autofill/PrepareApplicationPage'

export default function App() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/login" element={<LoginPage />} />

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
            </Routes>
          </>
        </ProtectedRoute>
      } />
    </Routes>
  )
}

import { Route, Routes, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import ContractStudio from './pages/ContractStudio'
import Chains from './pages/Chains'
import Tokens from './pages/Tokens'
import Keeper from './pages/Keeper'
import Fees from './pages/Fees'
import Announcements from './pages/Announcements'
import Config from './pages/Config'
import Support from './pages/Support'
import Audit from './pages/Audit'
export default function App() {
  return <Routes>
    <Route path="/" element={<Login />} />
    <Route element={<Layout />}>
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/studio" element={<ContractStudio />} />
      <Route path="/chains" element={<Chains />} />
      <Route path="/tokens" element={<Tokens />} />
      <Route path="/keeper" element={<Keeper />} />
      <Route path="/fees" element={<Fees />} />
      <Route path="/announcements" element={<Announcements />} />
      <Route path="/config" element={<Config />} />
      <Route path="/support" element={<Support />} />
      <Route path="/audit" element={<Audit />} />
    </Route>
    <Route path="*" element={<Navigate to="/dashboard" replace />} />
  </Routes>
}

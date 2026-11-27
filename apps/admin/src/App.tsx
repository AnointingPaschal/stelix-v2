import { Route, Routes, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Login from './pages/Login'
import Launchpad from './pages/Launchpad'
import Dashboard from './pages/Dashboard'
import ContractStudio from './pages/ContractStudio'
import DeployPresets from './pages/DeployPresets'
import Multisig from './pages/Multisig'
import Chains from './pages/Chains'
import Tokens from './pages/Tokens'
import Keeper from './pages/Keeper'
import Fees from './pages/Fees'
import Announcements from './pages/Announcements'
import Config from './pages/Config'
import Support from './pages/Support'
import ContractAudit from './pages/ContractAudit'
import Maintenance from './pages/Maintenance'
import Security from './pages/Security'
import Cyber from './pages/Cyber'
import Circle from './pages/Circle'
import Audit from './pages/Audit'
export default function App() {
  return <Routes>
    <Route path="/" element={<Login />} />
    <Route element={<Layout />}>
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/studio" element={<ContractStudio />} />
      <Route path="/deploy-presets" element={<DeployPresets />} />
      <Route path="/multisig" element={<Multisig />} />
      <Route path="/launchpad" element={<Launchpad />} />
      <Route path="/chains" element={<Chains />} />
      <Route path="/tokens" element={<Tokens />} />
      <Route path="/keeper" element={<Keeper />} />
      <Route path="/fees" element={<Fees />} />
      <Route path="/announcements" element={<Announcements />} />
      <Route path="/config" element={<Config />} />
      <Route path="/maintenance" element={<Maintenance />} />
      <Route path="/security" element={<Security />} />
      <Route path="/cyber" element={<Cyber />} />
      <Route path="/support" element={<Support />} />
      <Route path="/contract-audit" element={<ContractAudit />} />
      <Route path="/circle" element={<Circle />} />
      <Route path="/audit" element={<Audit />} />
    </Route>
    <Route path="*" element={<Navigate to="/dashboard" replace />} />
  </Routes>
}

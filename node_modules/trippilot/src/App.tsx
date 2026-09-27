import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { useEffect, type ReactNode } from 'react'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { RoleGuard } from './auth/RoleGuard'
import { useAuth } from './auth/AuthContext'
import { TopNav } from './components/TopNav'
import { AppLayout } from './layouts/AppLayout'
import { OperatorAnalyticsPage } from './pages/operator/OperatorAnalyticsPage'
import { OperatorDashboardPage } from './pages/operator/OperatorDashboardPage'
import { OperatorDisruptionsPage } from './pages/operator/OperatorDisruptionsPage'
import { OperatorGroupsPage } from './pages/operator/OperatorGroupsPage'
import { OperatorPaymentsPage } from './pages/operator/OperatorPaymentsPage'
import { OperatorVendorsPage } from './pages/operator/OperatorVendorsPage'
import { OperatorMarketplacePage } from './pages/operator/OperatorMarketplacePage'
import { OperatorResourcesPage } from './pages/operator/OperatorResourcesPage'
import { BookingPage } from './pages/traveler/BookingPage'
import { CanvasPage } from './pages/traveler/CanvasPage'
import { GroupPage } from './pages/traveler/GroupPage'
import { EditItineraryPage } from './pages/traveler/EditItineraryPage'
import { BusinessTripsPage } from './pages/traveler/BusinessTripsPage'
import { CompletePage } from './pages/traveler/CompletePage'
import { ComposerPage } from './pages/traveler/ComposerPage'
import { CopilotPage } from './pages/traveler/CopilotPage'
import { DisruptionPage } from './pages/traveler/DisruptionPage'
import { OnboardingPage } from './pages/traveler/OnboardingPage'
import { PreparePage } from './pages/traveler/PreparePage'
import { TodayPage } from './pages/traveler/TodayPage'
import { TwinPage } from './pages/traveler/TwinPage'
import { WalletPage } from './pages/traveler/WalletPage'
import { SimulatorPage } from './pages/traveler/SimulatorPage'
import { LoginPage } from './pages/LoginPage'
import { RegisterPage } from './pages/RegisterPage'
import { VendorDashboardPage } from './pages/VendorDashboardPage'
import { ComponentsDevPage } from './pages/ComponentsDevPage'
import { CoordinatorSchedulePage } from './pages/CoordinatorSchedulePage'
import { AboutPage } from './pages/AboutPage'
import { HomePage } from './pages/HomePage'
import { AdminOverviewPage } from './pages/admin/AdminOverviewPage'
import { AdminUsersPage } from './pages/admin/AdminUsersPage'
import { AdminProvidersPage } from './pages/admin/AdminProvidersPage'
import { AdminAuditLogsPage } from './pages/admin/AdminAuditLogsPage'
import { AdminSettingsPage } from './pages/admin/AdminSettingsPage'
import { AdminTripReviewsPage } from './pages/admin/AdminTripReviewsPage'
import { AdminSafetyMapPage } from './pages/admin/AdminSafetyMapPage'
import { SafetyMapPage } from './pages/traveler/SafetyMapPage'
import { MapOperatorPage } from './pages/MapOperatorPage'
import { OperatorDigitalTwinPage } from './pages/operator/OperatorDigitalTwinPage'
import { subscribeToLiveTripUpdates } from './services/tripService'

function AppFrame() { useEffect(() => subscribeToLiveTripUpdates(), []); return <><TopNav /><main className="mx-auto max-w-6xl px-6 py-10"><Outlet /></main></> }
function RoleHome() { const { user } = useAuth(); if (!user) return <Navigate replace to="/login" />; if (user.role === 'traveler') return <Navigate replace to={user.onboardingComplete ? '/traveler/today' : '/traveler/onboarding'} />; if (user.role === 'admin') return <Navigate replace to="/admin/overview" />; return <Navigate replace to={user.role === 'operator' ? '/operator/dashboard' : user.role === 'coordinator' ? '/coordinator/schedule' : '/vendor'} /> }
function PublicOnly({ children }: { children: ReactNode }) { const { isAuthenticated } = useAuth(); const location = useLocation(); const returnToLanding = (location.state as { from?: string } | null)?.from === '/'; return isAuthenticated && !returnToLanding ? <RoleHome /> : children }

function App() {
  return <AppLayout><Routes>
    <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />
    <Route path="/register" element={<PublicOnly><RegisterPage /></PublicOnly>} />
    <Route path="/" element={<HomePage />} />
    <Route path="/about" element={<AboutPage />} />
    <Route element={<ProtectedRoute />}>
      <Route element={<AppFrame />}>
        <Route path="/dev/components" element={<ComponentsDevPage />} />
        <Route element={<RoleGuard allow="traveler" />}>
          <Route path="/traveler" element={<RoleHome />} />
          <Route path="/traveler/onboarding" element={<OnboardingPage />} />
          <Route path="/traveler/composer" element={<ComposerPage />} />
          <Route path="/traveler/canvas" element={<CanvasPage />} />
          <Route path="/traveler/wallet" element={<WalletPage />} />
          <Route path="/traveler/simulator" element={<SimulatorPage />} />
          <Route path="/traveler/twin" element={<TwinPage />} />
          <Route path="/traveler/copilot" element={<CopilotPage />} />
          <Route path="/traveler/disruption" element={<DisruptionPage />} />
          <Route path="/traveler/booking" element={<BookingPage />} />
          <Route path="/traveler/prepare" element={<PreparePage />} />
          <Route path="/traveler/group" element={<GroupPage />} />
          <Route path="/traveler/edit-itinerary" element={<EditItineraryPage />} />
          <Route path="/traveler/business" element={<BusinessTripsPage />} />
          <Route path="/traveler/today" element={<TodayPage />} />
          <Route path="/traveler/complete" element={<CompletePage />} />
          <Route path="/traveler/safety-map" element={<SafetyMapPage />} />
        </Route>
        <Route element={<RoleGuard allow="operator" />}>
          <Route path="/operator" element={<RoleHome />} />
          <Route path="/operator/dashboard" element={<OperatorDashboardPage />} />
          <Route path="/operator/disruptions" element={<OperatorDisruptionsPage />} />
          <Route path="/operator/vendors" element={<OperatorVendorsPage />} />
          <Route path="/operator/resources" element={<OperatorResourcesPage />} />
          <Route path="/operator/marketplace" element={<OperatorMarketplacePage />} />
          <Route path="/operator/groups" element={<OperatorGroupsPage />} />
          <Route path="/operator/payments" element={<OperatorPaymentsPage />} />
          <Route path="/operator/analytics" element={<OperatorAnalyticsPage />} />
          <Route path="/operator/digital-twin" element={<OperatorDigitalTwinPage />} />
          <Route path="/mapoperator" element={<MapOperatorPage />} />
        </Route>
        <Route element={<RoleGuard allow="coordinator" />}><Route path="/coordinator/schedule" element={<CoordinatorSchedulePage />} /></Route>
        <Route element={<RoleGuard allow="vendor" />}><Route path="/vendor" element={<VendorDashboardPage />} /></Route>
        <Route element={<RoleGuard allow="admin" />}>
          <Route path="/admin" element={<RoleHome />} />
          <Route path="/admin/overview" element={<AdminOverviewPage />} />
          <Route path="/admin/users" element={<AdminUsersPage />} />
          <Route path="/admin/trip-reviews" element={<AdminTripReviewsPage />} />
          <Route path="/admin/providers" element={<AdminProvidersPage />} />
          <Route path="/admin/audit-logs" element={<AdminAuditLogsPage />} />
          <Route path="/admin/settings" element={<AdminSettingsPage />} />
          <Route path="/admin/map" element={<AdminSafetyMapPage />} />
        </Route>
      </Route>
    </Route>
    <Route path="*" element={<RoleHome />} />
  </Routes></AppLayout>
}

export default App

export type AppRoute = { path: string; name: string; key: string }

export const travelerRoutes: AppRoute[] = [
  { path: '/traveler/onboarding', name: 'Plan My Trip', key: 'planMyTrip' },
  { path: '/traveler/composer', name: 'My Itinerary', key: 'myItinerary' },
]

export const travelerMoreRoutes: AppRoute[] = [
  { path: '/traveler/group', name: 'Group Trip', key: 'groupTrip' },
  { path: '/traveler/edit-itinerary', name: 'Edit Itinerary', key: 'editItinerary' },
  { path: '/traveler/business', name: 'Business Trips', key: 'businessTrips' },
  { path: '/traveler/prepare', name: 'Carry List', key: 'carryList' },
  { path: '/traveler/safety-map', name: 'Safety Map', key: 'safetyMap' },
]

export const operatorRoutes: AppRoute[] = [
  { path: '/operator/dashboard', name: 'Operator Dashboard', key: 'operatorDashboard' },
  { path: '/operator/disruptions', name: 'Operator Disruptions', key: 'operatorDisruptions' },
  { path: '/operator/vendors', name: 'Operator Vendors', key: 'operatorVendors' },
  { path: '/operator/marketplace', name: 'Operator Marketplace', key: 'operatorMarketplace' },
  { path: '/operator/payments', name: 'Operator Payments', key: 'operatorPayments' },
  { path: '/operator/analytics', name: 'Operator Analytics', key: 'operatorAnalytics' },
  { path: '/mapoperator', name: 'Red Zone Map', key: 'redZoneMap' },
]

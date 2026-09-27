export type UserRole = 'traveler' | 'operator' | 'vendor' | 'coordinator' | 'admin'

export type AuthUser = {
  id: string
  name: string
  email: string
  phone?: string
  role: UserRole
  onboardingComplete: boolean
  vendorId?: string
  currentLocation?: string
}

export type LoginCredentials = { email: string; password: string; role: UserRole; remember: boolean; currentLocation?: string }
export type RegisterPayload = { name: string; email: string; password: string; phone: string; role: UserRole; referredBy?: string }

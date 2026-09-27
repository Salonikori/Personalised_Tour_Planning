import { Role, type PrismaClient } from '@prisma/client'

export type NotificationPayload = { id: string; type: string; title: string; message: string; tripId: string | null; readAt: Date | null; createdAt: Date }
export type PublishNotification = (userId: string, notification: NotificationPayload) => void

type TripAlert = { tripId: string; type: string; title: string; message: string }

/** Persist an alert for the trip's traveler and every operator, then push it only to their SSE sessions. */
export async function notifyTripStakeholders(prisma: PrismaClient, publish: PublishNotification, alert: TripAlert) {
  const trip = await prisma.trip.findUnique({ where: { id: alert.tripId }, select: { userId: true } })
  if (!trip) return []
  const operators = await prisma.user.findMany({ where: { role: Role.OPERATOR }, select: { id: true } })
  const recipients = [...new Set([trip.userId, ...operators.map((operator) => operator.id)])]
  const notifications = await Promise.all(recipients.map((userId) => prisma.notification.create({ data: { userId, type: alert.type, title: alert.title, message: alert.message, tripId: alert.tripId } })))
  notifications.forEach((notification) => publish(notification.userId, notification))
  return notifications
}


export async function notifyUsers(prisma: PrismaClient, publish: PublishNotification, recipients: string[], alert: TripAlert) {
  const uniqueRecipients = [...new Set(recipients.filter(Boolean))]
  const notifications = await Promise.all(uniqueRecipients.map((userId) => prisma.notification.create({ data: { userId, type: alert.type, title: alert.title, message: alert.message, tripId: alert.tripId } })))
  notifications.forEach((notification) => publish(notification.userId, notification))
  return notifications
}

export async function notifySosStakeholders(prisma: PrismaClient, publish: PublishNotification, tripId: string, title: string, message: string) {
  const [trip, operators] = await Promise.all([
    prisma.trip.findUnique({ where: { id: tripId }, select: { userId: true, tourGroups: { select: { coordinatorId: true } } } }),
    prisma.user.findMany({ where: { role: Role.OPERATOR }, select: { id: true } }),
  ])
  if (!trip) return []
  const coordinatorIds = trip.tourGroups.map((group) => group.coordinatorId).filter((id): id is string => Boolean(id))
  return notifyUsers(prisma, publish, [trip.userId, ...coordinatorIds, ...operators.map((operator) => operator.id)], { tripId, type: 'SOS', title, message })
}

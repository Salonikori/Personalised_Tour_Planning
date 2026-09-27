import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getNotifications, markNotificationRead, subscribeToNotifications, type ApiNotification } from '../services/apiClient'

export function NotificationCenter() {
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState<ApiNotification[]>([])
  const { t } = useTranslation()
  useEffect(() => {
    void getNotifications().then(setNotifications).catch(() => undefined)
    return subscribeToNotifications((notification) => setNotifications((current) => [notification, ...current.filter((item) => item.id !== notification.id)]))
  }, [])
  const unread = notifications.filter((notification) => !notification.readAt).length
  const markRead = (notification: ApiNotification) => {
    if (notification.readAt) return
    void markNotificationRead(notification.id).then(() => setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, readAt: new Date().toISOString() } : item))).catch(() => undefined)
  }
  return <div className="notification-center"><button aria-expanded={open} aria-label={t('notifications.title')} className="notification-trigger" onClick={() => setOpen((value) => !value)} type="button">{t('notifications.alerts')}{unread > 0 && <b>{unread > 9 ? '9+' : unread}</b>}</button>{open && <div className="notification-popover"><strong>{t('notifications.alerts')}</strong>{notifications.length === 0 && <p>{t('notifications.none')}</p>}{notifications.map((notification) => <button className={notification.readAt ? 'notification-item' : 'notification-item is-unread'} key={notification.id} onClick={() => markRead(notification)} type="button"><span>{notification.title}</span><small>{notification.message}</small><time>{new Date(notification.createdAt).toLocaleString()}</time></button>)}</div>}</div>
}

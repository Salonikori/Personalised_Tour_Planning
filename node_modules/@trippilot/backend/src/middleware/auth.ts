import type { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import type { Role } from '@prisma/client'

type TokenPayload = { sub: string; role: Role }
declare global { namespace Express { interface Request { auth?: TokenPayload } } }

const secret = () => process.env.JWT_SECRET || 'trippilot-development-only-secret'
export function issueToken(userId: string, role: Role) { return jwt.sign({ sub: userId, role }, secret(), { expiresIn: '7d' }) }
export function verifyToken(token: string) { return jwt.verify(token, secret()) as TokenPayload }
export function requireAuth(request: Request, response: Response, next: NextFunction) {
  const token = request.header('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return response.status(401).json({ error: 'Authentication required.' })
  try { request.auth = verifyToken(token); next() } catch { return response.status(401).json({ error: 'Your session has expired. Please sign in again.' }) }
}
export function allowRoles(...roles: Role[]) { return (request: Request, response: Response, next: NextFunction) => request.auth && roles.includes(request.auth.role) ? next() : response.status(403).json({ error: 'You do not have access to this resource.' }) }

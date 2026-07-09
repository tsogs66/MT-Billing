import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';

const SECRET = process.env.JWT_SECRET || 'change-me-in-production';

export interface AuthedRequest extends Request {
  user?: { id: number; username: string; role: string };
}

export function signToken(payload: { id: number; username: string; role: string }) {
  return jwt.sign(payload, SECRET, { expiresIn: '12h' });
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'missing token' });
  try {
    req.user = jwt.verify(token, SECRET) as AuthedRequest['user'];
    next();
  } catch {
    return res.status(401).json({ error: 'invalid token' });
  }
}

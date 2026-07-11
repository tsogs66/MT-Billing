import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { db } from './db.js';
import { getLicenseStatus } from './extra.js';

const SECRET = process.env.JWT_SECRET || 'change-me-in-production';

export interface AuthedRequest extends Request {
  user?: { id: number; username: string; role: string };
}

export function signToken(payload: { id: number; username: string; role: string }) {
  return jwt.sign(payload, SECRET, { expiresIn: '12h' });
}

export function verifyToken(token: string): AuthedRequest['user'] {
  return jwt.verify(token, SECRET) as AuthedRequest['user'];
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'missing token' });
  try {
    req.user = verifyToken(token);
    next();
  } catch {
    return res.status(401).json({ error: 'invalid token' });
  }
}

/** Resolve permission list for a panel role name. */
export function permissionsForRole(roleName: string): string[] {
  if (!roleName) return ['dashboard', 'license'];
  if (roleName === 'superadmin' || roleName === 'admin') return ['*'];
  const row = db.prepare('SELECT permissions FROM roles WHERE name = ?').get(roleName) as
    | { permissions: string }
    | undefined;
  if (!row) {
    // Unknown role string — treat Administrator-like names as full access
    if (/admin/i.test(roleName)) return ['*'];
    return ['dashboard', 'license'];
  }
  try {
    const perms = JSON.parse(row.permissions || '[]');
    return Array.isArray(perms) ? perms : ['dashboard', 'license'];
  } catch {
    return ['dashboard', 'license'];
  }
}

export function userHasPermission(roleName: string, permission: string): boolean {
  const perms = permissionsForRole(roleName);
  if (perms.includes('*')) return true;
  return perms.includes(permission);
}

/** Build the session payload returned by /login and /me. */
export function sessionPayload(user: { id: number; username: string; role: string }) {
  const license = getLicenseStatus();
  const permissions = permissionsForRole(user.role);
  return {
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      permissions,
      licenseActivated: license.activated,
    },
    license: {
      activated: license.activated,
      expired: license.expired,
      expiresAt: license.expiresAt,
      duration: license.duration,
    },
  };
}

/**
 * After auth: if license is inactive, only allow dashboard + license (+ session) APIs.
 */
export function requireLicenseOrAllowlist(req: AuthedRequest, res: Response, next: NextFunction) {
  const license = getLicenseStatus();
  if (license.activated) return next();

  const path = (req.path || '').replace(/^\/api/, '') || req.url.split('?')[0];
  const allow = [
    /^\/me$/,
    /^\/license(\/|$)/,
    /^\/dashboard(\/|$)/,
    /^\/company\/branding$/,
    /^\/settings\/app$/,
    /^\/health$/,
    /^\/routers$/,
  ];
  if (allow.some((re) => re.test(path))) return next();

  return res.status(403).json({
    error: 'License required',
    code: 'LICENSE_REQUIRED',
    message: 'Activate the panel license to use this feature. Only Dashboard and License are available.',
  });
}

import { decode } from 'next-auth/jwt';
import pool from '../db/pool';

export default async function auth(req: any, res: any, next: any) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const token = authHeader.split(' ')[1];
    const decoded = await decode({ token, secret: process.env.NEXTAUTH_SECRET! });
    if (!decoded || !decoded.email) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const result = await pool.query('SELECT id FROM senders WHERE email = $1', [decoded.email]);
    if (result.rowCount === 0) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    req.senderId = result.rows[0].id;
    next();
  } catch (err) {
    console.error('Auth error:', err);
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

export async function authEmailOnly(req: any, res: any, next: any) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const token = authHeader.split(' ')[1];
    const decoded = await decode({ token, secret: process.env.NEXTAUTH_SECRET! });
    if (!decoded || !decoded.email) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    req.userEmail = decoded.email;
    next();
  } catch (err) {
    console.error('Auth error:', err);
    return res.status(401).json({ error: 'Unauthorized' });
  }
}
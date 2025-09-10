// apps/backend/middleware/adminAuth.js
export function adminAuth() {
  const token = process.env.ADMIN_TOKEN || '';
  return (req, res, next) => {
    if (!token) return next(); // dev: без защиты
    const hdr = req.headers['authorization'] || '';
    if (hdr.startsWith('Bearer ') && hdr.slice(7) === token) return next();
    res.status(401).json({ error: 'Unauthorized' });
  };
}

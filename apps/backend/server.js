// apps/backend/server.js (ES-модуль)
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import express from 'express';
import dotenv from 'dotenv';
import fs from 'fs';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import feedbackRoutes from './routes/feedback.js';
import adminRoutes from './routes/admin.js';
import requestId from './middleware/requestId.js';
import { logger } from './utils/logger.js';
import onFinished from 'on-finished';

dotenv.config();
const app = express();

// Cкрываем технологический заголовок Express
app.disable('x-powered-by');

// Чтобы rateLimit корректно считал IP за прокси (Replit/PAAS)
app.set('trust proxy', 1);

// ---- GZIP ----
app.use(compression());

// ---- Rate limit для /feedback ----
const listLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 минута
  limit: 120,          // до 120 запросов в минуту на IP
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/feedback', listLimiter);

// ---- CORS ----
const allowed = new Set(
  (process.env.CORS_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
);

const corsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // Postman/cURL
    if (allowed.size === 0 || allowed.has(origin)) return cb(null, true);
    return cb(new Error(`Not allowed by CORS: ${origin}`));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-token'],
  credentials: true,
  maxAge: 600
};

app.use(cors(corsOptions));

// request id + access log
app.use(requestId());
app.use((req, res, next) => {
  const start = Date.now();
  logger.info(req.id, '📥 request:start', {
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    ua: req.headers['user-agent']
  });
  onFinished(res, () => {
    const dur = Date.now() - start;
    logger.info(req.id, '📤 request:finish', {
      status: res.statusCode,
      duration_ms: dur
    });
  });
  next();
});

// Универсальная обработка preflight
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    const origin = req.headers.origin;
    if (!origin || allowed.size === 0 || allowed.has(origin)) {
      res.header('Access-Control-Allow-Origin', origin || '*');
      res.header('Vary', 'Origin');
      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-token');
      res.header('Access-Control-Max-Age', '600');
      return res.sendStatus(204);
    }
  }
  next();
});

// health
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// JSON-парсер — только для JSON (multipart — в multer)
app.use((req, res, next) => {
  if (req.is && req.is('application/json')) {
    express.json({ limit: '1mb' })(req, res, next);
  } else {
    next();
  }
});

// Swagger
const swaggerDocument = JSON.parse(fs.readFileSync('./swagger.json', 'utf8'));
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// Root: короткая справка
app.get('/', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    name: 'Feedbacker API',
    health: '/health',
    docs: '/docs',
    version: process.env.npm_package_version || '1.0.0'
  });
});

// --- РОУТЫ ---
app.use('/admin', adminRoutes);     // админка (статика + API)
app.use('/feedback', feedbackRoutes);

// Запуск
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  const external = process.env.RENDER_EXTERNAL_URL || `http://${HOST}:${PORT}`;
  console.log(`✅ Feedbacker API работает: ${external}`);
});

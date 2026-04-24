import { Router, Request, Response } from 'express';
import { adminKeyAuth } from '../middleware/auth';

const router = Router();

// In-memory metrics storage (simple implementation)
// In production, this would use Redis or another persistent store
interface MetricsData {
  requests: {
    total: number;
    success: number;
    error: number;
    byEndpoint: Record<string, number>;
  };
  performance: {
    avgResponseTime: number;
    maxResponseTime: number;
    minResponseTime: number;
    responseTimes: number[];
  };
  sefaz: {
    avgResponseTime: number;
    requests: number;
    errors: number;
    timeouts: number;
  };
  lastReset: Date;
}

const metrics: MetricsData = {
  requests: {
    total: 0,
    success: 0,
    error: 0,
    byEndpoint: {},
  },
  performance: {
    avgResponseTime: 0,
    maxResponseTime: 0,
    minResponseTime: Infinity,
    responseTimes: [],
  },
  sefaz: {
    avgResponseTime: 0,
    requests: 0,
    errors: 0,
    timeouts: 0,
  },
  lastReset: new Date(),
};

// Cache configuration (10 seconds)
const CACHE_DURATION = 10000;
let cachedHealth: any = null;
let cachedHealthTime = 0;
let cachedPerformance: any = null;
let cachedPerformanceTime = 0;
let cachedEmissions: any = null;
let cachedEmissionsTime = 0;
let cachedErrors: any = null;
let cachedErrorsTime = 0;

// ===========================================================================
// Middleware to track metrics
// ===========================================================================

export function trackMetrics(req: Request, res: Response, next: () => void) {
  const start = Date.now();
  const endpoint = `${req.method} ${req.path}`;

  // Increment request counter
  metrics.requests.total++;
  metrics.requests.byEndpoint[endpoint] =
    (metrics.requests.byEndpoint[endpoint] || 0) + 1;

  // Track response
  const originalSend = res.send.bind(res);
  res.send = function (body: any) {
    const duration = Date.now() - start;

    // Update performance metrics
    metrics.performance.responseTimes.push(duration);
    if (metrics.performance.responseTimes.length > 100) {
      metrics.performance.responseTimes.shift(); // Keep only last 100
    }

    metrics.performance.avgResponseTime =
      metrics.performance.responseTimes.reduce((a, b) => a + b, 0) /
      metrics.performance.responseTimes.length;

    metrics.performance.maxResponseTime = Math.max(
      metrics.performance.maxResponseTime,
      duration
    );
    metrics.performance.minResponseTime = Math.min(
      metrics.performance.minResponseTime,
      duration
    );

    // Track success/error
    if (res.statusCode >= 200 && res.statusCode < 300) {
      metrics.requests.success++;
    } else {
      metrics.requests.error++;
    }

    return originalSend(body);
  };

  next();
}

// Function to record SEFAZ request metrics
export function recordSefazMetrics(duration: number, success: boolean, timeout = false) {
  metrics.sefaz.requests++;
  if (!success) metrics.sefaz.errors++;
  if (timeout) metrics.sefaz.timeouts++;

  // Update average response time
  const total = metrics.sefaz.avgResponseTime * (metrics.sefaz.requests - 1) + duration;
  metrics.sefaz.avgResponseTime = total / metrics.sefaz.requests;
}

// ===========================================================================
// GET /api/metrics/health - Status geral do sistema
// ===========================================================================

router.get('/health', (_req: Request, res: Response) => {
  const now = Date.now();

  // Check cache
  if (cachedHealth && now - cachedHealthTime < CACHE_DURATION) {
    return res.json(cachedHealth);
  }

  const uptime = process.uptime();
  const memoryUsage = process.memoryUsage();

  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: {
      seconds: Math.floor(uptime),
      formatted: formatUptime(uptime),
    },
    memory: {
      rss: formatBytes(memoryUsage.rss),
      heapTotal: formatBytes(memoryUsage.heapTotal),
      heapUsed: formatBytes(memoryUsage.heapUsed),
      external: formatBytes(memoryUsage.external),
    },
    metrics: {
      totalRequests: metrics.requests.total,
      successRate:
        metrics.requests.total > 0
          ? ((metrics.requests.success / metrics.requests.total) * 100).toFixed(2) + '%'
          : '0%',
      errorRate:
        metrics.requests.total > 0
          ? ((metrics.requests.error / metrics.requests.total) * 100).toFixed(2) + '%'
          : '0%',
    },
    sefaz: {
      status: metrics.sefaz.errors / Math.max(1, metrics.sefaz.requests) < 0.1 ? 'healthy' : 'degraded',
      avgResponseTime: Math.round(metrics.sefaz.avgResponseTime) + 'ms',
      totalRequests: metrics.sefaz.requests,
      errors: metrics.sefaz.errors,
      timeouts: metrics.sefaz.timeouts,
    },
  };

  // Update cache
  cachedHealth = health;
  cachedHealthTime = now;

  res.json(health);
});

// ===========================================================================
// GET /api/metrics/performance - Métricas de performance
// ===========================================================================

router.get('/performance', (_req: Request, res: Response) => {
  const now = Date.now();

  // Check cache
  if (cachedPerformance && now - cachedPerformanceTime < CACHE_DURATION) {
    return res.json(cachedPerformance);
  }

  const performance = {
    timestamp: new Date().toISOString(),
    api: {
      avgResponseTime: Math.round(metrics.performance.avgResponseTime) + 'ms',
      maxResponseTime: Math.round(metrics.performance.maxResponseTime) + 'ms',
      minResponseTime:
        metrics.performance.minResponseTime === Infinity
          ? '0ms'
          : Math.round(metrics.performance.minResponseTime) + 'ms',
      totalRequests: metrics.requests.total,
    },
    sefaz: {
      avgResponseTime: Math.round(metrics.sefaz.avgResponseTime) + 'ms',
      totalRequests: metrics.sefaz.requests,
      successRate:
        metrics.sefaz.requests > 0
          ? (
              ((metrics.sefaz.requests - metrics.sefaz.errors) / metrics.sefaz.requests) *
              100
            ).toFixed(2) + '%'
          : '0%',
    },
    endpoints: Object.entries(metrics.requests.byEndpoint)
      .map(([endpoint, count]) => ({ endpoint, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
  };

  // Update cache
  cachedPerformance = performance;
  cachedPerformanceTime = now;

  res.json(performance);
});

// ===========================================================================
// GET /api/metrics/emissions - Estatísticas de emissões (mock data)
// ===========================================================================

router.get('/emissions', (_req: Request, res: Response) => {
  const now = Date.now();

  // Check cache
  if (cachedEmissions && now - cachedEmissionsTime < CACHE_DURATION) {
    return res.json(cachedEmissions);
  }

  // Mock data - in production this would query actual database
  const emissions = {
    timestamp: new Date().toISOString(),
    today: {
      nfe: { total: 0, authorized: 0, rejected: 0, pending: 0 },
      nfce: { total: 0, authorized: 0, rejected: 0, pending: 0 },
    },
    week: {
      nfe: { total: 0, authorized: 0, rejected: 0, pending: 0 },
      nfce: { total: 0, authorized: 0, rejected: 0, pending: 0 },
    },
    month: {
      nfe: { total: 0, authorized: 0, rejected: 0, pending: 0 },
      nfce: { total: 0, authorized: 0, rejected: 0, pending: 0 },
    },
  };

  // Update cache
  cachedEmissions = emissions;
  cachedEmissionsTime = now;

  res.json(emissions);
});

// ===========================================================================
// GET /api/metrics/errors - Erros recentes
// ===========================================================================

router.get('/errors', (_req: Request, res: Response) => {
  const now = Date.now();

  // Check cache
  if (cachedErrors && now - cachedErrorsTime < CACHE_DURATION) {
    return res.json(cachedErrors);
  }

  const errors = {
    timestamp: new Date().toISOString(),
    total: metrics.requests.error,
    rate:
      metrics.requests.total > 0
        ? ((metrics.requests.error / metrics.requests.total) * 100).toFixed(2) + '%'
        : '0%',
    sefaz: {
      errors: metrics.sefaz.errors,
      timeouts: metrics.sefaz.timeouts,
      rate:
        metrics.sefaz.requests > 0
          ? ((metrics.sefaz.errors / metrics.sefaz.requests) * 100).toFixed(2) + '%'
          : '0%',
    },
    // Mock recent errors - in production this would be actual error log
    recent: [],
  };

  // Update cache
  cachedErrors = errors;
  cachedErrorsTime = now;

  res.json(errors);
});

// ===========================================================================
// POST /api/metrics/reset - Reset metrics (admin only)
// ===========================================================================

router.post('/reset', adminKeyAuth, (_req: Request, res: Response) => {
  metrics.requests.total = 0;
  metrics.requests.success = 0;
  metrics.requests.error = 0;
  metrics.requests.byEndpoint = {};
  metrics.performance.avgResponseTime = 0;
  metrics.performance.maxResponseTime = 0;
  metrics.performance.minResponseTime = Infinity;
  metrics.performance.responseTimes = [];
  metrics.sefaz.avgResponseTime = 0;
  metrics.sefaz.requests = 0;
  metrics.sefaz.errors = 0;
  metrics.sefaz.timeouts = 0;
  metrics.lastReset = new Date();

  // Clear caches
  cachedHealth = null;
  cachedPerformance = null;
  cachedEmissions = null;
  cachedErrors = null;

  res.json({ success: true, message: 'Metrics reset', timestamp: metrics.lastReset });
});

// ===========================================================================
// Helpers
// ===========================================================================

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

  return parts.join(' ');
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

export default router;

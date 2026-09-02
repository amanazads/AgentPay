import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server as SocketIO } from 'socket.io';
import env from './config/env.js';
import { testConnection } from './config/database.js';
import { testRedisConnection } from './config/redis.js';
import { validateEnvironment } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { killSwitchMiddleware } from './middleware/killSwitch.js';
import { logger } from './utils/logger.js';

// Route imports
import agentRoutes from './routes/agents.js';
import productRoutes from './routes/products.js';
import merchantRoutes from './routes/merchants.js';
import purchaseIntentRoutes from './routes/purchaseIntents.js';
import paymentRoutes from './routes/payments.js';
import approvalRoutes from './routes/approvals.js';
import auditRoutes from './routes/audit.js';
import aiRoutes from './routes/ai.js';
import simulationRoutes from './routes/simulations.js';
import securityTestRoutes from './routes/securityTests.js';
import systemRoutes from './routes/system.js';
import dashboardRoutes from './routes/dashboard.js';
import authRoutes from './routes/auth.js';
import preferencesRoutes from './routes/preferences.js';
import notificationRoutes from './routes/notifications.js';
import connectionRoutes from './routes/connections.js';
import merchantPortalRoutes from './routes/merchantPortal.js';
import buyerRoutes from './routes/buyerRoutes.js';
import simulationCommerceRoutes from './routes/simulationCommerce.js';
import webhookRoutes from './routes/webhooks.js';
import judgeRoutes from './routes/judge.js';

const app = express();
const httpServer = createServer(app);

// Socket.IO setup
const io = new SocketIO(httpServer, {
  cors: {
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl) or any localhost port
      if (!origin || /^http:\/\/localhost:\d+$/.test(origin) || /^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) {
        callback(null, true);
      } else {
        callback(null, true);
      }
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    credentials: true,
  },
});

// Attach io to app
app.set('io', io);

import cookieParser from 'cookie-parser';
import { authenticateUser } from './middleware/authMiddleware.js';

// ============================================
// Middleware
// ============================================
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || /^http:\/\/localhost:\d+$/.test(origin) || /^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) {
      callback(null, true);
    } else {
      callback(null, true);
    }
  },
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Global User Authentication extractor & Kill switch
app.use(authenticateUser);
app.use(killSwitchMiddleware);

// ============================================
// Routes
// ============================================
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'AgentPay Backend',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/preferences', preferencesRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/connections', connectionRoutes);
app.use('/api/buyer', buyerRoutes);
app.use('/api/merchant', merchantPortalRoutes);
app.use('/api/agents', agentRoutes);
app.use('/api/products', productRoutes);
app.use('/api/merchants', merchantRoutes);
app.use('/api/purchase-intents', purchaseIntentRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/approvals', approvalRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/simulations', simulationRoutes);
app.use('/api/security-tests', securityTestRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/simulation/commerce', simulationCommerceRoutes);
app.use('/api/demo/commerce', simulationCommerceRoutes);
app.use('/api/ai-commerce', simulationCommerceRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/judge', judgeRoutes);

// ============================================
// Error handling
// ============================================
app.use(notFoundHandler);
app.use(errorHandler);

// ============================================
// Socket.IO
// ============================================
io.on('connection', (socket) => {
  logger.info('Socket', `Client connected: ${socket.id}`);

  socket.on('join:agent', (agentId) => {
    socket.join(`agent:${agentId}`);
  });

  socket.on('join:approvals', () => {
    socket.join('approvals');
  });

  socket.on('join:dashboard', () => {
    socket.join('dashboard');
  });

  socket.on('disconnect', () => {
    logger.debug('Socket', `Client disconnected: ${socket.id}`);
  });
});

// ============================================
// Start server
// ============================================
async function start() {
  logger.info('Server', 'Starting AgentPay backend...');

  // Validate environment configuration
  const validation = validateEnvironment(env);
  if (!validation.valid) {
    if (env.isProduction) {
      logger.error('Server', `FATAL: Environment validation failed:\n- ${validation.errors.join('\n- ')}`);
      throw new Error(`Production environment startup validation failed:\n- ${validation.errors.join('\n- ')}`);
    } else {
      logger.warn('Server', `Environment configuration notices:\n- ${validation.errors.join('\n- ')}`);
    }
  } else {
    logger.info('Server', 'Configuration validation passed: required parameters present.');
  }

  // Test database connection
  const dbConnected = await testConnection();
  if (!dbConnected) {
    logger.warn('Server', 'PostgreSQL not available — some features will be limited');
  }

  // Test Redis connection
  const redisConnected = await testRedisConnection();
  if (!redisConnected) {
    logger.warn('Server', 'Redis not available — idempotency and caching will be limited');
  }

  // Check Razorpay keys
  if (!env.hasRazorpayKeys) {
    logger.warn('Server', 'Razorpay keys not configured — payments will use simulation mode');
  }

  httpServer.listen(env.PORT, () => {
    logger.info('Server', `AgentPay backend running on port ${env.PORT}`);
    logger.info('Server', `Environment: ${env.NODE_ENV}`);
    logger.info('Server', `Health check: http://localhost:${env.PORT}/api/health`);
  });
}

if (process.env.NODE_ENV !== 'test' && !process.env.JEST_WORKER_ID) {
  start().catch((err) => {
    logger.error('Server', 'Failed to start:', { error: err.message });
    process.exit(1);
  });
}

export { app, io };
export default app;

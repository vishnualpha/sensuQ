const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { testConnection } = require('./config/database');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const testRoutes = require('./routes/tests');
const configRoutes = require('./routes/config');
const reportRoutes = require('./routes/reports');
const { authenticateToken } = require('./middleware/auth');
const logger = require('./utils/logger');

const app = express();
const server = http.createServer(app);

// Dynamic CORS configuration
const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3001',
  'http://127.0.0.1:3001'
];

// Add ngrok or production URLs from environment
if (process.env.FRONTEND_URL) {
  allowedOrigins.push(process.env.FRONTEND_URL);
}
if (process.env.NGROK_URL) {
  allowedOrigins.push(process.env.NGROK_URL);
}

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);

    // Check if origin is in allowed list or is an ngrok URL
    if (allowedOrigins.indexOf(origin) !== -1 || origin.includes('.ngrok-free.app') || origin.includes('.ngrok.io')) {
      callback(null, true);
    } else {
      callback(null, true); // For now, allow all origins. Tighten this in production!
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
};

const io = socketIo(server, {
  cors: corsOptions
});

// Middleware
app.use(helmet());
app.use(cors(corsOptions));
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Make io available to routes
app.use((req, res, next) => {
  req.io = io;
  next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/tests', authenticateToken, testRoutes);
app.use('/api/config', authenticateToken, configRoutes);
app.use('/api/reports', authenticateToken, reportRoutes);

// Screenshot routes (no auth required, returns base64 data)
const screenshotRoutes = require('./routes/screenshots');
app.use('/api/screenshots', screenshotRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Serve static frontend files (for production/ngrok)
const frontendPath = path.join(__dirname, '..', 'dist');
app.use(express.static(frontendPath));

// SPA fallback - serve index.html for all non-API routes
app.get('*', (req, res) => {
  // Only serve index.html for non-API routes
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(frontendPath, 'index.html'));
  }
});

// Error handling
app.use((err, req, res, next) => {
  logger.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Socket.io connection handling
const activeCrawlers = new Map();

// Import crawler routes after activeCrawlers is defined
const crawlerRoutes = require('./routes/crawler');

io.on('connection', (socket) => {
  logger.info(`Client connected: ${socket.id}`);
  
  // Handle stop crawling and generate tests request
  socket.on('stopCrawlingAndGenerate', async (data) => {
    const { testRunId } = data;
    const crawler = global.activeCrawlers.get(testRunId);
    
    if (crawler) {
      await crawler.stopCrawlingAndGenerateTests();
    }
  });
  
  socket.on('disconnect', () => {
    logger.info(`Client disconnected: ${socket.id}`);
  });
});

// Make activeCrawlers available globally
global.activeCrawlers = activeCrawlers;

// Import crawler routes after activeCrawlers is defined
app.use('/api/crawler', authenticateToken, crawlerRoutes);

const PORT = process.env.PORT || 3001;

// Test database connection before starting server
async function startServer() {
  try {
    const dbConnected = await testConnection();
    if (!dbConnected) {
      console.error('❌ Failed to connect to database. Please check your DATABASE_URL in .env file');
      process.exit(1);
    }
    
    server.listen(PORT, () => {
      console.log('🚀 SensuQ Autonomous Testing Engine Backend');
      console.log(`📡 Server running on port ${PORT}`);
      console.log(`🌐 Frontend should connect to: http://localhost:${PORT}`);
      console.log('📊 Database: PostgreSQL connected');
      console.log('🔌 WebSocket: Ready for real-time updates');
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

module.exports = { app, io };
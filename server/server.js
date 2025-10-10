const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const http = require('http');
const socketIo = require('socket.io');
const { testConnection } = require('./config/database');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const testRoutes = require('./routes/tests');
const configRoutes = require('./routes/config');
const reportRoutes = require('./routes/reports');
const screenshotRoutes = require('./routes/screenshots');
const { authenticateToken } = require('./middleware/auth');
const logger = require('./utils/logger');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(helmet());
app.use(cors());
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
app.use('/api/crawler', authenticateToken, crawlerRoutes);
app.use('/api/reports', authenticateToken, reportRoutes);
app.use('/api/screenshots', screenshotRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
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
    const crawler = activeCrawlers.get(testRunId);
    
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
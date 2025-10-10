# SensuQ Autonomous Testing Engine

A production-ready AI-driven web application testing platform that automatically explores applications, generates test cases, and performs self-healing test execution across multiple browsers.

## 🚀 Features

### Core Capabilities
- **Autonomous Web Crawling**: Automatically discovers and explores web applications using Playwright
- **AI-Powered Test Generation**: Creates comprehensive test cases using configurable LLM providers
- **Self-Healing Execution**: Automatically fixes flaky tests with intelligent selector strategies
- **Cross-Browser Testing**: Supports Chrome, Firefox, Safari, and Edge browsers
- **Real-Time Monitoring**: Live test execution tracking with WebSocket updates
- **Comprehensive Reporting**: PDF and JSON export capabilities

### Security & Authentication
- **JWT-based Authentication**: Secure login system with role-based access control
- **Data Encryption**: All sensitive information (API keys, credentials) encrypted at rest
- **Admin Controls**: Restricted access to LLM configuration and user management

### Testing Types
- **Functional Testing**: Form submissions, navigation, user interactions
- **Accessibility Testing**: ARIA compliance, keyboard navigation, color contrast
- **Performance Testing**: Page load times, resource optimization

## 🏗️ Architecture

### Frontend (React + TypeScript)
- Modern React 18 with TypeScript
- Tailwind CSS for responsive design
- Socket.IO for real-time updates
- Lucide React for icons

### Backend (Node.js + Express)
- RESTful API with comprehensive endpoints
- PostgreSQL database with optimized schema
- Playwright integration for browser automation
- Winston logging for production monitoring

## 📋 Prerequisites

- **Node.js** 18+ 
- **PostgreSQL** 12+
- **npm** or **yarn**

## 🛠️ Installation

### 1. Clone and Install Dependencies

```bash
# Install frontend dependencies
npm install

# Install backend dependencies
cd server
npm install
cd ..
```

### 2. Database Setup

```bash
# Create PostgreSQL database
createdb sensuq_db

# Initialize database schema
cd server
npm run init-db
cd ..
```

### 3. Environment Configuration

Update `.env` file with your database credentials:

```env
# Database Configuration
DATABASE_URL=postgresql://your_username:your_password@localhost:5432/sensuq_db

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-change-in-production
JWT_EXPIRES_IN=24h

# Encryption Key
ENCRYPTION_KEY=your-encryption-key-change-in-production

# Server Configuration
PORT=3001
NODE_ENV=development
```

## 🚀 Running the Application

### Development Mode

```bash
# Start backend server (Terminal 1)
cd server
npm run dev

# Start frontend development server (Terminal 2)
npm run dev
```

### Production Mode

```bash
# Build frontend
npm run build

# Start backend in production
cd server
npm start
```

## 🔐 Default Login Credentials

- **Email**: `admin@sensuq.com`
- **Password**: `admin123`

**⚠️ Important**: Change default credentials in production!

## 📖 Usage Guide

### 1. LLM Configuration (Admin Only)

1. Navigate to **LLM Configuration**
2. Click **Add LLM Provider**
3. Configure your preferred LLM:
   - **OpenAI**: Requires API key
   - **Azure OpenAI**: Requires API key and endpoint
   - **Anthropic**: Requires API key
   - **AWS Bedrock**: Requires credentials
   - **Local/Self-hosted**: Configure custom endpoint

### 2. Test Configuration

1. Go to **Test Configurations**
2. Click **New Configuration**
3. Set up your test parameters:
   - **Target URL**: Application to test
   - **Credentials**: Login details if required
   - **Crawl Limits**: Max depth and pages
   - **Test Types**: Enable accessibility/performance testing
   - **LLM Selection**: Choose AI provider for test generation

### 3. Running Tests

1. Navigate to **Test Runs**
2. Select a configuration and start testing
3. Monitor real-time progress in the dashboard
4. View detailed results and download reports

### 4. User Management (Admin Only)

1. Access **Settings** → **User Management**
2. Create new users with appropriate roles
3. Manage access permissions

## 🗄️ Database Schema

### Core Tables

- **users**: Authentication and user management
- **llm_configs**: LLM provider configurations
- **test_configs**: Test configuration settings
- **test_runs**: Test execution tracking
- **discovered_pages**: Crawled page information
- **test_cases**: Generated and executed test cases

### Key Features

- **Encrypted sensitive data** (API keys, passwords)
- **Optimized indexes** for performance
- **Foreign key relationships** for data integrity
- **Audit trails** with timestamps

## 🔧 API Endpoints

### Authentication
- `POST /api/auth/login` - User login
- `POST /api/auth/register` - User registration (admin only)

### Configuration
- `GET /api/config/llm` - List LLM configurations
- `POST /api/config/llm` - Create LLM configuration
- `GET /api/config/test` - List test configurations
- `POST /api/config/test` - Create test configuration

### Test Execution
- `GET /api/tests/runs` - List test runs
- `GET /api/tests/runs/:id` - Get test run details
- `POST /api/crawler/start` - Start test execution
- `GET /api/crawler/status/:id` - Get execution status

### Reports
- `GET /api/reports/pdf/:id` - Download PDF report
- `GET /api/reports/json/:id` - Download JSON report

## 🧪 Testing Features

### Self-Healing Capabilities

- **Dynamic Selector Recovery**: Automatically finds alternative element selectors
- **Retry Logic**: Intelligent retry mechanisms for transient failures
- **Cross-Browser Validation**: Identifies browser-specific issues
- **Flaky Test Detection**: Marks and handles inconsistent test results

### Coverage Metrics

- **Flow Coverage**: Tracks application paths explored
- **Element Coverage**: Monitors UI component testing
- **Functionality Coverage**: Measures feature testing completeness

### Success Criteria

- ✅ **80%+ Coverage** of discovered application flows
- ✅ **<5% Flaky Test Rate** through self-healing
- ✅ **<10 Minutes** full regression execution
- ✅ **Zero Manual Scripting** required

## 🔒 Security Features

### Data Protection
- **AES Encryption** for sensitive data at rest
- **JWT Tokens** for secure authentication
- **Role-Based Access Control** (RBAC)
- **Input Validation** and sanitization

### Best Practices
- **Environment Variables** for configuration
- **Secure Headers** with Helmet.js
- **CORS Protection** configured
- **SQL Injection Prevention** with parameterized queries

## 📊 Monitoring & Logging

### Winston Logging
- **Error Logs**: `logs/error.log`
- **Combined Logs**: `logs/combined.log`
- **Console Output**: Development mode

### Real-Time Updates
- **Socket.IO Integration** for live progress
- **WebSocket Events** for test execution status
- **Dashboard Metrics** updated in real-time

## 🚀 Deployment

### Environment Setup

```bash
# Production environment variables
NODE_ENV=production
DATABASE_URL=postgresql://prod_user:prod_pass@prod_host:5432/sensuq_prod
JWT_SECRET=production-jwt-secret
ENCRYPTION_KEY=production-encryption-key
```

### Docker Deployment (Optional)

```dockerfile
# Dockerfile example
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
EXPOSE 3001
CMD ["npm", "start"]
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📝 License

This project is proprietary software developed for Advent Global Solutions.

## 🆘 Support

For technical support or questions:
- Check the logs in `server/logs/`
- Review database connections
- Verify environment variables
- Ensure PostgreSQL is running

## 🔄 Version History

- **v1.0.0** - Initial production release
- **Features**: Full autonomous testing engine with AI integration
- **Browsers**: Chrome, Firefox, Safari, Edge support
- **LLMs**: OpenAI, Azure, Anthropic, AWS Bedrock, Local models

---

**Built with ❤️ for Advent Global Solutions**
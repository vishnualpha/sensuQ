# Ngrok Setup Guide for SensuQ

## Overview

All hardcoded `localhost:3001` URLs have been replaced with dynamic URLs that automatically detect the correct API endpoint based on the browser's origin. This allows the app to work seamlessly with ngrok in multiple configurations.

## How It Works

### Frontend (Vite/React)
- **Development**: Uses `http://localhost:3001/api` when running locally
- **Production/Ngrok**: Uses `${window.location.origin}/api` when accessed via ngrok
- **Vite Proxy**: Proxies `/api` and `/socket.io` requests during development

### Backend (Express)
- Runs on port 3001
- CORS configured to accept ngrok URLs automatically (`.ngrok-free.app`, `.ngrok.io`)

## Ngrok Setup Options

### Option 1: Serve Only Backend (Recommended)

This is the simplest approach - serve only the backend through ngrok:

1. **Start your backend server**:
   ```bash
   cd server
   npm start
   # Server runs on port 3001
   ```

2. **Start ngrok for the backend**:
   ```bash
   ngrok http 3001
   ```

3. **Build and serve frontend from backend** (optional):
   ```bash
   # In project root
   npm run build
   # Copy build files to server/public
   cp -r dist/* server/public/
   ```

   Then update `server/server.js` to serve static files:
   ```javascript
   // Add this before your API routes
   app.use(express.static(path.join(__dirname, 'public')));

   // Add this after all API routes (catchall for SPA)
   app.get('*', (req, res) => {
     res.sendFile(path.join(__dirname, 'public', 'index.html'));
   });
   ```

4. **Access your app**:
   - Open the ngrok URL (e.g., `https://abc123.ngrok-free.app`)
   - The app will automatically use the ngrok URL for API calls

### Option 2: Serve Both Frontend and Backend (Separate ngrok URLs)

If you want to expose both frontend and backend through separate ngrok URLs:

1. **Start backend**:
   ```bash
   cd server
   npm start
   # Runs on port 3001
   ```

2. **Start frontend dev server**:
   ```bash
   npm run dev
   # Runs on port 5173
   ```

3. **Tunnel backend through ngrok** (Terminal 3):
   ```bash
   ngrok http 3001
   # Copy the URL, e.g., https://abc123.ngrok-free.app
   ```

4. **Set backend URL in .env**:
   ```bash
   # .env file
   VITE_BACKEND_URL=https://abc123.ngrok-free.app
   ```

5. **Restart frontend dev server** (to pick up env changes)

6. **Tunnel frontend through ngrok** (Terminal 4):
   ```bash
   ngrok http 5173
   # Copy the URL, e.g., https://xyz789.ngrok-free.app
   ```

7. **Access your app**:
   - Open the **frontend** ngrok URL: `https://xyz789.ngrok-free.app`
   - Vite proxy will forward API requests to backend ngrok URL
   - Both hot reload and API calls work!

### Option 3: Local Development (No ngrok)

Standard local development:

1. **Start backend**:
   ```bash
   cd server
   npm start
   # Runs on port 3001
   ```

2. **Start frontend**:
   ```bash
   npm run dev
   # Runs on port 5173
   ```

3. **Access**:
   - Frontend: `http://localhost:5173`
   - Backend: `http://localhost:3001`
   - Everything works automatically!

## Environment Variables

### Frontend (.env in project root)
```bash
# Option A: Explicitly set API URL (overrides auto-detection)
# Use this if your API is on a completely different domain
VITE_API_URL=https://backend-url.ngrok-free.app/api

# Option B: Set backend URL for Vite proxy (dev server only)
# Use this when running separate ngrok tunnels for frontend and backend
VITE_BACKEND_URL=https://backend-url.ngrok-free.app

# For most cases, leave both empty and let auto-detection work!
```

### Backend (server/.env)
```bash
# Optional: explicitly set allowed origins
NGROK_URL=https://your-ngrok-url.ngrok-free.app
FRONTEND_URL=http://localhost:5173

# These are optional - CORS auto-detects ngrok URLs
```

## Files Updated

1. **[src/services/api.ts](src/services/api.ts)** - Dynamic API base URL detection
2. **[src/contexts/SocketContext.tsx](src/contexts/SocketContext.tsx)** - Dynamic WebSocket URL
3. **[src/components/TestRunDetails.tsx](src/components/TestRunDetails.tsx)** - Dynamic screenshot URLs
4. **[server/server.js](server/server.js)** - CORS configuration for ngrok
5. **[vite.config.ts](vite.config.ts)** - Proxy configuration for dev server
6. **[.env](.env)** - Environment variable configuration

## Troubleshooting

### CORS Issues
If you encounter CORS errors:
1. Check that ngrok URL is being detected correctly
2. Look in browser console for the API URL being used
3. Add your ngrok URL to `server/.env`:
   ```bash
   NGROK_URL=https://your-url.ngrok-free.app
   ```

### WebSocket Connection Issues
- WebSockets should work automatically with ngrok
- Ensure you're using the ngrok HTTPS URL (not HTTP)

### Screenshot Loading Issues
- Screenshots now use the same dynamic URL logic
- Check browser console for the URL being fetched

## Production Deployment

For production deployment (not ngrok):

1. Set `VITE_API_URL` in frontend build environment
2. Build frontend: `npm run build`
3. Serve built files from your backend or CDN
4. Update CORS settings in `server/server.js` to restrict origins

## Quick Reference

### Which option should I use?

| Scenario | Option | Frontend ngrok? | Backend ngrok? | Hot Reload? |
|----------|--------|-----------------|----------------|-------------|
| Share app externally (simple) | Option 1 | No | Yes | No (production build) |
| Share app with hot reload | Option 2 | Yes | Yes | Yes |
| Local development | Option 3 | No | No | Yes |

### Commands Summary

**Option 1 (Recommended for demos):**
```bash
# Build frontend
npm run build
# Serve from backend (configure static serving in server.js)
cd server && npm start
# Tunnel
ngrok http 3001
```

**Option 2 (Full development with ngrok):**
```bash
# Terminal 1: Backend
cd server && npm start

# Terminal 2: Frontend
npm run dev

# Terminal 3: Tunnel backend
ngrok http 3001
# Add URL to .env as VITE_BACKEND_URL

# Terminal 4: Tunnel frontend
ngrok http 5173
```

**Option 3 (Local only):**
```bash
# Terminal 1: Backend
cd server && npm start

# Terminal 2: Frontend
npm run dev
```

## Questions?

- **Do I need to tunnel both ports?**
  - For simple sharing: No, just backend (Option 1)
  - For hot reload with ngrok: Yes, both (Option 2)

- **Will hot reload work with ngrok?**
  - Yes, use Option 2 with separate tunnels

- **Can I use a custom ngrok domain?**
  - Yes, just use your custom domain in ngrok command

- **Does WebSocket work through ngrok?**
  - Yes, both configurations support WebSocket/Socket.IO

# 🌐 Share SensuQ Externally via Ngrok

This is the **simplest way** to share your app with external users through ngrok.

## Quick Start (3 Steps)

### Step 1: Build the Frontend
```bash
npm run build
```

Or use the deployment script:
```bash
./deploy.sh
```

### Step 2: Start the Backend
```bash
cd server
npm start
```

The server will run on port 3001 and serve both:
- Backend API at `/api/*`
- Frontend React app at `/*`

### Step 3: Start Ngrok
Open a new terminal:
```bash
ngrok http 3001
```

You'll see output like:
```
Forwarding  https://abc123.ngrok-free.app -> http://localhost:3001
```

**Share the ngrok URL** (`https://abc123.ngrok-free.app`) with your external users!

## ✅ What Works

- ✅ Frontend automatically uses the ngrok URL for API calls
- ✅ WebSocket/Socket.IO connections work
- ✅ Screenshots and file uploads work
- ✅ No configuration needed - everything is automatic!

## 🔄 Updating the App

When you make changes:

1. **Frontend changes**: Run `npm run build` again
2. **Backend changes**: Restart the server (`cd server && npm start`)
3. Ngrok URL stays the same (unless you restart ngrok)

## 🎯 How It Works

The app automatically detects it's being accessed via ngrok:

- When users visit `https://abc123.ngrok-free.app`
- Frontend checks `window.location` and sees the ngrok domain
- All API calls go to `https://abc123.ngrok-free.app/api/*`
- WebSocket connects to `https://abc123.ngrok-free.app`

No manual configuration required! 🎉

## 📝 Notes

- **Free ngrok**: URL changes when you restart ngrok
- **Paid ngrok**: Can use a fixed custom domain
- **Production**: Consider a proper deployment (AWS, Heroku, etc.)

## 🆘 Troubleshooting

### "Cannot GET /"
- Make sure you ran `npm run build` first
- Check that `dist/` folder exists in project root

### API calls failing
- Check browser console for the API URL being used
- Should be `https://your-ngrok-url.ngrok-free.app/api`

### WebSocket not connecting
- Ngrok supports WebSockets on HTTPS URLs
- Make sure you're using the `https://` ngrok URL, not `http://`

## 🔗 More Options

See [NGROK_SETUP.md](NGROK_SETUP.md) for:
- Development with hot reload through ngrok
- Separate frontend/backend tunnels
- Advanced configuration

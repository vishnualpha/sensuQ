#!/bin/bash

# SensuQ Deployment Script for ngrok
# This script builds the frontend and prepares the app for ngrok sharing

echo "🚀 SensuQ - Preparing for external sharing via ngrok"
echo ""

# Build frontend
echo "📦 Building frontend..."
npm run build

if [ $? -ne 0 ]; then
    echo "❌ Frontend build failed!"
    exit 1
fi

echo "✅ Frontend built successfully!"
echo ""
echo "📝 Next steps:"
echo "1. Start the backend server:"
echo "   cd server && npm start"
echo ""
echo "2. In another terminal, start ngrok:"
echo "   ngrok http 3001"
echo ""
echo "3. Share the ngrok URL with external users!"
echo ""
echo "🎉 Your app will be accessible at the ngrok URL"

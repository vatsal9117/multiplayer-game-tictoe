#!/bin/bash
# Quick Start Script - Multiplayer Game Server
# Run this after creating all the files

echo "🎮 Setting up Multiplayer Game Server..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed!"
    echo "Please install Node.js from https://nodejs.org"
    exit 1
fi

echo "✅ Node.js version: $(node --version)"
echo "✅ npm version: $(npm --version)"

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
npm install

# Check if installation succeeded
if [ $? -eq 0 ]; then
    echo "✅ Dependencies installed successfully!"
else
    echo "❌ Installation failed. Please check errors above."
    exit 1
fi

# Start the server
echo ""
echo "🚀 Starting server..."
echo "Press Ctrl+C to stop"
echo ""
echo "🌐 Open http://localhost:3000 in TWO browser tabs to test"
echo "📊 Health: http://localhost:3000/health"
echo "📈 Metrics: http://localhost:3000/metrics"
echo ""

npm start
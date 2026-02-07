# Equra AI Backend

Backend API server for Equra AI mobile app - Egyptian Stock Exchange (EGX) portfolio management.

## Features
- Real-time stock price fetching from EOD Historical Data API
- AI-powered stock analysis using Google Gemini
- Batch price updates
- Caching for performance

## Environment Variables
- `GOOGLE_API_KEY` - Google Gemini API key
- `PORT` - Server port (default: 5000)
- `NODE_ENV` - Environment (development/production)

## Deploy to Railway
1. Connect this repo to Railway
2. Set environment variable: `GOOGLE_API_KEY`
3. Railway will auto-deploy

## Local Development
```bash
npm install
npm run dev
```

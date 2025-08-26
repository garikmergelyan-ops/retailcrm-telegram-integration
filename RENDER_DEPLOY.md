# 🚀 Render Deployment Guide

## 📋 Prerequisites
- GitHub account
- Render account (free at [render.com](https://render.com))

## 🚀 Quick Deploy

### 1. Push to GitHub (Already Done!)
✅ Your code is already on GitHub at: `https://github.com/garikmergelyan-ops/retailcrm-telegram-integration`

### 2. Deploy on Render
1. Go to [render.com](https://render.com)
2. Click "New +" → "Web Service"
3. Connect your GitHub account
4. Select repository: `retailcrm-telegram-integration`
5. Render will auto-detect Node.js settings
6. Click "Create Web Service"

### 3. Configure Environment Variables
In Render dashboard, go to "Environment" tab and add:
```
RETAILCRM_URL=https://aff-gh.retailcrm.ru
RETAILCRM_API_KEY=LTNAIx16rMxzOe45sBr79L5HyBePogzD
TELEGRAM_BOT_TOKEN=8246590846:AAHwCiAhVUNEhrQpnv2rBuAQnwVkfr_HH4Y
TELEGRAM_CHANNEL_ID=@RetailCRMLeadsBotChannel
CURRENCY=GHS
NODE_ENV=production
```

### 4. Get Your URL
Render will provide a URL like: `https://your-app-name.onrender.com`

## 🔧 Manual Configuration (if needed)

### Build Command:
```
npm install
```

### Start Command:
```
npm start
```

## 📱 Test Your Integration
- Visit: `https://your-app-name.onrender.com/test`
- Check orders: `https://your-app-name.onrender.com/orders-status`
- Manual check: `https://your-app-name.onrender.com/check-orders`

## 🎯 What Happens Next
- Render automatically runs `npm start`
- Your integration checks RetailCRM every 30 seconds
- New approved orders → Telegram notifications
- Works 24/7 without your laptop!

## 💰 Pricing
- **Free Plan:** $7 credits/month (more than enough for your integration)
- **Auto-scaling:** Scales to zero when not in use
- **SSL included:** Automatic HTTPS

## 🆘 Troubleshooting
- Check Render logs in dashboard
- Verify environment variables
- Ensure all dependencies are in package.json
- Check if service is "Live" (green status)

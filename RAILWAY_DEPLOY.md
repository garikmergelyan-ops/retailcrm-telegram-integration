# 🚀 Railway Deployment Guide

## 📋 Prerequisites
- GitHub account
- Railway account (free at [railway.app](https://railway.app))

## 🚀 Quick Deploy

### 1. Push to GitHub
```bash
# Create new repository on GitHub
# Then push your code:
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
git branch -M main
git push -u origin main
```

### 2. Deploy on Railway
1. Go to [railway.app](https://railway.app)
2. Click "New Project"
3. Choose "Deploy from GitHub repo"
4. Select your repository
5. Railway will automatically detect Node.js and deploy

### 3. Set Environment Variables
In Railway dashboard, go to "Variables" tab and add:
```
RETAILCRM_URL=https://aff-gh.retailcrm.ru
RETAILCRM_API_KEY=LTNAIx16rMxzOe45sBr79L5HyBePogzD
TELEGRAM_BOT_TOKEN=8246590846:AAHwCiAhVUNEhrQpnv2rBuAQnwVkfr_HH4Y
TELEGRAM_CHANNEL_ID=@RetailCRMLeadsBotChannel
CURRENCY=GHS
```

### 4. Get Your URL
Railway will provide a URL like: `https://your-app-name.railway.app`

## 🔧 Manual Deploy (Alternative)

### 1. Install Railway CLI
```bash
npm install -g @railway/cli
```

### 2. Login and Deploy
```bash
railway login
railway init
railway up
```

## 📱 Test Your Integration
- Visit: `https://your-app-name.railway.app/test`
- Check orders: `https://your-app-name.railway.app/orders-status`
- Manual check: `https://your-app-name.railway.app/check-orders`

## 🎯 What Happens Next
- Railway automatically runs `npm start`
- Your integration checks RetailCRM every 30 seconds
- New approved orders → Telegram notifications
- Works 24/7 without your laptop!

## 🆘 Troubleshooting
- Check Railway logs in dashboard
- Verify environment variables
- Ensure all dependencies are in package.json

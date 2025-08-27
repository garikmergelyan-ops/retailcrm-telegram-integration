const axios = require('axios');

// URL вашего сервиса на Render (замените на ваш)
const RENDER_URL = process.env.RENDER_URL || 'https://your-app-name.onrender.com';

async function pingService() {
    try {
        console.log(`💓 Pinging ${RENDER_URL}...`);
        const response = await axios.get(`${RENDER_URL}/health`);
        console.log('✅ Service is alive:', response.data.status);
    } catch (error) {
        console.error('❌ Error pinging service:', error.message);
    }
}

// Пинг каждые 10 минут
setInterval(pingService, 10 * 60 * 1000);

// Первый пинг сразу
pingService();

console.log('🚀 Ping service started. Will ping every 10 minutes to prevent Render spin down.');

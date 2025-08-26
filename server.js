const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware для парсинга JSON
app.use(express.json());

// Функция для отправки сообщения в Telegram
async function sendTelegramMessage(message) {
    try {
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        const channelId = process.env.TELEGRAM_CHANNEL_ID;
        
        if (!botToken || !channelId) {
            console.error('Отсутствуют настройки Telegram');
            return false;
        }

        const response = await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            chat_id: channelId,
            text: message,
            parse_mode: 'HTML'
        });

        console.log('Сообщение отправлено в Telegram:', response.data);
        return true;
    } catch (error) {
        console.error('Ошибка отправки в Telegram:', error.message);
        return false;
    }
}

// Функция для получения деталей заказа из RetailCRM
async function getOrderDetails(orderId) {
    try {
        const retailcrmUrl = process.env.RETAILCRM_URL;
        const apiKey = process.env.RETAILCRM_API_KEY;
        
        if (!retailcrmUrl || !apiKey) {
            console.error('Отсутствуют настройки RetailCRM');
            return null;
        }

        const response = await axios.get(`${retailcrmUrl}/api/v5/orders/${orderId}`, {
            params: { apiKey }
        });

        if (response.data.success) {
            return response.data.order;
        } else {
            console.error('Ошибка получения заказа:', response.data.errorMsg);
            return null;
        }
    } catch (error) {
        console.error('Ошибка API RetailCRM:', error.message);
        return null;
    }
}

// Функция для форматирования сообщения о заказе
function formatOrderMessage(order) {
    const items = order.items || [];
    const itemsText = items.map(item => 
        `• ${item.productName} - ${item.quantity} шт.`
    ).join('\n');

    return `🛒 <b>НОВЫЙ ЗАКАЗ АППРУВЛЕН!</b>

📋 <b>Номер заказа:</b> ${order.number}
👤 <b>Оператор:</b> ${order.manager || 'Не указан'}
📅 <b>Дата доставки:</b> ${order.deliveryDate || 'Не указана'}
👨‍💼 <b>Имя клиента:</b> ${order.firstName} ${order.lastName}
📱 <b>Телефон:</b> ${order.phone || 'Не указан'}
📱 <b>Доп. телефон:</b> ${order.additionalPhone || 'Не указан'}
📍 <b>Адрес доставки:</b> ${order.deliveryAddress || 'Не указан'}
🏙️ <b>Город:</b> ${order.city || 'Не указан'}

🛍️ <b>Товары:</b>
${itemsText}

💰 <b>Сумма заказа:</b> ${order.totalSumm} ${process.env.CURRENCY || 'GHS'}

⏰ <b>Время аппрува:</b> ${new Date().toLocaleString('ru-RU')}`;
}

// Webhook endpoint для RetailCRM
app.post('/webhook/retailcrm', (req, res) => {
    try {
        const { order } = req.body;
        
        // Проверяем, что это аппрув заказа
        if (order && order.status === 'approved') {
            console.log('Получен аппрув заказа:', order.number);
            
            // Форматируем и отправляем сообщение
            const message = formatOrderMessage(order);
            sendTelegramMessage(message);
        }
        
        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Ошибка обработки webhook:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Тестовый endpoint для проверки работы
app.get('/test', (req, res) => {
    res.json({ 
        message: 'Сервер работает!',
        timestamp: new Date().toISOString()
    });
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`📡 Webhook endpoint: http://localhost:${PORT}/webhook/retailcrm`);
    console.log(`🧪 Тест: http://localhost:${PORT}/test`);
});

module.exports = app;

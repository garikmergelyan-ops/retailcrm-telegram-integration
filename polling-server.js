const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Хранилище для отслеживания уже обработанных заказов
const processedOrders = new Set();

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

        console.log('✅ Сообщение отправлено в Telegram:', response.data);
        return true;
    } catch (error) {
        console.error('❌ Ошибка отправки в Telegram:', error.message);
        return false;
    }
}

// Функция для получения заказов из RetailCRM
async function getOrdersFromRetailCRM() {
    try {
        const retailcrmUrl = process.env.RETAILCRM_URL;
        const apiKey = process.env.RETAILCRM_API_KEY;
        
        if (!retailcrmUrl || !apiKey) {
            console.error('Отсутствуют настройки RetailCRM');
            return [];
        }

        // Получаем заказы со статусом "approved" (аппрувленные)
        const response = await axios.get(`${retailcrmUrl}/api/v5/orders`, {
            params: { 
                apiKey,
                status: 'approved',
                limit: 100 // Получаем последние 100 заказов
            }
        });

        if (response.data.success) {
            return response.data.orders || [];
        } else {
            console.error('Ошибка получения заказов:', response.data.errorMsg);
            return [];
        }
    } catch (error) {
        console.error('Ошибка API RetailCRM:', error.message);
        return [];
    }
}

// Функция для форматирования сообщения о заказе
function formatOrderMessage(order) {
    const items = order.items || [];
    const itemsText = items.map(item => 
        `• ${item.productName || item.name || 'Товар'} - ${item.quantity || 1} шт.`
    ).join('\n');

    return `🛒 <b>НОВЫЙ ЗАКАЗ АППРУВЛЕН!</b>

📋 <b>Номер заказа:</b> ${order.number || order.id}
👤 <b>Оператор:</b> ${order.manager || 'Не указан'}
📅 <b>Дата доставки:</b> ${order.deliveryDate || 'Не указана'}
👨‍💼 <b>Имя клиента:</b> ${order.firstName || ''} ${order.lastName || ''}
📱 <b>Телефон:</b> ${order.phone || 'Не указан'}
📱 <b>Доп. телефон:</b> ${order.additionalPhone || 'Не указан'}
📍 <b>Адрес доставки:</b> ${order.deliveryAddress || 'Не указан'}
🏙️ <b>Город:</b> ${order.city || 'Не указан'}

🛍️ <b>Товары:</b>
${itemsText}

💰 <b>Сумма заказа:</b> ${order.totalSumm || 0} ${process.env.CURRENCY || 'GHS'}

⏰ <b>Время аппрува:</b> ${new Date().toLocaleString('ru-RU')}`;
}

// Функция для проверки новых заказов
async function checkNewOrders() {
    try {
        console.log('🔍 Проверяю новые заказы в RetailCRM...');
        
        const orders = await getOrdersFromRetailCRM();
        let newOrdersCount = 0;
        
        for (const order of orders) {
            const orderKey = `${order.id}-${order.status}`;
            
            // Проверяем, не обрабатывали ли мы уже этот заказ
            if (!processedOrders.has(orderKey)) {
                console.log(`🆕 Найден новый аппрувленный заказ: ${order.number || order.id}`);
                
                // Отправляем уведомление
                const message = formatOrderMessage(order);
                await sendTelegramMessage(message);
                
                // Помечаем заказ как обработанный
                processedOrders.add(orderKey);
                newOrdersCount++;
            }
        }
        
        if (newOrdersCount > 0) {
            console.log(`✅ Обработано новых заказов: ${newOrdersCount}`);
        } else {
            console.log('ℹ️ Новых заказов не найдено');
        }
        
    } catch (error) {
        console.error('❌ Ошибка проверки заказов:', error.message);
    }
}

// Запускаем периодическую проверку каждые 30 секунд
setInterval(checkNewOrders, 30000);

// Тестовый endpoint
app.get('/test', (req, res) => {
    res.json({ 
        message: 'Polling сервер работает!',
        timestamp: new Date().toISOString(),
        processedOrders: processedOrders.size
    });
});

// Endpoint для ручной проверки
app.get('/check-orders', async (req, res) => {
    await checkNewOrders();
    res.json({ 
        message: 'Проверка заказов выполнена',
        timestamp: new Date().toISOString()
    });
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`🚀 Polling сервер запущен на порту ${PORT}`);
    console.log(`🧪 Тест: http://localhost:${PORT}/test`);
    console.log(`🔍 Проверка заказов: http://localhost:${PORT}/check-orders`);
    console.log(`⏰ Проверка каждые 30 секунд`);
    
    // Запускаем первую проверку сразу
    checkNewOrders();
});

module.exports = app;

const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware для парсинга JSON и URL-encoded данных
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Логирование всех входящих запросов
app.use((req, res, next) => {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`📥 ${new Date().toISOString()} - ${req.method} ${req.path}`);
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    if (req.body && Object.keys(req.body).length > 0) {
        console.log('Body:', JSON.stringify(req.body, null, 2));
    }
    console.log('='.repeat(70));
    next();
});

// Функция для отправки сообщения в Telegram
async function sendTelegramMessage(message, channelId = null) {
    try {
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        const targetChannel = channelId || process.env.TELEGRAM_CHANNEL_ID;
        
        if (!botToken || !targetChannel) {
            console.error('❌ Отсутствуют настройки Telegram');
            console.error('   Bot Token:', botToken ? '✅' : '❌');
            console.error('   Channel ID:', targetChannel ? '✅' : '❌');
            return false;
        }

        const response = await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            chat_id: targetChannel,
            text: message,
            parse_mode: 'HTML'
        }, {
            timeout: 10000
        });

        console.log('✅ Сообщение отправлено в Telegram');
        return true;
    } catch (error) {
        console.error('❌ Ошибка отправки в Telegram:', error.message);
        if (error.response) {
            console.error('   Response:', error.response.data);
        }
        return false;
    }
}

// Функция для получения API ключа по URL аккаунта
function getApiKeyForAccount(accountUrl) {
    if (!accountUrl) return process.env.RETAILCRM_API_KEY;
    
    if (accountUrl.includes('aff-gh.retailcrm.ru')) {
        return process.env.RETAILCRM_API_KEY_1 || process.env.RETAILCRM_API_KEY;
    }
    
    if (accountUrl.includes('slimteapro-store.retailcrm.ru')) {
        return process.env.RETAILCRM_API_KEY_3 || process.env.RETAILCRM_API_KEY;
    }
    
    if (process.env.RETAILCRM_URL_2 && accountUrl.includes(process.env.RETAILCRM_URL_2.replace('https://', '').replace('http://', ''))) {
        return process.env.RETAILCRM_API_KEY_2 || process.env.RETAILCRM_API_KEY;
    }
    
    return process.env.RETAILCRM_API_KEY;
}

// Функция для получения данных заказа через API
async function getOrderFromAPI(accountUrl, apiKey, orderId) {
    try {
        const response = await axios.get(`${accountUrl}/api/v5/orders/${orderId}`, {
            params: { apiKey },
            timeout: 10000
        });

        if (response.data.success && response.data.order) {
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

// Функция для определения канала Telegram по URL аккаунта
function getTelegramChannelForAccount(accountUrl) {
    if (!accountUrl) return null;
    
    // Account 1 (Ghana)
    if (accountUrl.includes('aff-gh.retailcrm.ru')) {
        return process.env.TELEGRAM_CHANNEL_ID_1 || process.env.TELEGRAM_CHANNEL_ID;
    }
    
    // Account 3 (SlimTeaPro)
    if (accountUrl.includes('slimteapro-store.retailcrm.ru')) {
        return process.env.TELEGRAM_CHANNEL_ID_3 || process.env.TELEGRAM_CHANNEL_ID_1 || process.env.TELEGRAM_CHANNEL_ID;
    }
    
    // Account 2
    if (process.env.RETAILCRM_URL_2 && accountUrl.includes(process.env.RETAILCRM_URL_2.replace('https://', '').replace('http://', ''))) {
        return process.env.TELEGRAM_CHANNEL_ID_2 || process.env.TELEGRAM_CHANNEL_ID;
    }
    
    // По умолчанию
    return process.env.TELEGRAM_CHANNEL_ID;
}

// Функция для форматирования сообщения о заказе
function formatOrderMessage(order, currency = 'GHS') {
    const items = order.items || [];
    const itemsText = items.length > 0 
        ? items.map(item => 
            `• ${item.productName || item.name || 'Товар'} - ${item.quantity || 1} шт.`
          ).join('\n')
        : 'Товары не указаны';

    const customer = order.customer || {};
    const firstName = order.firstName || customer.firstName || 'Не указано';
    const lastName = order.lastName || customer.lastName || '';
    const fullName = `${firstName} ${lastName}`.trim() || 'Не указано';

    return `🛒 <b>НОВЫЙ ЗАКАЗ АППРУВЛЕН!</b>

📋 <b>Номер заказа:</b> ${order.number || order.id || 'Не указан'}
👤 <b>Оператор:</b> ${order.manager || order.managerName || 'Не указан'}
📅 <b>Дата доставки:</b> ${order.deliveryDate || order.delivery?.date || 'Не указана'}
👨‍💼 <b>Имя клиента:</b> ${fullName}
📱 <b>Телефон:</b> ${order.phone || customer.phone || 'Не указан'}
📱 <b>Доп. телефон:</b> ${order.additionalPhone || customer.additionalPhones?.[0] || 'Не указан'}
📍 <b>Адрес доставки:</b> ${order.deliveryAddress || order.delivery?.address?.text || 'Не указан'}
🏙️ <b>Город:</b> ${order.city || order.delivery?.address?.city || 'Не указан'}

🛍️ <b>Товары:</b>
${itemsText}

💰 <b>Сумма заказа:</b> ${order.totalSumm || order.totalSum || 0} ${currency}

⏰ <b>Время аппрува:</b> ${new Date().toLocaleString('ru-RU')}`;
}

// Функция для определения валюты по аккаунту
function getCurrencyForAccount(accountUrl) {
    if (!accountUrl) return process.env.CURRENCY || 'GHS';
    
    if (accountUrl.includes('aff-gh.retailcrm.ru')) {
        return process.env.CURRENCY_1 || process.env.CURRENCY || 'GHS';
    }
    
    if (accountUrl.includes('slimteapro-store.retailcrm.ru')) {
        return process.env.CURRENCY_3 || process.env.CURRENCY || 'GHS';
    }
    
    return process.env.CURRENCY || 'GHS';
}

// Функция для проверки, является ли статус "approved"
function isApprovedStatus(status) {
    if (!status) return false;
    
    const statusStr = String(status).toLowerCase();
    return statusStr === 'approved' || 
           statusStr === 'approve' || 
           statusStr.includes('approv');
}

// Webhook endpoint для RetailCRM триггера
app.post('/webhook/retailcrm', async (req, res) => {
    try {
        console.log('\n🔔 WEBHOOK RECEIVED FROM RETAILCRM');
        console.log('='.repeat(70));
        
        // Логируем все данные для отладки
        console.log('📦 Full request data:');
        console.log(JSON.stringify({
            headers: req.headers,
            body: req.body,
            query: req.query,
            params: req.params
        }, null, 2));
        
        // Пытаемся извлечь данные заказа из разных форматов
        let order = null;
        let accountUrl = null;
        
        // Вариант 1: Данные в req.body.order
        if (req.body.order) {
            order = req.body.order;
            console.log('✅ Найден заказ в req.body.order');
        }
        // Вариант 2: Данные напрямую в req.body
        else if (req.body.id || req.body.number) {
            order = req.body;
            console.log('✅ Найден заказ в req.body');
        }
        // Вариант 3: Данные в req.body.data
        else if (req.body.data && (req.body.data.id || req.body.data.number)) {
            order = req.body.data;
            console.log('✅ Найден заказ в req.body.data');
        }
        // Вариант 4: URL-encoded данные или query параметры
        else if (req.body.order_id || req.body.orderNumber || req.query.order_id || req.query.orderNumber) {
            const orderId = req.body.order_id || req.body.orderNumber || req.query.order_id || req.query.orderNumber;
            console.log('⚠️ Получен только ID заказа:', orderId);
            console.log('   Пытаемся получить данные через API...');
            
            // Пытаемся определить аккаунт для API запроса
            accountUrl = req.headers['x-retailcrm-url'] || 
                        req.body.accountUrl || 
                        req.query.accountUrl ||
                        process.env.RETAILCRM_URL_1 || 
                        process.env.RETAILCRM_URL_3 ||
                        process.env.RETAILCRM_URL;
            
            // Получаем данные заказа через API
            try {
                const apiKey = getApiKeyForAccount(accountUrl);
                if (apiKey && accountUrl) {
                    const orderData = await getOrderFromAPI(accountUrl, apiKey, orderId);
                    if (orderData) {
                        order = orderData;
                        console.log('✅ Данные заказа получены через API');
                    } else {
                        console.log('❌ Не удалось получить данные заказа через API');
                    }
                } else {
                    console.log('⚠️ Нет API ключа для получения данных заказа');
                }
            } catch (apiError) {
                console.error('❌ Ошибка при получении данных через API:', apiError.message);
            }
        }
        
        if (!order) {
            console.log('❌ Заказ не найден в запросе');
            console.log('   Доступные ключи в req.body:', Object.keys(req.body));
            console.log('   Доступные ключи в req.query:', Object.keys(req.query));
            console.log('\n💡 ВАЖНО: Триггер в RetailCRM настроен неправильно!');
            console.log('   Нужно настроить триггер так, чтобы он отправлял данные заказа в теле запроса.');
            console.log('   См. инструкцию: WEBHOOK_SETUP_DETAILED.md');
            
            res.status(200).json({ 
                success: false, 
                message: 'Order not found in request. Please configure trigger to send order data.',
                received: {
                    body: Object.keys(req.body),
                    query: Object.keys(req.query)
                }
            });
            return;
        }
        
        console.log('📋 Данные заказа:');
        console.log('   ID:', order.id);
        console.log('   Number:', order.number);
        console.log('   Status:', order.status);
        console.log('   StatusCode:', order.statusCode);
        
        // Проверяем статус заказа
        const status = order.status || order.statusCode || '';
        const isApproved = isApprovedStatus(status);
        
        console.log(`🔍 Проверка статуса: "${status}" -> ${isApproved ? 'APPROVED ✅' : 'NOT APPROVED ❌'}`);
        
        if (!isApproved) {
            console.log('⏭️ Заказ не в статусе "approved", пропускаем');
            res.status(200).json({ 
                success: true, 
                message: 'Order status is not approved, skipping',
                status: status
            });
            return;
        }
        
        // Определяем аккаунт и настройки
        accountUrl = req.headers['x-retailcrm-url'] || 
                    req.body.accountUrl || 
                    process.env.RETAILCRM_URL;
        
        const telegramChannel = getTelegramChannelForAccount(accountUrl);
        const currency = getCurrencyForAccount(accountUrl);
        
        console.log('⚙️ Настройки:');
        console.log('   Account URL:', accountUrl);
        console.log('   Telegram Channel:', telegramChannel);
        console.log('   Currency:', currency);
        
        // Форматируем и отправляем сообщение
        console.log('📝 Форматируем сообщение...');
        const message = formatOrderMessage(order, currency);
        
        console.log('📤 Отправляем в Telegram...');
        const sent = await sendTelegramMessage(message, telegramChannel);
        
        if (sent) {
            console.log('✅ Успешно обработан заказ:', order.number || order.id);
            res.status(200).json({ 
                success: true, 
                message: 'Order processed successfully',
                orderNumber: order.number || order.id
            });
        } else {
            console.log('❌ Не удалось отправить сообщение в Telegram');
            res.status(200).json({ 
                success: false, 
                message: 'Failed to send Telegram message',
                orderNumber: order.number || order.id
            });
        }
        
    } catch (error) {
        console.error('❌ ОШИБКА ОБРАБОТКИ WEBHOOK:');
        console.error('   Error:', error.message);
        console.error('   Stack:', error.stack);
        
        // Всегда отвечаем 200 OK, чтобы RetailCRM не повторял запрос
        res.status(200).json({ 
            success: false, 
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Тестовый endpoint для проверки работы
app.get('/test', (req, res) => {
    res.json({ 
        message: 'Сервер работает!',
        timestamp: new Date().toISOString(),
        webhookEndpoint: '/webhook/retailcrm',
        environment: {
            hasTelegramToken: !!process.env.TELEGRAM_BOT_TOKEN,
            hasTelegramChannel: !!process.env.TELEGRAM_CHANNEL_ID,
            port: PORT
        }
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'ok',
        timestamp: new Date().toISOString()
    });
});

// Запуск сервера
app.listen(PORT, () => {
    console.log('\n' + '='.repeat(70));
    console.log('🚀 СЕРВЕР ЗАПУЩЕН');
    console.log('='.repeat(70));
    console.log(`📡 Порт: ${PORT}`);
    console.log(`🌐 Webhook endpoint: http://localhost:${PORT}/webhook/retailcrm`);
    console.log(`🧪 Тест: http://localhost:${PORT}/test`);
    console.log(`💚 Health: http://localhost:${PORT}/health`);
    console.log('='.repeat(70));
    console.log('\n✅ Готов к приему webhook от RetailCRM триггеров!\n');
});

module.exports = app;

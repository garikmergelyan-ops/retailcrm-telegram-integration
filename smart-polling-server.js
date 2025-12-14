const express = require('express');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Конфигурация для нескольких аккаунтов RetailCRM
const retailCRMAccounts = [
    {
        name: 'Account 1 (Ghana)',
        url: process.env.RETAILCRM_URL_1 || process.env.RETAILCRM_URL,
        apiKey: process.env.RETAILCRM_API_KEY_1 || process.env.RETAILCRM_API_KEY,
        telegramChannel: process.env.TELEGRAM_CHANNEL_ID_1 || process.env.TELEGRAM_CHANNEL_ID,
        currency: process.env.CURRENCY_1 || process.env.CURRENCY || 'GHS'
    },
    {
        name: 'Account 2',
        url: process.env.RETAILCRM_URL_2,
        apiKey: process.env.RETAILCRM_API_KEY_2,
        telegramChannel: process.env.TELEGRAM_CHANNEL_ID_2,
        currency: process.env.CURRENCY_2 || 'USD'
    },
    {
        name: 'Account 3 (SlimTeaPro)',
        url: process.env.RETAILCRM_URL_3,
        apiKey: process.env.RETAILCRM_API_KEY_3,
        telegramChannel: process.env.TELEGRAM_CHANNEL_ID_3 || process.env.TELEGRAM_CHANNEL_ID_1 || process.env.TELEGRAM_CHANNEL_ID,
        currency: process.env.CURRENCY_3 || 'GHS'
    }
].filter(account => account.url && account.apiKey);

console.log(`🚀 Configured ${retailCRMAccounts.length} RetailCRM account(s)`);
retailCRMAccounts.forEach((account, index) => {
    console.log(`  ${index + 1}. ${account.name}: ${account.url}`);
});

// База данных для отслеживания отправленных уведомлений
const dbPath = path.join(__dirname, 'notifications.db');
const db = new sqlite3.Database(dbPath);

// Инициализация базы данных
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS sent_notifications (
        order_id TEXT PRIMARY KEY,
        order_number TEXT UNIQUE,
        account_name TEXT,
        sent_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    console.log('🗄️ Database initialized');
});

// Простая функция для проверки, был ли заказ уже отправлен
function isOrderAlreadySent(orderId) {
    return new Promise((resolve) => {
        db.get('SELECT order_id FROM sent_notifications WHERE order_id = ?', [orderId], (err, row) => {
            resolve(!!row);
        });
    });
}

// Простая функция для сохранения отправленного заказа
function saveSentOrder(orderId, orderNumber, accountName) {
    return new Promise((resolve) => {
        db.run('INSERT OR IGNORE INTO sent_notifications (order_id, order_number, account_name) VALUES (?, ?, ?)', 
            [orderId, orderNumber, accountName], (err) => {
            resolve(!err);
        });
    });
}

// Простая функция для отправки сообщения в Telegram
async function sendTelegramMessage(message, channelId) {
    try {
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        const targetChannel = channelId || process.env.TELEGRAM_CHANNEL_ID;
        
        if (!botToken || !targetChannel) {
            console.error('❌ Missing Telegram settings');
            return false;
        }

        await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            chat_id: targetChannel,
            text: message,
            parse_mode: 'HTML'
        });

        return true;
    } catch (error) {
        console.error('❌ Error sending to Telegram:', error.message);
        return false;
    }
}

// Простая функция для получения информации об операторе
async function getManagerInfo(managerId, accountUrl, accountApiKey) {
    try {
        if (!accountUrl || !accountApiKey || !managerId) return null;

        const response = await axios.get(`${accountUrl}/api/v5/users/${managerId}`, {
            params: { apiKey: accountApiKey },
            timeout: 30000
        });

        if (response.data && response.data.success && response.data.user) {
            const user = response.data.user;
            return user.firstName && user.lastName ? 
                `${user.firstName} ${user.lastName}` : 
                user.firstName || user.lastName || `ID: ${managerId}`;
        }
        return null;
    } catch (error) {
        return null;
    }
}

// Простая функция для форматирования сообщения о заказе
async function formatOrderMessage(order) {
    // Оператор
    let managerName = 'Not specified';
    if (order.managerId && order.accountUrl && order.accountApiKey) {
        const manager = await getManagerInfo(order.managerId, order.accountUrl, order.accountApiKey);
        if (manager) managerName = manager;
    }

    // Товары
    const items = order.items || [];
    const itemsText = items.map(item => {
        const productName = item.offer?.displayName || item.offer?.name || 'Product';
        const quantity = item.quantity || 1;
        return `• ${productName} - ${quantity} pcs`;
    }).join('\n') || 'Not specified';

    // Адрес доставки
    const deliveryAddress = order.delivery?.address;
    const addressText = deliveryAddress ? 
        `${deliveryAddress.street || ''} ${deliveryAddress.building || ''} ${deliveryAddress.apartment || ''}`.trim() || 
        deliveryAddress.text || 
        'Not specified' : 'Not specified';
    
    const city = deliveryAddress?.city || order.delivery?.city || 'Not specified';
    const deliveryDate = order.delivery?.date || order.deliveryDate || 'Not specified';
    
    // Дополнительный телефон
    const additionalPhone = order.additionalPhone || 
                           (order.contact?.phones && order.contact.phones.length > 1 ? 
                            order.contact.phones[1].number : 'Not specified');

    // Время по Гане
    const ghanaTime = new Date().toLocaleString('en-GB', {
        timeZone: 'Africa/Accra',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });

    return `🛒 <b>NEW ORDER APPROVED!</b>

📋 <b>Order Number:</b> ${order.number || order.id}
👤 <b>Operator:</b> ${managerName}
📅 <b>Delivery Date:</b> ${deliveryDate}
👨‍💼 <b>Customer Name:</b> ${order.firstName || ''} ${order.lastName || ''}
📱 <b>Phone:</b> ${order.phone || 'Not specified'}
📱 <b>Additional Phone:</b> ${additionalPhone}
📍 <b>Delivery Address:</b> ${addressText}
🏙️ <b>City:</b> ${city}

🛍️ <b>Products:</b>
${itemsText}

💰 <b>Order Total:</b> ${order.totalSumm || 0} ${order.accountCurrency || 'GHS'}

⏰ <b>Approval Time:</b> ${ghanaTime} (Ghana Time)`;
}

// Простая функция для получения последних 300 заказов и фильтрации approved
async function getApprovedOrders(account) {
    try {
        console.log(`🔍 Fetching orders from ${account.name}...`);
        
        let allApprovedOrders = [];
        let page = 1;
        let totalFetched = 0;
        
        // Получаем 3 страницы по 100 заказов = 300 заказов максимум
        while (page <= 3 && totalFetched < 300) {
            try {
                const response = await axios.get(`${account.url}/api/v5/orders`, {
                    params: {
                        apiKey: account.apiKey,
                        limit: 100,
                        page
                    },
                    timeout: 30000
                });

                if (response.data && response.data.success && response.data.orders) {
                    const orders = response.data.orders;
                    totalFetched += orders.length;
                    
                    // Фильтруем только approved заказы
                    const approvedOrders = orders.filter(order => order.status === 'approved');
                    
                    // Добавляем информацию об аккаунте
                    approvedOrders.forEach(order => {
                        allApprovedOrders.push({
                            ...order,
                            accountName: account.name,
                            accountUrl: account.url,
                            accountApiKey: account.apiKey,
                            accountCurrency: account.currency,
                            telegramChannel: account.telegramChannel
                        });
                    });
                    
                    // Если получили меньше 100 заказов, значит это последняя страница
                    if (orders.length < 100) {
                        break;
                    }
                    
                    page++;
                } else {
                    break;
                }
            } catch (error) {
                console.error(`❌ Error fetching page ${page} from ${account.name}:`, error.message);
                break;
            }
        }
        
        console.log(`📊 ${account.name}: Found ${allApprovedOrders.length} approved orders from ${totalFetched} total orders`);
        return allApprovedOrders;
        
    } catch (error) {
        console.error(`❌ Error fetching orders from ${account.name}:`, error.message);
        return [];
    }
}

// Простая функция для проверки и отправки approved заказов
async function checkAndSendApprovedOrders() {
    try {
        console.log(`🔍 Checking approved orders...`);
        
        let totalSent = 0;
        let totalSkipped = 0;
        
        // Проверяем каждый аккаунт
        for (const account of retailCRMAccounts) {
            try {
                // Получаем approved заказы
                const approvedOrders = await getApprovedOrders(account);
                
                if (approvedOrders.length === 0) {
                    continue;
                }
                
                console.log(`📋 Processing ${approvedOrders.length} approved orders from ${account.name}...`);
                
                // Обрабатываем каждый заказ
                for (const order of approvedOrders) {
                    const orderId = order.id;
                    const orderNumber = order.number || orderId;
                    
                    // Проверяем, был ли уже отправлен
                    const alreadySent = await isOrderAlreadySent(orderId);
                    
                    if (alreadySent) {
                        totalSkipped++;
                        continue;
                    }
                    
                    // Форматируем и отправляем сообщение
                    const message = await formatOrderMessage(order);
                    const sent = await sendTelegramMessage(message, order.telegramChannel);
                    
                    if (sent) {
                        // Сохраняем в БД
                        await saveSentOrder(orderId, orderNumber, account.name);
                        totalSent++;
                        console.log(`✅ Sent order ${orderNumber} from ${account.name}`);
                        
                        // Небольшая задержка между отправками
                        await new Promise(resolve => setTimeout(resolve, 500));
                    } else {
                        console.error(`❌ Failed to send order ${orderNumber}`);
                    }
                }
                
                // Задержка между аккаунтами
                if (retailCRMAccounts.indexOf(account) < retailCRMAccounts.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
                
            } catch (error) {
                console.error(`❌ Error processing ${account.name}:`, error.message);
                continue;
            }
        }
        
        console.log(`🎉 Sent ${totalSent} new orders, skipped ${totalSkipped} duplicates`);
        
    } catch (error) {
        console.error('❌ Error checking approved orders:', error.message);
    }
}

// Запускаем периодическую проверку каждые 5 минут
setInterval(checkAndSendApprovedOrders, 300000);

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy',
        timestamp: new Date().toISOString(),
        accounts: retailCRMAccounts.length
    });
});

// Тестовый endpoint
app.get('/test', (req, res) => {
    res.json({ 
        message: 'Server is working!',
        timestamp: new Date().toISOString()
    });
});

// Endpoint для ручной проверки
app.get('/check-orders', async (req, res) => {
    await checkAndSendApprovedOrders();
    res.json({ 
        message: 'Check completed',
        timestamp: new Date().toISOString()
    });
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`🚀 Server started on port ${PORT}`);
    console.log(`⏰ Checking approved orders every 5 minutes`);
    console.log(`📊 Will check last 300 orders from each account`);
    
    // Первая проверка через 1 минуту
    setTimeout(checkAndSendApprovedOrders, 60000);
});

module.exports = app;

const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Уникальный идентификатор сервера для диагностики
const serverId = Math.random().toString(36).substring(2, 15);

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
    }
    // Можно добавить больше аккаунтов
].filter(account => account.url && account.apiKey); // Фильтруем только настроенные аккаунты

console.log(`🚀 Configured ${retailCRMAccounts.length} RetailCRM account(s)`);
retailCRMAccounts.forEach((account, index) => {
    console.log(`  ${index + 1}. ${account.name}: ${account.url}`);
});

// Простая и надежная система отслеживания approved заказов
const approvedOrdersSent = new Set(); // ID заказов, для которых уже отправлены уведомления
const MAX_TRACKED_ORDERS = 10000; // Максимум 10,000 заказов в памяти

// Добавляем логирование для диагностики дублирования
console.log(`🆔 Server started with ID: ${serverId}`);
console.log(`📊 Initial approvedOrdersSent size: ${approvedOrdersSent.size}`);

// Функция для отправки сообщения в Telegram
async function sendTelegramMessage(message, channelId = null) {
    try {
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        const targetChannel = channelId || process.env.TELEGRAM_CHANNEL_ID;
        
        if (!botToken || !targetChannel) {
            console.error('Missing Telegram settings');
            return false;
        }

        const response = await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            chat_id: targetChannel,
            text: message,
            parse_mode: 'HTML'
        });

        console.log(`✅ Message sent to Telegram channel: ${targetChannel}`);
        return true;
    } catch (error) {
        console.error('❌ Error sending to Telegram:', error.message);
        return false;
    }
}

// Функция для поиска конкретного заказа по номеру
async function findSpecificOrder(account, orderNumber) {
    try {
        console.log(`🔍 Searching for specific order: ${orderNumber} in ${account.name}...`);
        
        const response = await axios.get(`${account.url}/api/v5/orders`, {
            params: { 
                apiKey: account.apiKey,
                limit: 100,
                number: orderNumber
            }
        });

        if (response.data.success && response.data.orders && response.data.orders.length > 0) {
            const order = response.data.orders[0];
            console.log(`✅ Found specific order ${orderNumber}: status = ${order.status}`);
            return order;
        } else {
            console.log(`❌ Order ${orderNumber} not found in ${account.name}`);
            return null;
        }
    } catch (error) {
        console.error(`❌ Error searching for order ${orderNumber}:`, error.message);
        return null;
    }
}

// Функция для получения заказов из RetailCRM
async function getOrdersFromRetailCRM() {
    try {
        let allOrders = [];
        
                for (const account of retailCRMAccounts) {
            try {
                let page = 1, totalOrders = 0;
                
                while (page <= 50) {
                    try {
                        const response = await axios.get(`${account.url}/api/v5/orders`, {
                            params: { apiKey: account.apiKey, limit: 100, page },
                            timeout: 30000 // 30 секунд таймаут для API запросов
                        });
                    
                        if (response.data.success && response.data.orders?.length > 0) {
                            // Фильтруем approved заказы и сразу добавляем в общий массив
                            const approvedOrders = response.data.orders.filter(order => order.status === 'approved');
                            
                            if (approvedOrders.length > 0) {
                                const ordersWithAccount = approvedOrders.map(order => ({
                                    ...order, accountName: account.name, accountUrl: account.url,
                                    accountCurrency: account.currency, telegramChannel: account.telegramChannel
                                }));
                                
                                allOrders = allOrders.concat(ordersWithAccount);
                                totalOrders += approvedOrders.length;
                            }
                            
                            // Очищаем память после обработки каждой страницы
                            if (page % 10 === 0) {
                                global.gc && global.gc(); // Принудительная очистка памяти
                            }
                            
                            if (response.data.orders.length < 100) break;
                            page++;
                        } else break;
                    } catch (pageError) {
                        console.error(`❌ Page ${page} error:`, pageError.message);
                        break; // Переходим к следующему аккаунту при ошибке страницы
                    }
                }
                
                console.log(`📊 ${account.name}: ${totalOrders} approved orders`);
            } catch (error) {
                console.error(`❌ ${account.name}:`, error.message);
                // Продолжаем с другими аккаунтами при ошибке
                continue;
            }
        }
        
        return allOrders;
    } catch (error) {
        console.error('RetailCRM API error:', error.message);
        return [];
    }
}

// Функция для получения информации об операторе по ID
async function getManagerInfo(managerId) {
    try {
        const retailcrmUrl = process.env.RETAILCRM_URL;
        const apiKey = process.env.RETAILCRM_API_KEY;
        
        if (!retailcrmUrl || !apiKey || !managerId) {
            return null;
        }

        const response = await axios.get(`${retailcrmUrl}/api/v5/users/${managerId}`, {
            params: { apiKey }
        });

        if (response.data.success) {
            return response.data.user;
        } else {
            console.error('Error getting operator information:', response.data.errorMsg);
            return null;
        }
    } catch (error) {
        console.error('API error getting operator:', error.message);
        return null;
    }
}

// Функция для форматирования сообщения о заказе
async function formatOrderMessage(order) {
    // Получаем информацию об операторе
    let managerName = 'Не указан';
    if (order.managerId) {
        const manager = await getManagerInfo(order.managerId);
        if (manager) {
            managerName = manager.firstName && manager.lastName ? 
                `${manager.firstName} ${manager.lastName}` : 
                manager.firstName || manager.lastName || `ID: ${order.managerId}`;
        } else {
            managerName = `ID: ${order.managerId}`;
        }
    }

    const items = order.items || [];
    const itemsText = items.map(item => {
        const productName = item.offer?.displayName || item.offer?.name || 'Product';
        const quantity = item.quantity || 1;
        return `• ${productName} - ${quantity} pcs`;
    }).join('\n');

    // Получаем информацию о доставке
    const deliveryAddress = order.delivery?.address;
    const addressText = deliveryAddress ? 
        `${deliveryAddress.street || ''} ${deliveryAddress.building || ''} ${deliveryAddress.apartment || ''}`.trim() || 
        deliveryAddress.text || 
        'Not specified' : 'Not specified';
    
    const city = deliveryAddress?.city || order.delivery?.city || 'Not specified';
    const deliveryDate = order.delivery?.date || order.deliveryDate || 'Not specified';
    
    // Получаем дополнительный телефон
    const additionalPhone = order.additionalPhone || 
                           (order.contact?.phones && order.contact.phones.length > 1 ? 
                            order.contact.phones[1].number : 'Not specified');

    // Получаем время по Гане (GMT+0)
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

💰 <b>Order Total:</b> ${order.totalSumm || 0} ${process.env.CURRENCY || 'GHS'}

⏰ <b>Approval Time:</b> ${ghanaTime} (Ghana Time)`;
}

// Проверка approved заказов
async function checkAndSendApprovedOrders() {
    try {
        console.log(`🔍 Checking approved orders...`);
        
        const orders = await getOrdersFromRetailCRM();
        let newApprovalsCount = 0;
        
        for (const order of orders) {
            const orderId = order.id;
            const orderNumber = order.number || orderId;
            
            if (!approvedOrdersSent.has(orderId)) {
                console.log(`🆕 New: ${orderNumber}`);
                const message = await formatOrderMessage(order);
                await sendTelegramMessage(message, order.telegramChannel);
                approvedOrdersSent.add(orderId);
                newApprovalsCount++;
                
                // Очищаем память если превысили лимит отслеживаемых заказов
                if (approvedOrdersSent.size > MAX_TRACKED_ORDERS) {
                    const oldOrders = Array.from(approvedOrdersSent).slice(0, 1000); // Удаляем 1000 старых
                    oldOrders.forEach(id => approvedOrdersSent.delete(id));
                    console.log(`🧹 Memory cleanup: removed 1000 old orders, current size: ${approvedOrdersSent.size}`);
                }
            }
        }
        
        if (newApprovalsCount > 0) {
            console.log(`🎉 Sent ${newApprovalsCount} new notifications`);
        }
        console.log(`📊 Total tracked: ${approvedOrdersSent.size}`);
        
    } catch (error) {
        console.error('❌ Error checking approved orders:', error.message);
    }
}

// Запускаем периодическую проверку каждую минуту (оптимизация для бесплатного тарифа)
setInterval(checkAndSendApprovedOrders, 60000);

// Health check endpoint для предотвращения "spin down" на Render
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        accounts: retailCRMAccounts.length
    });
});

// Автоматический пинг каждые 10 минут для предотвращения "spin down"
setInterval(async () => {
    try {
        const response = await axios.get(`${process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000'}/health`);
        console.log('💓 Health check ping sent to prevent spin down');
    } catch (error) {
        console.log('💓 Health check ping sent (local)');
    }
}, 10 * 60 * 1000); // Каждые 10 минут

// Тестовый endpoint
app.get('/test', (req, res) => {
    res.json({ 
        message: 'Smart Polling server is working!',
        timestamp: new Date().toISOString(),
        trackedOrders: approvedOrdersSent.size
    });
});

// Endpoint для ручной проверки
app.get('/check-orders', async (req, res) => {
    await checkAndSendApprovedOrders();
    res.json({ 
        message: 'Status change check completed',
        timestamp: new Date().toISOString()
    });
});

// Endpoint для просмотра отслеживаемых заказов
app.get('/orders-status', (req, res) => {
    const ordersList = Array.from(approvedOrdersSent);
    
    res.json({
        trackedOrders: approvedOrdersSent.size,
        orders: ordersList
    });
});

// Endpoint для поиска конкретного заказа по номеру
app.get('/find-order/:orderNumber', async (req, res) => {
    try {
        const orderNumber = req.params.orderNumber;
        console.log(`🔍 Manual search for order: ${orderNumber}`);
        
        let foundOrder = null;
        
        // Ищем заказ во всех аккаунтах
        for (const account of retailCRMAccounts) {
            const order = await findSpecificOrder(account, orderNumber);
            if (order) {
                foundOrder = {
                    ...order,
                    accountName: account.name,
                    accountUrl: account.url,
                    accountCurrency: account.currency,
                    telegramChannel: account.telegramChannel
                };
                break;
            }
        }
        
        if (foundOrder) {
            res.json({
                success: true,
                order: foundOrder,
                message: `Order ${orderNumber} found`
            });
        } else {
            res.json({
                success: false,
                message: `Order ${orderNumber} not found in any account`
            });
        }
    } catch (error) {
        res.status(500).json({ 
            error: 'Error searching for order',
            message: error.message
        });
    }
});

// Endpoint для просмотра уже отправленных уведомлений
app.get('/sent-notifications', (req, res) => {
    const notificationsList = Array.from(approvedOrdersSent);
    
    res.json({
        totalSent: approvedOrdersSent.size,
        notifications: notificationsList
    });
});

// Endpoint для ручной проверки всех approved заказов
app.get('/check-all-approved', async (req, res) => {
    try {
        await checkAndSendApprovedOrders();
        res.json({ 
            message: 'Full approved orders check completed',
            timestamp: new Date().toISOString(),
            trackedOrders: approvedOrdersSent.size
        });
    } catch (error) {
        res.status(500).json({ 
            error: 'Error checking approved orders',
            message: error.message
        });
    }
});

// Endpoint для сброса памяти сервера
app.get('/reset-memory', (req, res) => {
    const previousCount = approvedOrdersSent.size;
    approvedOrdersSent.clear();
    
    res.json({
        message: 'Server memory reset',
        previousTrackedOrders: previousCount,
        currentTrackedOrders: 0,
        timestamp: new Date().toISOString()
    });
    
    console.log(`🧹 Server memory reset. Previous tracked orders: ${previousCount}`);
});

// Простая и эффективная стратегия: проверяем последние 5000 заказов каждые 30 секунд

// Запуск сервера
app.listen(PORT, () => {
    console.log(`🚀 Server started on port ${PORT}`);
    console.log(`🔍 Check: http://localhost:${PORT}/check-orders`);
    console.log(`📊 Status: http://localhost:${PORT}/orders-status`);
    console.log(`⏰ Polling every 60s - last 5000 orders (optimized for free tier)`);
    
    // Запускаем первую проверку сразу
    checkAndSendApprovedOrders();
});

module.exports = app;

const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Уникальный идентификатор сервера для диагностики
const serverId = Math.random().toString(36).substring(2, 15);
console.log(`🆔 Server started with ID: ${serverId}`);

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

// Хранилище для отслеживания статусов заказов
const orderStatuses = new Map(); // orderId -> { status, lastUpdate }

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

// Функция для получения заказов из RetailCRM
async function getOrdersFromRetailCRM() {
    try {
        let allOrders = [];
        
        // Получаем заказы из всех настроенных аккаунтов
        for (const account of retailCRMAccounts) {
            try {
                console.log(`🔍 Checking orders from ${account.name}...`);
                
                const response = await axios.get(`${account.url}/api/v5/orders`, {
                    params: { 
                        apiKey: account.apiKey,
                        limit: 100
                    }
                });

                if (response.data.success && response.data.orders) {
                    // Добавляем информацию об аккаунте к каждому заказу
                    const ordersWithAccount = response.data.orders.map(order => ({
                        ...order,
                        accountName: account.name,
                        accountUrl: account.url,
                        accountCurrency: account.currency,
                        telegramChannel: account.telegramChannel
                    }));
                    
                    allOrders = allOrders.concat(ordersWithAccount);
                    console.log(`✅ Got ${response.data.orders.length} orders from ${account.name}`);
                } else {
                    console.error(`❌ Error getting orders from ${account.name}:`, response.data.errorMsg);
                }
            } catch (error) {
                console.error(`❌ Error with ${account.name}:`, error.message);
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

// Функция для проверки изменений статусов заказов
async function checkOrderStatusChanges() {
    try {
        console.log(`🔍 [${serverId}] Checking orders... (tracked: ${orderStatuses.size})`);
        
        const orders = await getOrdersFromRetailCRM();
        let newApprovalsCount = 0;
        let isFirstRun = orderStatuses.size === 0; // Проверяем, первый ли это запуск
        
        if (isFirstRun) {
            console.log('🚀 First run - checking all approved orders...');
        }
        
        for (const order of orders) {
            const orderId = order.id;
            const currentStatus = order.status;
            const currentUpdate = order.updatedAt || order.dateCreate;
            
            // Получаем предыдущий статус
            const previousData = orderStatuses.get(orderId);
            
            if (!previousData) {
                // Первый раз видим этот заказ
                orderStatuses.set(orderId, {
                    status: currentStatus,
                    lastUpdate: currentUpdate
                });
                
                // Если заказ уже approved, добавляем в отслеживание (но не отправляем уведомление при первом запуске)
                if (currentStatus === 'approved') {
                    if (isFirstRun) {
                        console.log(`✅ Order ${order.number || orderId} is already approved - added to tracking (first run)`);
                    } else {
                        console.log(`🆕 New approved order ${order.number || orderId} found!`);
                        const message = await formatOrderMessage(order);
                        await sendTelegramMessage(message, order.telegramChannel);
                        newApprovalsCount++;
                    }
                }
            } else {
                // Проверяем, изменился ли статус
                if (previousData.status !== currentStatus) {
                    console.log(`🔄 Order ${order.number || orderId} status changed: ${previousData.status} → ${currentStatus}`);
                    
                    // Если статус изменился на approved, отправляем уведомление
                    if (currentStatus === 'approved') {
                        console.log(`🆕 Order ${order.number || orderId} was just approved!`);
                        
                        const message = await formatOrderMessage(order);
                        await sendTelegramMessage(message, order.telegramChannel);
                        newApprovalsCount++;
                    }
                    
                    // Обновляем информацию о заказе
                    orderStatuses.set(orderId, {
                        status: currentStatus,
                        lastUpdate: currentUpdate
                    });
                }
                // Убираем логирование неизмененных статусов для экономии ресурсов
            }
        }
        
        if (isFirstRun) {
            console.log(`🎯 First run completed. Found ${orderStatuses.size} orders to track.`);
        } else if (newApprovalsCount > 0) {
            console.log(`✅ Sent ${newApprovalsCount} approval notification(s)`);
        }
        // Убираем избыточные логи для экономии ресурсов
        
    } catch (error) {
        console.error('❌ Error checking orders:', error.message);
    }
}

// Функция для полной проверки всех approved заказов при запуске
async function checkAllApprovedOrdersOnStartup() {
    try {
        console.log('🚀 Starting full check of all approved orders...');
        
        const orders = await getOrdersFromRetailCRM();
        let approvedOrdersFound = 0;
        
        for (const order of orders) {
            if (order.status === 'approved') {
                const orderId = order.id;
                const previousData = orderStatuses.get(orderId);
                
                if (!previousData) {
                    // Новый approved заказ - добавляем в отслеживание
                    orderStatuses.set(orderId, {
                        status: 'approved',
                        lastUpdate: order.updatedAt || order.dateCreate
                    });
                    
                    console.log(`✅ Found approved order ${order.number || orderId} - added to tracking`);
                    approvedOrdersFound++;
                } else if (previousData.status !== 'approved') {
                    // Статус изменился на approved - отправляем уведомление
                    console.log(`🆕 Order ${order.number || orderId} status changed to approved!`);
                    
                    const message = await formatOrderMessage(order);
                    await sendTelegramMessage(message, order.telegramChannel);
                    
                    // Обновляем статус
                    orderStatuses.set(orderId, {
                        status: 'approved',
                        lastUpdate: order.updatedAt || order.dateCreate
                    });
                    
                    approvedOrdersFound++;
                }
            }
        }
        
        console.log(`🎯 Found ${approvedOrdersFound} approved orders on startup`);
        
    } catch (error) {
        console.error('❌ Error checking approved orders on startup:', error.message);
    }
}

// Запускаем периодическую проверку каждые 30 секунд
setInterval(checkOrderStatusChanges, 30000);

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
        trackedOrders: orderStatuses.size
    });
});

// Endpoint для ручной проверки
app.get('/check-orders', async (req, res) => {
    await checkOrderStatusChanges();
    res.json({ 
        message: 'Status change check completed',
        timestamp: new Date().toISOString()
    });
});

// Endpoint для просмотра отслеживаемых заказов
app.get('/orders-status', (req, res) => {
    const ordersList = Array.from(orderStatuses.entries()).map(([id, data]) => ({
        orderId: id,
        status: data.status,
        lastUpdate: data.lastUpdate
    }));
    
    res.json({
        trackedOrders: orderStatuses.size,
        orders: ordersList
    });
});

// Endpoint для ручной проверки всех approved заказов
app.get('/check-all-approved', async (req, res) => {
    try {
        await checkAllApprovedOrdersOnStartup();
        res.json({ 
            message: 'Full approved orders check completed',
            timestamp: new Date().toISOString(),
            trackedOrders: orderStatuses.size
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
    const previousCount = orderStatuses.size;
    orderStatuses.clear();
    
    res.json({
        message: 'Server memory reset',
        previousTrackedOrders: previousCount,
        currentTrackedOrders: 0,
        timestamp: new Date().toISOString()
    });
    
    console.log(`🧹 Server memory reset. Previous tracked orders: ${previousCount}`);
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`🚀 Smart Polling server started on port ${PORT}`);
    console.log(`🧪 Test: http://localhost:${PORT}/test`);
    console.log(`🔍 Check orders: http://localhost:${PORT}/check-orders`);
    console.log(`📊 Order statuses: http://localhost:${PORT}/orders-status`);
    console.log(`⏰ Checking every 30 seconds`);
    
    // Запускаем первую проверку сразу
    checkOrderStatusChanges();
});

module.exports = app;

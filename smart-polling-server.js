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
        
        // Получаем заказы из всех настроенных аккаунтов
        for (const account of retailCRMAccounts) {
            try {
                console.log(`🔍 Checking orders from ${account.name}...`);
                
                                // Пытаемся использовать RetailCRM фильтры для получения ТОЛЬКО approved заказов
                console.log(`🎯 Attempting to fetch ONLY approved orders using RetailCRM filters...`);
                
                let page = 1;
                let hasMoreOrders = true;
                let totalOrders = 0;
                const maxPages = 50; // Безопасное ограничение
                
                // Пробуем разные варианты фильтрации статуса
                const statusFilters = [
                    { status: 'approved' },
                    { statusCode: 'approved' },
                    { orderStatus: 'approved' },
                    { 'filter[status]': 'approved' },
                    { status: 5 }, // Возможно, нужен ID статуса
                    {} // Без фильтра (fallback)
                ];
                
                let currentFilterIndex = 0;
                let currentFilter = statusFilters[currentFilterIndex];
                
                while (hasMoreOrders && page <= maxPages) {
                    const response = await axios.get(`${account.url}/api/v5/orders`, {
                        params: { 
                            apiKey: account.apiKey,
                            limit: 100, // RetailCRM требует 20, 50 или 100
                            page: page,
                            ...currentFilter // Применяем текущий фильтр
                        }
                    });
                    
                    if (response.data.success && response.data.orders && response.data.orders.length > 0) {
                        // Диагностика: показываем статусы заказов на каждой странице
                        const statusCounts = {};
                        response.data.orders.forEach(order => {
                            const status = order.status || 'unknown';
                            statusCounts[status] = (statusCounts[status] || 0) + 1;
                        });
                        
                        console.log(`📄 Page ${page}: Got ${response.data.orders.length} orders, statuses:`, statusCounts);
                        console.log(`🔍 Using filter:`, currentFilter);
                        
                        // Проверяем, действительно ли это approved заказы
                        const approvedOrders = response.data.orders.filter(order => order.status === 'approved');
                        console.log(`✅ Page ${page}: Found ${approvedOrders.length} actual approved orders`);
                        
                        // Если фильтр работает (много approved заказов), продолжаем
                        if (approvedOrders.length > 0) {
                            // Добавляем информацию об аккаунте к каждому approved заказу
                            const ordersWithAccount = approvedOrders.map(order => ({
                                ...order,
                                accountName: account.name,
                                accountUrl: account.url,
                                accountCurrency: account.currency,
                                telegramChannel: account.telegramChannel
                            }));
                            
                            allOrders = allOrders.concat(ordersWithAccount);
                            totalOrders += approvedOrders.length;
                            
                            // Если получили меньше 100 заказов, значит это последняя страница
                            if (response.data.orders.length < 100) {
                                hasMoreOrders = false;
                            } else {
                                page++;
                            }
                        } else {
                            // Если фильтр не работает, пробуем следующий
                            if (currentFilterIndex < statusFilters.length - 1) {
                                currentFilterIndex++;
                                currentFilter = statusFilters[currentFilterIndex];
                                console.log(`🔄 Filter not working, trying next:`, currentFilter);
                                page = 1; // Начинаем с первой страницы
                                continue;
                            } else {
                                // Все фильтры испробованы, останавливаемся
                                console.log(`⚠️ All filters tried, no approved orders found, stopping pagination`);
                                hasMoreOrders = false;
                            }
                        }
                    } else {
                        hasMoreOrders = false;
                        if (!response.data.success) {
                            console.error(`❌ Error on page ${page}:`, response.data.errorMsg);
                        }
                    }
                }
                
                if (page > maxPages) {
                    console.log(`⚠️ Reached maximum page limit (${maxPages}), stopping pagination for safety`);
                }
                
                console.log(`✅ Total: Got ${totalOrders} orders from ${account.name}`);
                
                // Показываем статусы заказов для диагностики
                const statusCounts = {};
                allOrders.forEach(order => {
                    const status = order.status || 'unknown';
                    statusCounts[status] = (statusCounts[status] || 0) + 1;
                });
                console.log(`📊 Status breakdown:`, statusCounts);
                
                // Показываем диапазон дат заказов для понимания покрытия
                if (allOrders.length > 0) {
                    const dates = allOrders.map(order => order.date || order.createdAt || order.updatedAt).filter(Boolean);
                    if (dates.length > 0) {
                        const oldestDate = new Date(Math.min(...dates.map(d => new Date(d))));
                        const newestDate = new Date(Math.max(...dates.map(d => new Date(d))));
                        console.log(`📅 Date range: ${oldestDate.toLocaleDateString()} - ${newestDate.toLocaleDateString()}`);
                    }
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

// Функция для проверки и отправки уведомлений о approved заказах
async function checkAndSendApprovedOrders() {
    try {
        console.log(`🔍 [${serverId}] Checking for approved orders...`);
        
        const orders = await getOrdersFromRetailCRM();
        let newApprovalsCount = 0;
        
        console.log(`🔍 Processing ${orders.length} orders...`);
        
        for (const order of orders) {
            const orderId = order.id;
            const orderNumber = order.number || orderId;
            
            // Теперь все заказы уже approved (благодаря фильтру RetailCRM)
            console.log(`✅ Found approved order: ${orderNumber} (ID: ${orderId})`);
            
            // Если уведомление для этого заказа еще не отправлялось
            if (!approvedOrdersSent.has(orderId)) {
                console.log(`🆕 New approved order found: ${orderNumber}`);
                
                // Отправляем уведомление
                const message = await formatOrderMessage(order);
                await sendTelegramMessage(message, order.telegramChannel);
                
                // Помечаем как отправленный
                approvedOrdersSent.add(orderId);
                newApprovalsCount++;
                
                console.log(`✅ Notification sent for order ${orderNumber}`);
            } else {
                console.log(`ℹ️ Order ${orderNumber} already notified - skipping`);
            }
        }
        
        if (newApprovalsCount > 0) {
            console.log(`🎉 Sent ${newApprovalsCount} new approval notification(s)`);
        } else {
            console.log(`ℹ️ No new approved orders found`);
        }
        
        console.log(`📊 Total approved orders tracked: ${approvedOrdersSent.size}`);
        
    } catch (error) {
        console.error('❌ Error checking approved orders:', error.message);
    }
}

// Запускаем периодическую проверку каждые 30 секунд
setInterval(checkAndSendApprovedOrders, 30000);

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

// Webhook endpoint для получения уведомлений от RetailCRM
app.post('/webhook/retailcrm', async (req, res) => {
    try {
        console.log('🔔 Webhook received from RetailCRM');
        console.log('📋 Webhook data:', JSON.stringify(req.body, null, 2));
        
        const webhookData = req.body;
        
        // Проверяем, что это уведомление об изменении заказа
        if (webhookData.event === 'order' && webhookData.data) {
            const order = webhookData.data;
            const orderId = order.id;
            const orderNumber = order.number || orderId;
            const orderStatus = order.status;
            
            console.log(`📦 Order ${orderNumber} status changed to: ${orderStatus}`);
            
            // Если заказ стал approved, отправляем уведомление
            if (orderStatus === 'approved') {
                console.log(`🎉 Order ${orderNumber} is now APPROVED!`);
                
                // Проверяем, не отправляли ли уже уведомление
                if (!approvedOrdersSent.has(orderId)) {
                    console.log(`🆕 New approved order via webhook: ${orderNumber}`);
                    
                    // Добавляем информацию об аккаунте (определяем по URL)
                    const account = retailCRMAccounts.find(acc => 
                        order.url && order.url.includes(acc.url.replace('https://', '').replace('http://', ''))
                    ) || retailCRMAccounts[0];
                    
                    const orderWithAccount = {
                        ...order,
                        accountName: account.name,
                        accountUrl: account.url,
                        accountCurrency: account.currency,
                        telegramChannel: account.telegramChannel
                    };
                    
                    // Отправляем уведомление
                    const message = await formatOrderMessage(orderWithAccount);
                    await sendTelegramMessage(message, orderWithAccount.telegramChannel);
                    
                    // Помечаем как отправленный
                    approvedOrdersSent.add(orderId);
                    
                    console.log(`✅ Webhook notification sent for order ${orderNumber}`);
                } else {
                    console.log(`ℹ️ Order ${orderNumber} already notified via webhook - skipping`);
                }
            }
        }
        
        res.json({ success: true, message: 'Webhook processed' });
    } catch (error) {
        console.error('❌ Error processing webhook:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`🚀 Smart Polling server started on port ${PORT}`);
    console.log(`🧪 Test: http://localhost:${PORT}/test`);
    console.log(`🔍 Check orders: http://localhost:${PORT}/check-orders`);
    console.log(`📊 Order statuses: http://localhost:${PORT}/orders-status`);
    console.log(`🔔 Webhook: http://localhost:${PORT}/webhook/retailcrm`);
    console.log(`⏰ Polling every 30 seconds + Webhook for real-time updates`);
    
    // Запускаем первую проверку сразу
    checkAndSendApprovedOrders();
});

module.exports = app;

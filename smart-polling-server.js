const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Хранилище для отслеживания статусов заказов
const orderStatuses = new Map(); // orderId -> { status, lastUpdate }

// Функция для отправки сообщения в Telegram
async function sendTelegramMessage(message) {
    try {
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        const channelId = process.env.TELEGRAM_CHANNEL_ID;
        
        if (!botToken || !channelId) {
            console.error('Missing Telegram settings');
            return false;
        }

        const response = await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            chat_id: channelId,
            text: message,
            parse_mode: 'HTML'
        });

        console.log('✅ Message sent to Telegram');
        return true;
    } catch (error) {
        console.error('❌ Error sending to Telegram:', error.message);
        return false;
    }
}

// Функция для получения заказов из RetailCRM
async function getOrdersFromRetailCRM() {
    try {
        const retailcrmUrl = process.env.RETAILCRM_URL;
        const apiKey = process.env.RETAILCRM_API_KEY;
        
        if (!retailcrmUrl || !apiKey) {
            console.error('Missing RetailCRM settings');
            return [];
        }

        // Получаем заказы с разными статусами для отслеживания изменений
        const response = await axios.get(`${retailcrmUrl}/api/v5/orders`, {
            params: { 
                apiKey,
                limit: 100 // RetailCRM requires: 20, 50 or 100
            }
        });

        if (response.data.success) {
            return response.data.orders || [];
        } else {
            console.error('Error getting orders:', response.data.errorMsg);
            return [];
        }
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
        console.log('🔍 Checking order status changes...');
        
        const orders = await getOrdersFromRetailCRM();
        let newApprovalsCount = 0;
        
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
                
                // Если заказ уже approved И сервер только что запустился, не отправляем уведомление
                if (currentStatus === 'approved') {
                    console.log(`ℹ️ Order ${order.number || orderId} was already approved before (server just started)`);
                }
            } else {
                // Проверяем, изменился ли статус
                if (previousData.status !== currentStatus) {
                    console.log(`🔄 Order ${order.number || orderId} status changed: ${previousData.status} → ${currentStatus}`);
                    
                    // Если статус изменился на approved, отправляем уведомление
                    if (currentStatus === 'approved') {
                        console.log(`🆕 Order ${order.number || orderId} was just approved!`);
                        
                        const message = await formatOrderMessage(order);
                        await sendTelegramMessage(message);
                        newApprovalsCount++;
                    }
                    
                    // Обновляем информацию о заказе
                    orderStatuses.set(orderId, {
                        status: currentStatus,
                        lastUpdate: currentUpdate
                    });
                }
            }
        }
        
        if (newApprovalsCount > 0) {
            console.log(`✅ Sent notifications about new approvals: ${newApprovalsCount}`);
        } else {
            console.log('ℹ️ No new approvals found');
        }
        
    } catch (error) {
        console.error('❌ Error checking orders:', error.message);
    }
}

// Запускаем периодическую проверку каждые 30 секунд
setInterval(checkOrderStatusChanges, 30000);

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

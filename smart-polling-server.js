const express = require('express');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
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

// База данных для отслеживания отправленных уведомлений
const dbPath = path.join(__dirname, 'notifications.db');
const db = new sqlite3.Database(dbPath);

// Инициализация базы данных
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS sent_notifications (
        order_id TEXT PRIMARY KEY,
        order_number TEXT,
        account_name TEXT,
        sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        telegram_message TEXT
    )`);
    
    // Создаем дополнительные индексы для защиты от дублирования
    db.run(`CREATE INDEX IF NOT EXISTS idx_order_id ON sent_notifications(order_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_order_number ON sent_notifications(order_number)`);
    
    console.log('🗄️ Database initialized successfully with protection indexes');
});

// Функция для атомарной проверки и сохранения (защита от race conditions)
function checkAndSaveNotification(orderId, orderNumber, accountName, message) {
    return new Promise((resolve) => {
        // Используем транзакцию для атомарности
        db.serialize(() => {
            db.run('BEGIN TRANSACTION');
            
            // Проверяем, было ли уже отправлено уведомление
            db.get('SELECT order_id FROM sent_notifications WHERE order_id = ?', [orderId], (err, row) => {
                if (err) {
                    console.error('❌ Database error during check:', err.message);
                    db.run('ROLLBACK');
                    resolve({ alreadySent: false, error: true });
                    return;
                }
                
                if (row) {
                    // Заказ уже был отправлен
                    db.run('ROLLBACK');
                    resolve({ alreadySent: true, error: false });
                    return;
                }
                
                // Заказ не найден, сохраняем информацию
                db.run('INSERT INTO sent_notifications (order_id, order_number, account_name, telegram_message) VALUES (?, ?, ?, ?)', 
                    [orderId, orderNumber, accountName, message], function(err) {
                    if (err) {
                        console.error('❌ Database error during save:', err.message);
                        db.run('ROLLBACK');
                        resolve({ alreadySent: false, error: true });
                        return;
                    }
                    
                    // Успешно сохранили
                    db.run('COMMIT');
                    resolve({ alreadySent: false, error: false });
                });
            });
        });
    });
}

// Функция для проверки, было ли уже отправлено уведомление (для чтения)
function isNotificationSent(orderId) {
    return new Promise((resolve) => {
        db.get('SELECT order_id FROM sent_notifications WHERE order_id = ?', [orderId], (err, row) => {
            resolve(!!row);
        });
    });
}

// Функция для получения количества отслеживаемых заказов
function getTrackedOrdersCount() {
    return new Promise((resolve) => {
        db.get('SELECT COUNT(*) as count FROM sent_notifications', (err, row) => {
            resolve(row ? row.count : 0);
        });
    });
}

// Функция для очистки старых записей (опционально, для экономии места)
function cleanupOldRecords(daysToKeep = 365) {
    return new Promise((resolve) => {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
        const cutoffDateStr = cutoffDate.toISOString().split('T')[0];
        
        db.run('DELETE FROM sent_notifications WHERE date(sent_at) < ?', [cutoffDateStr], function(err) {
            if (err) {
                console.error('❌ Error cleaning up old records:', err.message);
            } else {
                console.log(`🧹 Cleaned up old records older than ${daysToKeep} days`);
            }
            resolve();
        });
    });
}

// Добавляем логирование для диагностики
console.log(`🆔 Server started with ID: ${serverId}`);

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
            
            // Атомарная проверка и сохранение (защита от race conditions)
            const result = await checkAndSaveNotification(orderId, orderNumber, order.accountName, '');
            
            if (result.error) {
                console.log(`⚠️ Database error for ${orderNumber}, skipping`);
                continue;
            }
            
            if (result.alreadySent) {
                console.log(`ℹ️ Already sent: ${orderNumber}`);
                continue;
            }
            
            // Заказ новый, отправляем уведомление
            console.log(`🆕 New: ${orderNumber}`);
            const message = await formatOrderMessage(order);
            const sent = await sendTelegramMessage(message, order.telegramChannel);
            
            if (sent) {
                // Обновляем сообщение в базе данных
                await new Promise((resolve) => {
                    db.run('UPDATE sent_notifications SET telegram_message = ? WHERE order_id = ?', 
                        [message, orderId], (err) => {
                        if (err) {
                            console.error('❌ Error updating message in DB:', err.message);
                        }
                        resolve();
                    });
                });
                
                newApprovalsCount++;
            } else {
                // Если отправка не удалась, удаляем запись из БД
                await new Promise((resolve) => {
                    db.run('DELETE FROM sent_notifications WHERE order_id = ?', [orderId], (err) => {
                        if (err) {
                            console.error('❌ Error cleaning up failed notification:', err.message);
                        }
                        resolve();
                    });
                });
            }
        }
        
        if (newApprovalsCount > 0) {
            console.log(`🎉 Sent ${newApprovalsCount} new notifications`);
        }
        
        // Получаем количество отслеживаемых заказов из базы данных
        const trackedCount = await getTrackedOrdersCount();
        console.log(`📊 Total tracked in DB: ${trackedCount}`);
        
    } catch (error) {
        console.error('❌ Error checking approved orders:', error.message);
    }
}

// Запускаем периодическую проверку каждую минуту (оптимизация для бесплатного тарифа)
setInterval(checkAndSendApprovedOrders, 60000);

// Автоматическая очистка старых записей каждые 24 часа (экономия места)
setInterval(() => {
    cleanupOldRecords(365); // Очищаем записи старше 1 года
}, 24 * 60 * 60 * 1000);

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
app.get('/test', async (req, res) => {
    try {
        const trackedCount = await getTrackedOrdersCount();
        res.json({ 
            message: 'Smart Polling server is working!',
            timestamp: new Date().toISOString(),
            trackedOrders: trackedCount,
            database: 'SQLite active'
        });
    } catch (error) {
        res.status(500).json({ error: 'Database error', message: error.message });
    }
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
app.get('/orders-status', async (req, res) => {
    try {
        db.all('SELECT order_id, order_number, account_name, sent_at FROM sent_notifications ORDER BY sent_at DESC LIMIT 100', (err, rows) => {
            if (err) {
                res.status(500).json({ error: 'Database error', message: err.message });
                return;
            }
            
            res.json({
                trackedOrders: rows.length,
                orders: rows
            });
        });
    } catch (error) {
        res.status(500).json({ error: 'Server error', message: error.message });
    }
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

// Endpoint для сброса базы данных
app.get('/reset-database', (req, res) => {
    try {
        db.run('DELETE FROM sent_notifications', (err) => {
            if (err) {
                res.status(500).json({ error: 'Database error', message: err.message });
                return;
            }
            
            res.json({
                message: 'Database reset successfully',
                previousTrackedOrders: 'All cleared',
                currentTrackedOrders: 0,
                timestamp: new Date().toISOString()
            });
            
            console.log(`🧹 Database reset successfully`);
        });
    } catch (error) {
        res.status(500).json({ error: 'Server error', message: error.message });
    }
});

// Endpoint для очистки старых записей
app.get('/cleanup-old-records/:days', async (req, res) => {
    try {
        const days = parseInt(req.params.days) || 365;
        await cleanupOldRecords(days);
        
        const count = await getTrackedOrdersCount();
        res.json({
            message: `Cleaned up records older than ${days} days`,
            currentTrackedOrders: count,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ error: 'Server error', message: error.message });
    }
});

// Endpoint для просмотра информации о конкретном заказе
app.get('/order-info/:orderId', (req, res) => {
    const orderId = req.params.orderId;
    
    db.get('SELECT * FROM sent_notifications WHERE order_id = ?', [orderId], (err, row) => {
        if (err) {
            res.status(500).json({ error: 'Database error', message: err.message });
            return;
        }
        
        if (row) {
            res.json({
                found: true,
                order: row
            });
        } else {
            res.json({
                found: false,
                message: `Order ${orderId} not found in database`
            });
        }
    });
});

// Простая и эффективная стратегия: проверяем последние 5000 заказов каждые 30 секунд

// Запуск сервера
app.listen(PORT, () => {
    console.log(`🚀 Server started on port ${PORT}`);
    console.log(`🔍 Check: http://localhost:${PORT}/check-orders`);
    console.log(`📊 Status: http://localhost:${PORT}/orders-status`);
    console.log(`🗄️ Database: http://localhost:${PORT}/order-info/:orderId`);
    console.log(`🧹 Cleanup: http://localhost:${PORT}/cleanup-old-records/365`);
    console.log(`⏰ Polling every 60s - last 5000 orders (with advanced DB protection)`);
    
    // Запускаем первую проверку сразу
    checkAndSendApprovedOrders();
});

module.exports = app;

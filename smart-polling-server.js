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
    },
    {
        name: 'Account 3 (SlimTeaPro)',
        url: process.env.RETAILCRM_URL_3,
        apiKey: process.env.RETAILCRM_API_KEY_3,
        telegramChannel: process.env.TELEGRAM_CHANNEL_ID_3 || process.env.TELEGRAM_CHANNEL_ID_1 || process.env.TELEGRAM_CHANNEL_ID,
        currency: process.env.CURRENCY_3 || 'GHS'
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
        order_number TEXT UNIQUE,
        account_name TEXT,
        sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        telegram_message TEXT
    )`);
    
    // Создаем дополнительные индексы для защиты от дублирования
    db.run(`CREATE INDEX IF NOT EXISTS idx_order_id ON sent_notifications(order_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_order_number ON sent_notifications(order_number)`);
    
    // Добавляем уникальный индекс на order_number для дополнительной защиты
    db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_order_number_unique ON sent_notifications(order_number)`);
    
    console.log('🗄️ Database initialized successfully with protection indexes');
});

// Функция для атомарной проверки и сохранения (защита от race conditions)
function checkAndSaveNotification(orderId, orderNumber, accountName, message) {
    return new Promise((resolve) => {
        // Проверяем, было ли уже отправлено уведомление (по ID или номеру)
        db.get('SELECT order_id FROM sent_notifications WHERE order_id = ? OR order_number = ?', [orderId, orderNumber], (err, row) => {
            if (err) {
                console.error('❌ Database error during check:', err.message);
                resolve({ alreadySent: false, error: true });
                return;
            }
            
            if (row) {
                // Заказ уже был отправлен
                console.log(`ℹ️ Order already exists in DB: ${orderNumber} (ID: ${orderId})`);
                resolve({ alreadySent: true, error: false });
                return;
            }
            
            // Заказ не найден, сохраняем информацию
            db.run('INSERT INTO sent_notifications (order_id, order_number, account_name, telegram_message) VALUES (?, ?, ?, ?)', 
                [orderId, orderNumber, accountName, message], function(err) {
                if (err) {
                    // Проверяем, не нарушает ли это уникальность
                    if (err.message.includes('UNIQUE constraint failed')) {
                        console.log(`⚠️ Unique constraint violation for ${orderNumber}, order already exists`);
                        resolve({ alreadySent: true, error: false });
                        return;
                    }
                    
                    console.error('❌ Database error during save:', err.message);
                    resolve({ alreadySent: false, error: true });
                    return;
                }
                
                // Успешно сохранили
                resolve({ alreadySent: false, error: false });
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
        
        const response = await fetchOrders(
            `${account.url}/api/v5/orders`,
            { 
                apiKey: account.apiKey,
                limit: 100,
                number: orderNumber
            }
        );

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

// Функция для выполнения запроса (без retry для stream errors - они не помогают)
async function fetchOrders(url, params) {
    try {
        const response = await axios.get(url, {
            params,
            timeout: 45000 // 45 секунд - достаточно для запроса
        });
        return response;
    } catch (error) {
        // Логируем ошибку, но не делаем retry - если stream aborted, retry не поможет
        throw error;
    }
}

// Функция для получения заказов из RetailCRM
async function getOrdersFromRetailCRM() {
    try {
        let allOrders = [];
        
        for (const account of retailCRMAccounts) {
            try {
                console.log(`🔍 Fetching approved orders from ${account.name}...`);
                
                // Используем фильтр по статусу прямо в API - это намного эффективнее!
                // Ограничиваем до 5 страниц (500 заказов) - этого достаточно для проверки новых
                let page = 1;
                let hasMoreOrders = true;
                let totalProcessed = 0;
                let approvedCount = 0;
                const maxPages = 5; // Только первые 5 страниц
                
                while (hasMoreOrders && page <= maxPages) {
                    try {
                        const response = await fetchOrders(
                            `${account.url}/api/v5/orders`,
                            { 
                                apiKey: account.apiKey,
                                status: 'approved', // Фильтруем на стороне API!
                                limit: 100, 
                                page
                            }
                        );
                    
                        if (response.data.success && response.data.orders?.length > 0) {
                            const orders = response.data.orders;
                            totalProcessed += orders.length;
                            
                            // Все заказы уже approved (благодаря фильтру в API)
                            const ordersWithAccount = orders.map(order => ({
                                ...order, 
                                accountName: account.name, 
                                accountUrl: account.url,
                                accountCurrency: account.currency, 
                                telegramChannel: account.telegramChannel
                            }));
                            
                            allOrders = allOrders.concat(ordersWithAccount);
                            approvedCount += orders.length;
                            
                            // Проверяем, есть ли еще страницы
                            if (orders.length < 100) {
                                hasMoreOrders = false;
                            } else {
                                page++;
                            }
                        } else {
                            hasMoreOrders = false;
                        }
                    } catch (pageError) {
                        console.error(`❌ Page ${page} error for ${account.name}:`, pageError.message);
                        // При ошибке пропускаем этот аккаунт
                        break;
                    }
                }
                
                console.log(`📊 ${account.name}: ${approvedCount} approved orders from ${totalProcessed} total orders`);
                
                // Задержка между аккаунтами для снижения нагрузки
                if (retailCRMAccounts.indexOf(account) < retailCRMAccounts.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 2000)); // 2 секунды между аккаунтами
                }
                
            } catch (error) {
                console.error(`❌ ${account.name}:`, error.message);
                // Продолжаем с другими аккаунтами при ошибке
                continue;
            }
        }
        
        // Сортируем все заказы по ID для консистентности
        allOrders.sort((a, b) => {
            const aId = parseInt(a.id) || 0;
            const bId = parseInt(b.id) || 0;
            return bId - aId; // Новые заказы первыми
        });
        
        console.log(`🎯 Total: ${allOrders.length} approved orders found`);
        return allOrders;
        
    } catch (error) {
        console.error('RetailCRM API error:', error.message);
        return [];
    }
}

// Функция для получения sent to delivery заказов за последние 10 минут
async function getRecentSentToDeliveryOrders() {
    try {
        let allSentToDeliveryOrders = [];
        
        // Вычисляем время 10 минут назад (учитываем возможные задержки RetailCRM API)
        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
        
        for (const account of retailCRMAccounts) {
            try {
                console.log(`🔍 Fetching sent to delivery orders from ${account.name} (last 10 minutes)...`);
                
                let page = 1;
                let hasMoreOrders = true;
                let totalProcessed = 0;
                let sentToDeliveryCount = 0;
                let totalPages = 0;
                
                // Ограничиваем до 3 страниц для производительности при проверке recent
                while (hasMoreOrders && page <= 3) {
                    try {
                        const response = await fetchOrders(
                            `${account.url}/api/v5/orders`,
                            { 
                                apiKey: account.apiKey,
                                status: 'sent to delivery', // Фильтруем на стороне API!
                                limit: 100, 
                                page
                            }
                        );
                    
                        if (response.data.success && response.data.orders?.length > 0) {
                            const orders = response.data.orders;
                            totalProcessed += orders.length;
                            
                            // Все заказы уже "sent to delivery" (благодаря фильтру в API)
                            // Фильтруем только те, что обновлены за последние 10 минут
                            const recentSentToDeliveryOrders = orders.filter(order => {
                                // Проверяем время последнего обновления заказа
                                const orderUpdateTime = order.updatedAt ? new Date(order.updatedAt) : 
                                                      order.statusUpdatedAt ? new Date(order.statusUpdatedAt) :
                                                      order.createdAt ? new Date(order.createdAt) : null;
                                
                                if (!orderUpdateTime) return false;
                                
                                // Заказ должен быть обновлен за последние 10 минут
                                return orderUpdateTime > tenMinutesAgo;
                            });
                            
                            if (recentSentToDeliveryOrders.length > 0) {
                                const ordersWithAccount = recentSentToDeliveryOrders.map(order => ({
                                    ...order, 
                                    accountName: account.name, 
                                    accountUrl: account.url,
                                    accountCurrency: account.currency, 
                                    telegramChannel: account.telegramChannel,
                                    originalStatus: 'sent to delivery' // Помечаем оригинальный статус
                                }));
                                
                                allSentToDeliveryOrders = allSentToDeliveryOrders.concat(ordersWithAccount);
                                sentToDeliveryCount += recentSentToDeliveryOrders.length;
                            }
                            
                            // Очищаем память каждые 5 страниц для recent проверки
                            if (page % 5 === 0) {
                                global.gc && global.gc();
                            }
                            
                            // Проверяем, есть ли еще страницы
                            if (orders.length < 100) {
                                hasMoreOrders = false;
                            } else {
                                page++;
                            }
                        } else {
                            hasMoreOrders = false;
                        }
                    } catch (pageError) {
                        console.error(`❌ Page ${page} error for sent to delivery (${account.name}):`, pageError.message);
                        // При ошибке пропускаем этот аккаунт
                        break;
                    }
                }
                
                console.log(`📊 ${account.name}: ${sentToDeliveryCount} recent sent to delivery orders from ${totalProcessed} total orders`);
                
            } catch (error) {
                console.error(`❌ ${account.name} sent to delivery error:`, error.message);
                // Продолжаем с другими аккаунтами при ошибке
                continue;
            }
        }
        
        // Сортируем все заказы по ID для консистентности
        allSentToDeliveryOrders.sort((a, b) => {
            const aId = parseInt(a.id) || 0;
            const bId = parseInt(b.id) || 0;
            return bId - aId; // Новые заказы первыми
        });
        
        console.log(`🎯 Total: ${allSentToDeliveryOrders.length} recent sent to delivery orders found`);
        return allSentToDeliveryOrders;
        
    } catch (error) {
        console.error('RetailCRM API error for sent to delivery:', error.message);
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

// Проверка approved заказов и recent sent to delivery заказов
async function checkAndSendApprovedOrders() {
    try {
        console.log(`🔍 Checking approved orders...`);
        
        const orders = await getOrdersFromRetailCRM();
        let newApprovalsCount = 0;
        let skippedCount = 0;
        let errorCount = 0;
        
        if (orders.length === 0) {
            console.log(`ℹ️ No approved orders found`);
        } else {
            console.log(`📋 Processing ${orders.length} approved orders...`);
            
            // Создаем Set для быстрой проверки дубликатов в текущей сессии
            const currentSessionOrders = new Set();
            
            for (const order of orders) {
                const orderId = order.id;
                const orderNumber = order.number || orderId;
                
                // Проверяем дубликаты в текущей сессии
                if (currentSessionOrders.has(orderId)) {
                    console.log(`⚠️ Duplicate in current session: ${orderNumber}, skipping`);
                    skippedCount++;
                    continue;
                }
                
                // Проверяем дубликаты в глобальном кэше (дополнительная защита)
                if (globalProcessedOrders.has(orderId)) {
                    console.log(`⚠️ Duplicate in global cache: ${orderNumber}, skipping`);
                    skippedCount++;
                    continue;
                }
                
                currentSessionOrders.add(orderId);
                globalProcessedOrders.add(orderId);
                
                // Атомарная проверка и сохранение (защита от race conditions)
                const result = await checkAndSaveNotification(orderId, orderNumber, order.accountName, '');
                
                if (result.error) {
                    console.log(`⚠️ Database error for ${orderNumber}, skipping`);
                    continue;
                }
                
                if (result.alreadySent) {
                    console.log(`ℹ️ Already sent: ${orderNumber}`);
                    skippedCount++;
                    continue;
                }
                
                // Заказ новый, отправляем уведомление
                console.log(`🆕 New approved: ${orderNumber}`);
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
                    
                    // Добавляем задержку между отправками (предотвращение rate limiting)
                    if (newApprovalsCount % 10 === 0) { // Каждые 10 сообщений
                        console.log(`⏳ Rate limiting protection: waiting 1 second...`);
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    } else {
                        await new Promise(resolve => setTimeout(resolve, 200)); // 200ms между сообщениями
                    }
                    
                } else {
                    // Если отправка не удалась, удаляем запись из БД и кэша
                    await new Promise((resolve) => {
                        db.run('DELETE FROM sent_notifications WHERE order_id = ?', [orderId], (err) => {
                            if (err) {
                                console.error('❌ Error cleaning up failed notification:', err.message);
                            }
                            resolve();
                        });
                    });
                    
                    globalProcessedOrders.delete(orderId);
                    errorCount++;
                    
                    // При ошибке Telegram API делаем паузу
                    console.log(`⏳ Telegram API error, waiting 5 seconds...`);
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
            }
        }
        
        // Теперь проверяем recent sent to delivery заказы
        console.log(`🔍 Checking recent sent to delivery orders...`);
        
        const sentToDeliveryOrders = await getRecentSentToDeliveryOrders();
        let sentToDeliveryCount = 0;
        let sentToDeliverySkipped = 0;
        
        if (sentToDeliveryOrders.length === 0) {
            console.log(`ℹ️ No recent sent to delivery orders found`);
        } else {
            console.log(`📋 Processing ${sentToDeliveryOrders.length} recent sent to delivery orders...`);
            
            for (const order of sentToDeliveryOrders) {
                const orderId = order.id;
                const orderNumber = order.number || orderId;
                
                // Проверяем, есть ли уже этот заказ в базе данных (отправляли ли мы его как approved)
                const isAlreadySent = await isNotificationSent(orderId);
                
                if (isAlreadySent) {
                    console.log(`ℹ️ Sent to delivery order already sent as approved: ${orderNumber}, skipping`);
                    sentToDeliverySkipped++;
                    continue;
                }
                
                // Проверяем дубликаты в глобальном кэше
                if (globalProcessedOrders.has(orderId)) {
                    console.log(`ℹ️ Sent to delivery order in global cache: ${orderNumber}, skipping`);
                    sentToDeliverySkipped++;
                    continue;
                }
                
                // Заказ не был отправлен как approved, значит система его пропустила
                // Отправляем его сейчас
                console.log(`🆕 Missed approved order (now sent to delivery): ${orderNumber}`);
                
                // Атомарная проверка и сохранение
                const result = await checkAndSaveNotification(orderId, orderNumber, order.accountName, '');
                
                if (result.error) {
                    console.log(`⚠️ Database error for sent to delivery ${orderNumber}, skipping`);
                    continue;
                }
                
                if (result.alreadySent) {
                    console.log(`ℹ️ Already sent: ${orderNumber}`);
                    sentToDeliverySkipped++;
                    continue;
                }
                
                // Отправляем уведомление
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
                    
                    sentToDeliveryCount++;
                    
                    // Добавляем задержку между отправками
                    if (sentToDeliveryCount % 10 === 0) {
                        console.log(`⏳ Rate limiting protection: waiting 1 second...`);
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    } else {
                        await new Promise(resolve => setTimeout(resolve, 200));
                    }
                    
                } else {
                    // Если отправка не удалась, удаляем запись из БД
                    await new Promise((resolve) => {
                        db.run('DELETE FROM sent_notifications WHERE order_id = ?', [orderId], (err) => {
                            if (err) {
                                console.error('❌ Error cleaning up failed sent to delivery notification:', err.message);
                            }
                            resolve();
                        });
                    });
                    
                    errorCount++;
                    
                    console.log(`⏳ Telegram API error for sent to delivery, waiting 5 seconds...`);
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
            }
        }
        
        // Итоговая статистика
        const totalNewCount = newApprovalsCount + sentToDeliveryCount;
        
        if (totalNewCount > 0) {
            console.log(`🎉 Sent ${totalNewCount} new notifications (${newApprovalsCount} approved + ${sentToDeliveryCount} missed sent to delivery)`);
        }
        
        if (skippedCount > 0) {
            console.log(`⏭️ Skipped ${skippedCount} already processed approved orders`);
        }
        
        if (sentToDeliverySkipped > 0) {
            console.log(`⏭️ Skipped ${sentToDeliverySkipped} already processed sent to delivery orders`);
        }
        
        if (errorCount > 0) {
            console.log(`❌ Failed to send ${errorCount} notifications`);
        }
        
        // Получаем количество отслеживаемых заказов из базы данных
        const trackedCount = await getTrackedOrdersCount();
        console.log(`📊 Total tracked in DB: ${trackedCount}`);
        
    } catch (error) {
        console.error('❌ Error checking approved orders:', error.message);
    }
}

// Запускаем периодическую проверку каждые 2 минуты (улучшенная скорость обработки)
setInterval(checkAndSendApprovedOrders, 120000);

// Автоматическая очистка старых записей каждые 24 часа (экономия места)
setInterval(() => {
    cleanupOldRecords(365); // Очищаем записи старше 1 года
}, 24 * 60 * 60 * 1000);

// Глобальный Set для предотвращения дубликатов между сессиями (дополнительная защита)
const globalProcessedOrders = new Set();

// Функция для загрузки существующих заказов в глобальный кэш при запуске
async function populateGlobalCache() {
    return new Promise((resolve) => {
        db.all('SELECT order_id FROM sent_notifications', (err, rows) => {
            if (err) {
                console.error('❌ Error populating global cache:', err.message);
                resolve();
                return;
            }
            
            rows.forEach(row => {
                globalProcessedOrders.add(row.order_id);
            });
            
            console.log(`🗄️ Global cache populated with ${globalProcessedOrders.size} existing orders`);
            resolve();
        });
    });
}

// Функция для очистки глобального кэша каждые 10 минут (предотвращение утечек памяти)
setInterval(() => {
    const beforeSize = globalProcessedOrders.size;
    globalProcessedOrders.clear();
    console.log(`🧹 Global cache cleared: ${beforeSize} orders removed`);
}, 10 * 60 * 1000);

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
    const notificationsList = Array.from(globalProcessedOrders);
    
    res.json({
        totalSent: globalProcessedOrders.size,
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
            trackedOrders: globalProcessedOrders.size
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

// Оптимизированная стратегия: проверяем approved + recent sent to delivery заказы каждые 5 минут

// Запуск сервера
app.listen(PORT, async () => {
    console.log(`🚀 Server started on port ${PORT}`);
    console.log(`🔍 Check: http://localhost:${PORT}/check-orders`);
    console.log(`📊 Status: http://localhost:${PORT}/orders-status`);
    console.log(`🗄️ Database: http://localhost:${PORT}/order-info/:orderId`);
    console.log(`🧹 Cleanup: http://localhost:${PORT}/cleanup-old-records/365`);
    console.log(`⏰ Polling every 2 minutes - approved + recent sent to delivery orders with retry logic & enhanced duplicate prevention`);
    
    // Загружаем существующие заказы в глобальный кэш
    await populateGlobalCache();
    
    // Первая проверка запустится автоматически через 1 минуту
    console.log(`⏳ First check will start in 1 minute...`);
    
    // Запускаем первую проверку через 1 минуту
    setTimeout(checkAndSendApprovedOrders, 60000);
});

module.exports = app;

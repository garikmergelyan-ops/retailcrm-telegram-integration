const express = require('express');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// ============================================================================
// КОНФИГУРАЦИЯ И ВАЛИДАЦИЯ
// ============================================================================

// Валидация и нормализация конфигурации аккаунтов
function validateAccount(account) {
    if (!account || typeof account !== 'object') return null;
    
    const url = account.url?.trim();
    const apiKey = account.apiKey?.trim();
    
    if (!url || !apiKey) return null;
    
    // Валидация URL
    try {
        new URL(url);
    } catch (e) {
        console.error(`❌ Invalid URL for ${account.name}: ${url}`);
        return null;
    }
    
    // Валидация API ключа (должен быть непустой строкой)
    if (typeof apiKey !== 'string' || apiKey.length < 10) {
        console.error(`❌ Invalid API key for ${account.name}`);
        return null;
    }
    
    return {
        name: account.name || 'Unknown Account',
        url: url,
        apiKey: apiKey,
        telegramChannel: account.telegramChannel?.trim() || null,
        currency: account.currency?.trim() || 'GHS'
    };
}

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
]
    .map(validateAccount)
    .filter(account => account !== null);

if (retailCRMAccounts.length === 0) {
    console.error('❌ CRITICAL: No valid RetailCRM accounts configured!');
    process.exit(1);
}

console.log(`🚀 Configured ${retailCRMAccounts.length} RetailCRM account(s)`);
retailCRMAccounts.forEach((account, index) => {
    console.log(`  ${index + 1}. ${account.name}: ${account.url}`);
});

// Валидация Telegram настроек
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN?.trim();
if (!TELEGRAM_BOT_TOKEN) {
    console.error('❌ CRITICAL: TELEGRAM_BOT_TOKEN is not set!');
    process.exit(1);
}

// ============================================================================
// БАЗА ДАННЫХ С УЛУЧШЕННОЙ ОБРАБОТКОЙ ОШИБОК
// ============================================================================

const dbPath = path.join(__dirname, 'notifications.db');
let db = null;
let dbInitialized = false;

// Инициализация базы данных с retry логикой
function initializeDatabase() {
    return new Promise((resolve, reject) => {
        if (dbInitialized && db) {
            resolve(db);
            return;
        }
        
        try {
            db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                    console.error('❌ Database connection error:', err.message);
                    reject(err);
                return;
            }
            
                console.log('🗄️ Database connection established');
                
                // Создаем таблицу с обработкой ошибок
                db.serialize(() => {
                    db.run(`CREATE TABLE IF NOT EXISTS sent_notifications (
                        order_id TEXT PRIMARY KEY,
                        order_number TEXT UNIQUE NOT NULL,
                        account_name TEXT NOT NULL,
                        sent_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )`, (err) => {
                        if (err) {
                            console.error('❌ Error creating table:', err.message);
                            reject(err);
                return;
            }
            
                        // Создаем индексы для производительности
                        db.run(`CREATE INDEX IF NOT EXISTS idx_order_number ON sent_notifications(order_number)`, (err) => {
                if (err) {
                                console.warn('⚠️ Warning: Could not create index:', err.message);
                            }
                        });
                        
                        db.run(`CREATE INDEX IF NOT EXISTS idx_account_name ON sent_notifications(account_name)`, (err) => {
                            if (err) {
                                console.warn('⚠️ Warning: Could not create index:', err.message);
                            }
                        });
                        
                        dbInitialized = true;
                        console.log('🗄️ Database initialized successfully');
                        resolve(db);
            });
        });
    });
            
            // Обработка ошибок БД
            db.on('error', (err) => {
                console.error('❌ Database error:', err.message);
                dbInitialized = false;
            });
            
        } catch (error) {
            console.error('❌ Failed to initialize database:', error.message);
            reject(error);
        }
    });
}

// Атомарная функция для проверки и сохранения заказа с улучшенной обработкой ошибок
function checkAndSaveOrder(orderId, orderNumber, accountName) {
    return new Promise((resolve) => {
        // Валидация входных данных
        if (!orderId || !orderNumber || !accountName) {
            resolve({ saved: false, error: 'Invalid input parameters', isDuplicate: false });
            return;
        }
        
        // Проверка инициализации БД
        if (!db || !dbInitialized) {
            console.error('❌ Database not initialized');
            resolve({ saved: false, error: 'Database not initialized', isDuplicate: false });
            return;
        }
        
        // Используем INSERT OR IGNORE для атомарной операции
        db.run(
            'INSERT OR IGNORE INTO sent_notifications (order_id, order_number, account_name) VALUES (?, ?, ?)',
            [String(orderId), String(orderNumber), String(accountName)],
            function(err) {
            if (err) {
                    // Если ошибка уникальности - это дубликат
                    if (err.message && err.message.includes('UNIQUE constraint')) {
                        resolve({ saved: false, isDuplicate: true, error: null });
            } else {
                        console.error(`❌ Database error saving order ${orderNumber}:`, err.message);
                        resolve({ saved: false, error: err.message, isDuplicate: false });
                    }
                    return;
                }
                
                // Если changes === 0, значит заказ уже был в БД (дубликат)
                // Если changes > 0, значит заказ был успешно добавлен
                resolve({
                    saved: this.changes > 0,
                    isDuplicate: this.changes === 0,
                    error: null
                });
            }
        );
    });
}

// ============================================================================
// КЭШИРОВАНИЕ ОПЕРАТОРОВ С АВТООЧИСТКОЙ
// ============================================================================

const operatorCache = new Map();
const OPERATOR_CACHE_TTL = 60 * 60 * 1000; // 1 час
const MAX_CACHE_SIZE = 1000; // Максимальный размер кэша

// Очистка устаревших записей из кэша
function cleanOperatorCache() {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, value] of operatorCache.entries()) {
        if (now - value.timestamp > OPERATOR_CACHE_TTL) {
            operatorCache.delete(key);
            cleaned++;
        }
    }
    
    // Если кэш слишком большой, удаляем самые старые записи
    if (operatorCache.size > MAX_CACHE_SIZE) {
        const entries = Array.from(operatorCache.entries())
            .sort((a, b) => a[1].timestamp - b[1].timestamp);
        
        const toRemove = operatorCache.size - MAX_CACHE_SIZE;
        for (let i = 0; i < toRemove; i++) {
            operatorCache.delete(entries[i][0]);
        }
    }
    
    if (cleaned > 0) {
        console.log(`🧹 Cleaned ${cleaned} expired operator cache entries`);
    }
}

// Периодическая очистка кэша (каждые 30 минут)
setInterval(cleanOperatorCache, 30 * 60 * 1000);

// ============================================================================
// ФУНКЦИИ ДЛЯ РАБОТЫ С API
// ============================================================================

// Оптимизированная функция для получения информации об операторе с кэшированием и retry
async function getManagerInfo(managerId, accountUrl, accountApiKey, retryCount = 0) {
    const MAX_RETRIES = 2;
    
    try {
        // Валидация входных данных
        if (!accountUrl || !accountApiKey || !managerId) {
            return null;
        }
        
        // Проверяем кэш
        const cacheKey = `${accountUrl}-${managerId}`;
        const cached = operatorCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < OPERATOR_CACHE_TTL) {
            return cached.name;
        }
        
        // Получаем из API с retry логикой
        try {
            const response = await axios.get(`${accountUrl}/api/v5/users/${managerId}`, {
                params: { apiKey: accountApiKey },
                timeout: 20000,
                headers: {
                    'Connection': 'keep-alive',
                    'Accept': 'application/json',
                    'User-Agent': 'RetailCRM-Integration/1.0'
                },
                validateStatus: (status) => status < 500 // Не считаем 4xx ошибками для retry
            });
            
            if (response.data && response.data.success && response.data.user) {
                const user = response.data.user;
                const name = (user.firstName && user.lastName) ?
                    `${user.firstName} ${user.lastName}` :
                    (user.firstName || user.lastName || `ID: ${managerId}`);
                
                // Сохраняем в кэш
                operatorCache.set(cacheKey, { name, timestamp: Date.now() });
                return name;
            }
            
            return null;
        } catch (apiError) {
            // Retry для сетевых ошибок
            if (retryCount < MAX_RETRIES && (
                apiError.code === 'ECONNRESET' ||
                apiError.code === 'ETIMEDOUT' ||
                apiError.code === 'ENOTFOUND' ||
                (apiError.response && apiError.response.status >= 500)
            )) {
                const delay = Math.pow(2, retryCount) * 1000; // Exponential backoff
                await new Promise(resolve => setTimeout(resolve, delay));
                return getManagerInfo(managerId, accountUrl, accountApiKey, retryCount + 1);
            }
            
            // Не логируем 404 (пользователь не найден) как ошибку
            if (apiError.response && apiError.response.status === 404) {
                return null;
            }
            
            return null;
        }
    } catch (error) {
        return null;
    }
}

// Улучшенная функция для отправки сообщения в Telegram с полной обработкой ошибок
async function sendTelegramMessage(message, channelId, retryCount = 0) {
    const MAX_RETRIES = 3;
    
    try {
        // Валидация входных данных
        if (!message || typeof message !== 'string' || message.trim().length === 0) {
            console.error('❌ Invalid message for Telegram');
            return false;
        }
        
        const botToken = TELEGRAM_BOT_TOKEN;
        const targetChannel = channelId?.trim() || process.env.TELEGRAM_CHANNEL_ID?.trim();
        
        if (!botToken || !targetChannel) {
            console.error('❌ Missing Telegram settings');
            return false;
        }
        
        // Валидация длины сообщения (Telegram лимит: 4096 символов)
        if (message.length > 4096) {
            console.error('❌ Message too long for Telegram (max 4096 characters)');
            return false;
        }
        
        try {
            const response = await axios.post(
                `https://api.telegram.org/bot${botToken}/sendMessage`,
                {
                    chat_id: targetChannel,
                    text: message,
                    parse_mode: 'HTML'
                },
                {
                    timeout: 15000,
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    validateStatus: (status) => status < 500
                }
            );
            
            return true;
        } catch (error) {
            // Обработка rate limiting (429)
            if (error.response && error.response.status === 429) {
                if (retryCount < MAX_RETRIES) {
                    const retryAfter = error.response.data?.parameters?.retry_after || 10;
                    console.log(`⏳ Telegram rate limit, waiting ${retryAfter} seconds...`);
                    await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
                    return sendTelegramMessage(message, channelId, retryCount + 1);
                } else {
                    console.error('❌ Telegram rate limit exceeded after retries');
                    return false;
                }
            }
            
            // Retry для сетевых ошибок
            if (retryCount < MAX_RETRIES && (
                error.code === 'ECONNRESET' ||
                error.code === 'ETIMEDOUT' ||
                error.code === 'ENOTFOUND' ||
                (error.response && error.response.status >= 500)
            )) {
                const delay = Math.pow(2, retryCount) * 1000;
                await new Promise(resolve => setTimeout(resolve, delay));
                return sendTelegramMessage(message, channelId, retryCount + 1);
            }
            
            // Логируем только реальные ошибки
            if (error.response) {
                console.error(`❌ Telegram API error (${error.response.status}):`, error.response.data?.description || error.message);
                            } else {
                console.error('❌ Error sending to Telegram:', error.message);
            }
            
            return false;
        }
    } catch (error) {
        console.error('❌ Unexpected error in sendTelegramMessage:', error.message);
        return false;
    }
}

// Улучшенная функция для форматирования сообщения о заказе с валидацией
async function formatOrderMessage(order) {
    try {
        // Валидация заказа
        if (!order || typeof order !== 'object') {
            throw new Error('Invalid order object');
        }
        
        const orderNumber = order.number || order.id || 'Unknown';
        
        // Оператор
        let managerName = 'Not specified';
        if (order.managerId && order.accountUrl && order.accountApiKey) {
            try {
                const manager = await getManagerInfo(order.managerId, order.accountUrl, order.accountApiKey);
                if (manager) managerName = manager;
    } catch (error) {
                // Игнорируем ошибки получения оператора
            }
        }
        
        // Товары с безопасной обработкой
        const items = Array.isArray(order.items) ? order.items : [];
        const itemsText = items.length > 0 ? items.map(item => {
            try {
                const productName = item.offer?.displayName || item.offer?.name || item.productName || 'Product';
                const quantity = item.quantity || 1;
                return `• ${String(productName)} - ${quantity} pcs`;
            } catch (error) {
                return '• Product - 1 pcs';
            }
        }).join('\n') : 'Not specified';
        
        // Адрес доставки с безопасной обработкой
        let addressText = 'Not specified';
        try {
            const deliveryAddress = order.delivery?.address;
            if (deliveryAddress) {
                if (typeof deliveryAddress === 'string') {
                    addressText = deliveryAddress;
                } else if (typeof deliveryAddress === 'object') {
                    const parts = [
                        deliveryAddress.street,
                        deliveryAddress.building,
                        deliveryAddress.apartment
                    ].filter(Boolean);
                    addressText = parts.length > 0 ? parts.join(' ') : (deliveryAddress.text || 'Not specified');
                }
        }
    } catch (error) {
            // Используем значение по умолчанию
        }
        
        const city = order.delivery?.address?.city || order.delivery?.city || 'Not specified';
        const deliveryDate = order.delivery?.date || order.deliveryDate || 'Not specified';
        
        // Телефон клиента
        const phone = order.phone || (order.contact?.phones && order.contact.phones[0]?.number) || 'Not specified';
        
        // Дополнительный телефон
        let additionalPhone = 'Not specified';
        try {
            if (order.additionalPhone) {
                additionalPhone = order.additionalPhone;
            } else if (order.contact?.phones && order.contact.phones.length > 1) {
                additionalPhone = order.contact.phones[1].number || 'Not specified';
            }
        } catch (error) {
            // Используем значение по умолчанию
        }
        
        // Имя клиента
        const customerName = [order.firstName, order.lastName].filter(Boolean).join(' ') || 'Not specified';
        
        // Время по Гане
        let ghanaTime = 'Not specified';
        try {
            ghanaTime = new Date().toLocaleString('en-GB', {
        timeZone: 'Africa/Accra',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
        } catch (error) {
            // Используем значение по умолчанию
        }
        
        // Валюта и сумма
        const currency = order.accountCurrency || 'GHS';
        const totalSumm = order.totalSumm || 0;

    return `🛒 <b>NEW ORDER APPROVED!</b>

📋 <b>Order Number:</b> ${orderNumber}
👤 <b>Operator:</b> ${managerName}
📅 <b>Delivery Date:</b> ${deliveryDate}
👨‍💼 <b>Customer Name:</b> ${customerName}
📱 <b>Phone:</b> ${phone}
📱 <b>Additional Phone:</b> ${additionalPhone}
📍 <b>Delivery Address:</b> ${addressText}
🏙️ <b>City:</b> ${city}

🛍️ <b>Products:</b>
${itemsText}

💰 <b>Order Total:</b> ${totalSumm} ${currency}

⏰ <b>Approval Time:</b> ${ghanaTime} (Ghana Time)`;
    } catch (error) {
        console.error('❌ Error formatting order message:', error.message);
        // Возвращаем минимальное сообщение в случае ошибки
        return `🛒 <b>NEW ORDER APPROVED!</b>

📋 <b>Order Number:</b> ${order.number || order.id || 'Unknown'}

⚠️ Error formatting full order details.`;
    }
}

// Оптимизированная функция для получения недавно обновленных заказов с полной обработкой ошибок
async function getApprovedOrders(account, retryCount = 0) {
    const MAX_RETRIES = 2;
    
    try {
        // Валидация аккаунта
        if (!account || !account.url || !account.apiKey) {
            console.error(`❌ Invalid account configuration for ${account?.name || 'Unknown'}`);
            return [];
        }
        
        console.log(`🔍 Fetching recently updated orders from ${account.name}...`);
        
        const approvedStatuses = ['approved', 'client-approved', 'sent to delivery'];
        const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
        
        // Вычисляем дату для фильтра (последние 24 часа)
        const dateFrom = new Date();
        dateFrom.setHours(dateFrom.getHours() - 24);
        const dateFromStr = dateFrom.toISOString().split('T')[0];
        
        let allApprovedOrders = [];
        const seenOrderIds = new Set();
        
        // Стратегия 1: Пробуем с фильтром по дате и сортировкой
        try {
            const response = await axios.get(`${account.url}/api/v5/orders`, {
                params: {
                    apiKey: account.apiKey,
                    'filter[statusUpdatedAt][from]': dateFromStr,
                    limit: 50,
                    page: 1,
                    sort: 'statusUpdatedAt',
                    order: 'desc'
                },
                timeout: 25000,
                headers: {
                    'Connection': 'keep-alive',
                    'Accept': 'application/json',
                    'User-Agent': 'RetailCRM-Integration/1.0'
                },
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
                validateStatus: (status) => status < 500
            });
            
            // Валидация ответа
            if (response.data && response.data.success && Array.isArray(response.data.orders)) {
                const orders = response.data.orders;
                
                // Фильтруем по статусу и времени
                orders.forEach(order => {
                    try {
                        // Валидация заказа
                        if (!order || !order.id) return;
                        if (!approvedStatuses.includes(order.status)) return;
                        
                        const updateTime = order.statusUpdatedAt || order.updatedAt;
                        if (updateTime) {
                            const updateDate = new Date(updateTime);
                            if (isNaN(updateDate.getTime()) || updateDate <= sixHoursAgo) return;
                        }
                        
                        // Проверяем дубликаты
                        if (seenOrderIds.has(order.id)) return;
                        seenOrderIds.add(order.id);
                        
                        allApprovedOrders.push({
                            ...order,
                            accountName: account.name,
                            accountUrl: account.url,
                            accountApiKey: account.apiKey,
                            accountCurrency: account.currency,
                            telegramChannel: account.telegramChannel
                        });
                    } catch (orderError) {
                        // Игнорируем ошибки обработки отдельных заказов
                        console.warn(`⚠️ Error processing order:`, orderError.message);
                    }
                });
                
                if (allApprovedOrders.length > 0) {
                    console.log(`✅ ${account.name}: Found ${allApprovedOrders.length} recently updated orders (optimized mode)`);
                    return allApprovedOrders;
                }
            }
        } catch (filterError) {
            // Если фильтр не поддерживается или ошибка - используем fallback
            const errorMsg = filterError.message || '';
            const is400Error = filterError.response && filterError.response.status === 400;
            const isStreamError = errorMsg.includes('stream has been aborted') ||
                                 errorMsg.includes('ECONNRESET') ||
                                 errorMsg.includes('ETIMEDOUT') ||
                                 errorMsg.includes('ENOTFOUND');
            
            if (is400Error) {
                console.log(`⚠️ ${account.name} - Date filter not supported, using fallback...`);
            } else if (isStreamError && retryCount < MAX_RETRIES) {
                // Retry для stream ошибок
                const delay = Math.pow(2, retryCount) * 1000;
                await new Promise(resolve => setTimeout(resolve, delay));
                return getApprovedOrders(account, retryCount + 1);
            } else if (isStreamError) {
                console.log(`⚠️ ${account.name} - Stream error after retries, using fallback...`);
            }
        }
        
        // Стратегия 2: Fallback - без фильтра, но с меньшим лимитом и сортировкой
        if (allApprovedOrders.length === 0) {
            try {
                const response = await axios.get(`${account.url}/api/v5/orders`, {
                    params: {
                        apiKey: account.apiKey,
                        limit: 30,
                        page: 1,
                        sort: 'updatedAt',
                        order: 'desc'
                    },
                    timeout: 25000,
                    headers: {
                        'Connection': 'keep-alive',
                        'Accept': 'application/json',
                        'User-Agent': 'RetailCRM-Integration/1.0'
                    },
                    maxContentLength: Infinity,
                    maxBodyLength: Infinity,
                    validateStatus: (status) => status < 500
                });
                
                if (response.data && response.data.success && Array.isArray(response.data.orders)) {
                    const orders = response.data.orders;
                    
                    orders.forEach(order => {
                        try {
                            if (!order || !order.id) return;
                            if (!approvedStatuses.includes(order.status)) return;
                            
                            const updateTime = order.statusUpdatedAt || order.updatedAt;
                            if (updateTime) {
                                const updateDate = new Date(updateTime);
                                if (isNaN(updateDate.getTime()) || updateDate <= sixHoursAgo) return;
                            }
                            
                            if (seenOrderIds.has(order.id)) return;
                            seenOrderIds.add(order.id);
                            
                            allApprovedOrders.push({
                                ...order,
                                accountName: account.name,
                                accountUrl: account.url,
                                accountApiKey: account.apiKey,
                                accountCurrency: account.currency,
                                telegramChannel: account.telegramChannel
                            });
                        } catch (orderError) {
                            // Игнорируем ошибки обработки отдельных заказов
                        }
                    });
                    
                    if (allApprovedOrders.length > 0) {
                        console.log(`✅ ${account.name}: Found ${allApprovedOrders.length} orders (fallback mode)`);
                    }
                }
            } catch (fallbackError) {
                console.error(`❌ ${account.name} - Failed to fetch orders:`, fallbackError.message);
            }
        }
        
        console.log(`📊 ${account.name}: Found ${allApprovedOrders.length} unique recently updated orders`);
        return allApprovedOrders;
        
    } catch (error) {
        console.error(`❌ Error fetching orders from ${account.name}:`, error.message);
        return [];
    }
}

// ============================================================================
// ОСНОВНАЯ ЛОГИКА ОБРАБОТКИ ЗАКАЗОВ
// ============================================================================

// Флаг для предотвращения параллельных проверок
let isChecking = false;
let lastCheckTime = null;
let consecutiveErrors = 0;
const MAX_CONSECUTIVE_ERRORS = 5;

// Улучшенная функция для проверки и отправки approved заказов
async function checkAndSendApprovedOrders() {
    // Защита от параллельных проверок
    if (isChecking) {
        console.log('⏸️ Check already in progress, skipping...');
        return;
    }
    
    isChecking = true;
    lastCheckTime = new Date();
    
    try {
        console.log(`🔍 Checking approved and sent to delivery orders...`);
        
        // Проверка инициализации БД
        if (!db || !dbInitialized) {
            console.error('❌ Database not initialized, attempting to reinitialize...');
            try {
                await initializeDatabase();
            } catch (dbError) {
                console.error('❌ Failed to reinitialize database:', dbError.message);
                consecutiveErrors++;
                return;
            }
        }
        
        let totalSent = 0;
        let totalSkipped = 0;
        let totalErrors = 0;
        
        // Проверяем каждый аккаунт
        for (const account of retailCRMAccounts) {
            try {
                // Получаем approved заказы
                const approvedOrders = await getApprovedOrders(account);
                
                if (!Array.isArray(approvedOrders) || approvedOrders.length === 0) {
                    continue;
                }
                
                console.log(`📋 Processing ${approvedOrders.length} approved orders from ${account.name}...`);
                
                // Обрабатываем каждый заказ
                for (const order of approvedOrders) {
                    try {
                        // Валидация заказа
                        if (!order || !order.id) {
                            console.warn(`⚠️ Invalid order object, skipping...`);
                    continue;
                }
                
                        const orderId = String(order.id);
                        const orderNumber = order.number || orderId;
                
                // Атомарная проверка и сохранение
                        const result = await checkAndSaveOrder(orderId, orderNumber, account.name);
                
                if (result.error) {
                            console.error(`❌ Database error for order ${orderNumber}:`, result.error);
                            totalErrors++;
                    continue;
                }
                
                        if (result.isDuplicate) {
                            totalSkipped++;
                    continue;
                }
                
                        if (!result.saved) {
                            console.error(`❌ Failed to save order ${orderNumber} to database`);
                            totalErrors++;
                            continue;
                        }
                        
                        // Форматируем и отправляем сообщение
                        const message = await formatOrderMessage(order);
                        if (!message) {
                            console.error(`❌ Failed to format message for order ${orderNumber}`);
                            totalErrors++;
                            // Удаляем из БД для повторной попытки
                            db.run('DELETE FROM sent_notifications WHERE order_id = ?', [orderId], () => {});
                            continue;
                        }
                        
                        const channelId = order.telegramChannel || account.telegramChannel;
                        const sent = await sendTelegramMessage(message, channelId);
                        
                        if (sent) {
                            totalSent++;
                            console.log(`✅ Sent order ${orderNumber} from ${account.name}`);
                            
                            // Задержка между отправками
                            await new Promise(resolve => setTimeout(resolve, 1500));
                } else {
                            // Если не удалось отправить, удаляем из БД для повторной попытки
                        db.run('DELETE FROM sent_notifications WHERE order_id = ?', [orderId], (err) => {
                            if (err) {
                                    console.error(`❌ Failed to delete order ${orderNumber} from database:`, err.message);
                                }
                            });
                            console.error(`❌ Failed to send order ${orderNumber}`);
                            totalErrors++;
                            
                            // Задержка даже при ошибке
                            await new Promise(resolve => setTimeout(resolve, 1000));
                        }
                    } catch (orderError) {
                        console.error(`❌ Error processing order:`, orderError.message);
                        totalErrors++;
                        // Продолжаем обработку следующих заказов
                    }
                }
                
                // Задержка между аккаунтами
                if (retailCRMAccounts.indexOf(account) < retailCRMAccounts.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
                
            } catch (accountError) {
                console.error(`❌ Error processing ${account.name}:`, accountError.message);
                totalErrors++;
                // Продолжаем обработку следующих аккаунтов
            }
        }
        
        // Сброс счетчика ошибок при успешной проверке
        if (totalErrors === 0) {
            consecutiveErrors = 0;
        } else {
            consecutiveErrors++;
        }
        
        // Предупреждение при большом количестве последовательных ошибок
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            console.error(`⚠️ WARNING: ${consecutiveErrors} consecutive checks with errors!`);
        }
        
        console.log(`🎉 Sent ${totalSent} new orders, skipped ${totalSkipped} duplicates, ${totalErrors} errors`);
        
    } catch (error) {
        console.error('❌ Error checking approved orders:', error.message);
        consecutiveErrors++;
    } finally {
        isChecking = false;
    }
}

// ============================================================================
// API ENDPOINTS
// ============================================================================

// Health check endpoint с детальной информацией
app.get('/health', (req, res) => {
    const health = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        accounts: retailCRMAccounts.length,
        database: dbInitialized ? 'connected' : 'disconnected',
        lastCheck: lastCheckTime ? lastCheckTime.toISOString() : null,
        consecutiveErrors: consecutiveErrors,
        cacheSize: operatorCache.size
    };
    
    // Если слишком много ошибок - возвращаем warning
    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        health.status = 'degraded';
        res.status(503);
    }
    
    res.json(health);
});

// Тестовый endpoint
app.get('/test', (req, res) => {
        res.json({ 
        message: 'Server is working!',
            timestamp: new Date().toISOString(),
        version: '2.0.0'
        });
});

// Endpoint для ручной проверки
app.get('/check-orders', async (req, res) => {
    if (isChecking) {
        return res.status(429).json({
            message: 'Check already in progress',
        timestamp: new Date().toISOString()
    });
    }
    
    await checkAndSendApprovedOrders();
            res.json({
        message: 'Check completed',
        timestamp: new Date().toISOString()
    });
});

// Endpoint для очистки базы данных
app.get('/clear-database', (req, res) => {
    if (!db || !dbInitialized) {
        return res.status(503).json({
            error: 'Database not initialized',
            timestamp: new Date().toISOString()
        });
    }
    
    db.run('DELETE FROM sent_notifications', (err) => {
        if (err) {
            console.error('❌ Error clearing database:', err.message);
            return res.status(500).json({
                error: 'Failed to clear database',
                message: err.message,
                timestamp: new Date().toISOString()
            });
        }
        
        db.get('SELECT COUNT(*) as count FROM sent_notifications', (err, row) => {
            if (err) {
                return res.status(500).json({
                    error: 'Failed to count records',
                    message: err.message,
                    timestamp: new Date().toISOString()
                });
            }
            
            console.log('🗑️ Database cleared successfully');
    res.json({
                message: 'Database cleared successfully',
                remaining_records: row?.count || 0,
                timestamp: new Date().toISOString()
    });
});
    });
});

// Endpoint для получения статистики
app.get('/stats', (req, res) => {
    if (!db || !dbInitialized) {
        return res.status(503).json({
            error: 'Database not initialized',
            timestamp: new Date().toISOString()
        });
    }
    
    db.get('SELECT COUNT(*) as total FROM sent_notifications', (err, row) => {
            if (err) {
            return res.status(500).json({
                error: 'Failed to get stats',
                message: err.message,
                timestamp: new Date().toISOString()
            });
            }
            
            res.json({
            total_orders_sent: row?.total || 0,
            accounts_configured: retailCRMAccounts.length,
            cache_size: operatorCache.size,
            last_check: lastCheckTime ? lastCheckTime.toISOString() : null,
            consecutive_errors: consecutiveErrors,
                timestamp: new Date().toISOString()
            });
    });
});

// ============================================================================
// GRACEFUL SHUTDOWN
// ============================================================================

function gracefulShutdown(signal) {
    console.log(`\n${signal} received. Starting graceful shutdown...`);
    
    isChecking = false; // Останавливаем новые проверки
    
    // Закрываем базу данных
    if (db) {
        db.close((err) => {
        if (err) {
                console.error('❌ Error closing database:', err.message);
            } else {
                console.log('✅ Database closed successfully');
            }
            process.exit(0);
            });
        } else {
        process.exit(0);
    }
}

// Обработка сигналов завершения
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Обработка необработанных ошибок
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    // Не завершаем процесс, только логируем
});

// ============================================================================
// ЗАПУСК СЕРВЕРА
// ============================================================================

// Инициализация и запуск
async function startServer() {
    try {
        // Инициализируем базу данных
        await initializeDatabase();
        
        // Запускаем сервер
        app.listen(PORT, () => {
    console.log(`🚀 Server started on port ${PORT}`);
            console.log(`⏰ Checking approved orders every 5 minutes`);
            console.log(`📊 Optimized RetailCRM API integration: date filter + sorting + caching`);
            console.log(`🔒 Full error handling and validation enabled`);
            
            // Первая проверка через 1 минуту
            setTimeout(checkAndSendApprovedOrders, 60000);
        });
        
        // Запускаем периодическую проверку каждые 5 минут
        setInterval(checkAndSendApprovedOrders, 300000);
        
    } catch (error) {
        console.error('❌ Failed to start server:', error.message);
        process.exit(1);
    }
}

startServer();

module.exports = app;


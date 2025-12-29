const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Сохраняем сырые данные для обработки невалидного JSON
let rawBodyBuffer = null;

// Middleware для парсинга JSON и URL-encoded данных с обработкой ошибок
app.use(express.json({
    strict: false, // Разрешаем не строгий JSON
    verify: (req, res, buf) => {
        // Сохраняем сырые данные
        rawBodyBuffer = buf;
        
        // Логируем сырые данные для отладки
        try {
            JSON.parse(buf.toString());
        } catch (e) {
            console.log('⚠️ Ошибка парсинга JSON:', e.message);
            console.log('📦 Сырые данные:', buf.toString().substring(0, 500));
        }
    }
}));
app.use(express.urlencoded({ extended: true }));

// Middleware для сохранения сырых данных в req
app.use((req, res, next) => {
    if (rawBodyBuffer) {
        req.rawBody = rawBodyBuffer.toString();
        rawBodyBuffer = null;
    }
    next();
});

// Middleware для обработки ошибок парсинга JSON
app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        console.log('⚠️ Ошибка парсинга JSON тела запроса');
        console.log('   Ошибка:', err.message);
        console.log('   Попытка обработать как текст...');
        
        // Пытаемся получить данные из сырого тела
        if (req.body && typeof req.body === 'object') {
            // Если уже есть какие-то данные, продолжаем
            return next();
        }
        
        // Если тело пустое, создаем пустой объект
        req.body = {};
        return next();
    }
    next(err);
});

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

// Функция для получения списка сайтов через API
async function getSitesFromAPI(accountUrl, apiKey) {
    // Пробуем разные способы получить site код
    const methods = [
        // Метод 1: /api/v5/reference/sites
        async () => {
            try {
                const response = await axios.get(`${accountUrl}/api/v5/reference/sites`, {
                    params: { apiKey },
                    timeout: 5000
                });
                if (response.data.success && response.data.sites && response.data.sites.length > 0) {
                    const firstSite = response.data.sites[0];
                    return firstSite.code || firstSite.name || null;
                }
            } catch (error) {
                if (error.response?.status !== 403) {
                    console.log(`   ⚠️ Method 1 failed: ${error.message}`);
                }
            }
            return null;
        },
        // Метод 2: /api/v5/store/sites
        async () => {
            try {
                const response = await axios.get(`${accountUrl}/api/v5/store/sites`, {
                    params: { apiKey },
                    timeout: 5000
                });
                if (response.data.success && response.data.sites && response.data.sites.length > 0) {
                    const firstSite = response.data.sites[0];
                    return firstSite.code || firstSite.name || null;
                }
            } catch (error) {
                // Игнорируем ошибки
            }
            return null;
        },
        // Метод 3: Попробовать получить из заказов (если есть хотя бы один заказ)
        async () => {
            try {
                const response = await axios.get(`${accountUrl}/api/v5/orders`, {
                    params: { apiKey, limit: 20 },
                    timeout: 5000
                });
                if (response.data.success && response.data.orders && response.data.orders.length > 0) {
                    const order = response.data.orders.find(o => o.number === orderNumber);
                    if (!order) return null;
                    if (order.site) {
                        return order.site;
                    }
                }
            } catch (error) {
                // Игнорируем ошибки
            }
            return null;
        }
    ];
    
    console.log('   📋 Getting sites list from API...');
    
    for (let i = 0; i < methods.length; i++) {
        const siteCode = await methods[i]();
        if (siteCode) {
            console.log(`   ✅ Found site code (method ${i + 1}): ${siteCode}`);
            return siteCode;
        }
    }
    
    // Если ничего не помогло, пробуем дефолтные значения
    console.log('   ⚠️ Could not get sites list from API, trying default values...');
    const defaultSites = ['default', 'main', 'store', 'shop'];
    console.log(`   💡 Will try default site codes: ${defaultSites.join(', ')}`);
    
    return null; // Вернем null, но в getOrderFromAPI попробуем дефолтные значения
}

// Функция для получения данных заказа через API по номеру
// Поиск по номеру заказа - 1 попытка
async function getOrderByNumber(accountUrl, apiKey, orderNumber, site = null) {
    try {
        console.log(`   🔍 Searching order by number: ${orderNumber}`);
        const params = { apiKey, number: orderNumber, limit: 20 }; // API требует 20, 50 или 100
        if (site) {
            params.site = site;
        }
        
        const response = await axios.get(`${accountUrl}/api/v5/orders`, {
            params: params,
            timeout: 10000
        });
        
        if (response.data.success && response.data.orders && response.data.orders.length > 0) {
            // Ищем заказ с ТОЧНЫМ номером - только точное совпадение!
            const order = response.data.orders.find(o => o.number === orderNumber);
            if (order) {
                console.log(`   ✅ Order found by number: ${order.id} (exact match: ${order.number})`);
                return order;
        } else {
                // Точного совпадения нет
                console.log(`   ⚠️ Order with exact number "${orderNumber}" not found in results`);
            return null;
            }
        }
        
        return null;
    } catch (error) {
        console.log(`   ⚠️ Search by number failed: ${error.message}`);
        return null;
    }
}

// Функция для поиска заказа через пагинацию (30 страниц по 100 заказов = 3000 заказов)
async function getOrderByPagination(accountUrl, apiKey, orderNumber, site = null) {
    const maxPages = 30; // Проверяем 30 страниц (увеличено для поиска старых заказов)
    const limit = 100; // По 100 заказов на странице
    const startTime = Date.now(); // Для отслеживания времени выполнения
    
    console.log(`   📄 Step 3: Starting pagination search: checking ${maxPages} pages (${maxPages * limit} orders total)`);
    
    for (let page = 1; page <= maxPages; page++) {
        try {
            console.log(`   📄 Checking page ${page}/${maxPages}...`);
            const params = { apiKey, limit: limit, page: page };
            if (site) {
                params.site = site;
            }
            
            const response = await axios.get(`${accountUrl}/api/v5/orders`, {
                params: params,
                timeout: 10000
            });
            
            if (response.data.success && response.data.orders && response.data.orders.length > 0) {
                // Ищем заказ с точным номером
                const order = response.data.orders.find(o => o.number === orderNumber);
                if (order) {
                    const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);
                    console.log(`   ✅ Step 3 success: Order found on page ${page}: ${order.id} (exact match: ${order.number})`);
                    console.log(`   ⏱️ Pagination completed in ${elapsedTime} seconds (checked ${page} pages, ${page * limit} orders)`);
                    return order; // РАННИЙ ВЫХОД - сразу возвращаем заказ, останавливаем пагинацию
                }
                console.log(`   ⚠️ Order not found on page ${page}, checked ${response.data.orders.length} orders`);
            } else {
                // Если страница пустая, дальше не имеет смысла искать
                console.log(`   ⚠️ No orders on page ${page}, stopping pagination`);
                break;
            }
        } catch (error) {
            console.log(`   ⚠️ Error checking page ${page}: ${error.message}`);
            // Продолжаем проверять следующие страницы (не критичная ошибка)
            // Если это таймаут или критическая ошибка, можно прервать, но лучше продолжить
            if (error.code === 'ECONNABORTED' || error.response?.status >= 500) {
                console.log(`   ⚠️ Critical error on page ${page}, but continuing...`);
            }
        }
    }
    
    const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`   ❌ Step 3 failed: Order not found in ${maxPages} pages (${maxPages * limit} orders checked)`);
    console.log(`   ⏱️ Total pagination time: ${elapsedTime} seconds`);
    return null;
}

// Функция для получения данных заказа через API
// ЛОГИКА: 1) Поиск по номеру (1 раз), 2) Поиск по ID (1 раз), 3) Пагинация (30 страниц по 100 = 3000 заказов)
async function getOrderFromAPI(accountUrl, apiKey, orderId, orderNumber = null, site = null) {
    // ШАГ 1: Поиск по номеру заказа - 1 попытка
    if (orderNumber) {
        console.log(`📡 Step 1: API Request (by number): ${accountUrl}/api/v5/orders?number=${orderNumber}`);
        const order = await getOrderByNumber(accountUrl, apiKey, orderNumber, site);
        if (order && order.number === orderNumber) {
            // Нашли заказ с точным номером - возвращаем его
            return order;
        }
        console.log(`   ⚠️ Step 1 failed: Order not found by number`);
    }
    
    // ШАГ 2: Поиск по ID - 1 попытка
    if (orderId) {
        try {
            console.log(`📡 Step 2: API Request (by ID): ${accountUrl}/api/v5/orders/${orderId}`);
            
            const params = { apiKey };
            if (site) {
                params.site = site;
            }
            
            const response = await axios.get(`${accountUrl}/api/v5/orders/${orderId}`, {
                params: params,
                timeout: 10000
            });

            if (response.data.success && response.data.order) {
                const order = response.data.order;
                console.log('✅ Step 2 success: API Response received');
                console.log('   Order ID:', order.id);
                console.log('   Order Number:', order.number);
                
                // Детальное логирование структуры заказа
                console.log('   📊 Order structure details:');
                console.log('      - customer:', order.customer ? 'EXISTS' : 'MISSING');
                if (order.customer) {
                    console.log('         customer keys:', Object.keys(order.customer).join(', '));
                }
                console.log('      - items:', order.items ? `${order.items.length} items` : 'MISSING');
                if (order.items && order.items.length > 0) {
                    console.log('         first item keys:', Object.keys(order.items[0]).join(', '));
                }
                console.log('      - delivery:', order.delivery ? 'EXISTS' : 'MISSING');
                if (order.delivery) {
                    console.log('         delivery keys:', Object.keys(order.delivery).join(', '));
                }
                console.log('      - manager:', order.manager ? (typeof order.manager === 'string' ? order.manager : 'OBJECT') : 'MISSING');
                console.log('      - phone:', order.phone || 'MISSING');
                console.log('      - firstName:', order.firstName || 'MISSING');
                console.log('      - lastName:', order.lastName || 'MISSING');
                
                return order;
            } else {
                console.log(`   ⚠️ Step 2 failed: ${response.data.errorMsg || 'Order not found'}`);
            }
        } catch (error) {
            console.log(`   ⚠️ Step 2 failed: ${error.message}`);
        }
    }
    
    // ШАГ 3: Пагинация - проверяем 10 страниц по 100 заказов (только если есть номер заказа)
    if (orderNumber) {
        const order = await getOrderByPagination(accountUrl, apiKey, orderNumber, site);
        if (order) {
            return order;
        }
    }
    
    // Если ничего не помогло
    console.log('❌ All search methods failed');
    return null;
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

// Функция для получения данных менеджера по ID через API
async function getManagerById(accountUrl, apiKey, managerId) {
    if (!managerId) return null;
    
    try {
        const response = await axios.get(`${accountUrl}/api/v5/users/${managerId}`, {
            params: { apiKey },
            timeout: 5000
        });
        
        if (response.data.success && response.data.user) {
            const user = response.data.user;
            // Возвращаем имя менеджера (может быть firstName + lastName или просто firstName)
            return user.firstName && user.lastName 
                ? `${user.firstName} ${user.lastName}`.trim()
                : user.firstName || user.lastName || user.email || `ID: ${managerId}`;
        }
    } catch (error) {
        console.log(`   ⚠️ Could not get manager data by ID ${managerId}: ${error.message}`);
    }
    return null;
}

// Функция для форматирования сообщения о заказе (на английском)
async function formatOrderMessage(order, currency = 'GHS', accountUrl = null, apiKey = null) {
    // Логируем структуру заказа для отладки
    console.log('📝 Formatting order message...');
    console.log('   Order keys:', Object.keys(order).join(', '));
    
    // Items - проверяем разные варианты
    const items = order.items || order.offer || [];
    const itemsText = items.length > 0 
        ? items.map(item => {
            const name = item.productName || item.name || item.offerName || item.offer?.name || 'Product';
            const quantity = item.quantity || item.count || 1;
            return `• ${name} - ${quantity} pcs.`;
          }).join('\n')
        : 'No items specified';

    // Customer - проверяем разные варианты
    const customer = order.customer || {};
    const firstName = order.firstName || 
                     customer.firstName || 
                     customer.name?.split(' ')[0] ||
                     order.contact?.firstName ||
                     'Not specified';
    const lastName = order.lastName || 
                    customer.lastName || 
                    customer.name?.split(' ').slice(1).join(' ') ||
                    order.contact?.lastName ||
                    '';
    const fullName = `${firstName} ${lastName}`.trim() || customer.name || 'Not specified';

    // Manager - проверяем разные варианты
    let manager = order.manager || 
                   order.managerName || 
                   (order.manager && typeof order.manager === 'object' ? order.manager.name : null);
    
    // Если менеджер не найден, но есть managerId, пробуем получить через API
    if (!manager && order.managerId && accountUrl && apiKey) {
        console.log(`   🔍 Manager not found, trying to get by managerId: ${order.managerId}`);
        manager = await getManagerById(accountUrl, apiKey, order.managerId);
    }
    
    // Если все еще нет менеджера, но есть managerId, показываем ID
    if (!manager && order.managerId) {
        manager = `ID: ${order.managerId}`;
    }
    
    // Если менеджер все еще не найден
    if (!manager) {
        manager = 'Not specified';
    }

    // Phone - проверяем разные варианты
    const phone = order.phone || 
                 customer.phone || 
                 order.contact?.phone ||
                 customer.phones?.[0] ||
                 'Not specified';
    
    const additionalPhone = order.additionalPhone || 
                           customer.additionalPhone ||
                           customer.additionalPhones?.[0] ||
                           customer.phones?.[1] ||
                           order.contact?.additionalPhone ||
                           'Not specified';

    // Delivery - проверяем разные варианты
    const delivery = order.delivery || {};
    const deliveryDate = order.deliveryDate || 
                        delivery.date || 
                        order.deliveryDate ||
                        'Not specified';
    
    const deliveryAddress = order.deliveryAddress || 
                           delivery.address?.text ||
                           delivery.address?.addressText ||
                           delivery.address?.street ||
                           (delivery.address ? 
                               `${delivery.address.street || ''} ${delivery.address.house || ''} ${delivery.address.flat || ''}`.trim() : 
                               null) ||
                           'Not specified';
    
    const city = order.city || 
                delivery.address?.city ||
                delivery.city ||
                customer.city ||
                'Not specified';

    // Total - проверяем разные варианты
    const total = order.totalSumm || 
                 order.totalSum || 
                 order.sum ||
                 order.total ||
                 0;

    return `🛒 <b>NEW ORDER APPROVED!</b>

📋 <b>Order Number:</b> ${order.number || order.id || 'Not specified'}
👤 <b>Manager:</b> ${manager}
📅 <b>Delivery Date:</b> ${deliveryDate}
👨‍💼 <b>Customer Name:</b> ${fullName}
📱 <b>Phone:</b> ${phone}
📱 <b>Additional Phone:</b> ${additionalPhone}
📍 <b>Delivery Address:</b> ${deliveryAddress}
🏙️ <b>City:</b> ${city}

🛍️ <b>Items:</b>
${itemsText}

💰 <b>Order Total:</b> ${total} ${currency}

⏰ <b>Approved At:</b> ${new Date().toLocaleString('en-US', { timeZone: 'UTC' })}`;
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

// Кэш для отслеживания уже обработанных заказов (защита от дубликатов)
// Храним: ключ = accountUrl + orderNumber, значение = timestamp
const processedOrders = new Map();
const PROCESSED_ORDERS_TTL = 5 * 60 * 1000; // 5 минут - если заказ пришел повторно в течение 5 минут, игнорируем

// Функция для проверки, был ли заказ уже обработан
function isOrderAlreadyProcessed(accountUrl, orderNumber) {
    const key = `${accountUrl}:${orderNumber}`;
    const processedTime = processedOrders.get(key);
    
    if (processedTime) {
        const age = Date.now() - processedTime;
        if (age < PROCESSED_ORDERS_TTL) {
            console.log(`   ⚠️ Order ${orderNumber} was already processed ${Math.round(age/1000)}s ago, skipping duplicate`);
            return true;
        } else {
            // Удаляем старые записи
            processedOrders.delete(key);
        }
    }
    
    return false;
}

// Функция для отметки заказа как обработанного
function markOrderAsProcessed(accountUrl, orderNumber) {
    const key = `${accountUrl}:${orderNumber}`;
    processedOrders.set(key, Date.now());
    
    // Очистка старых записей (раз в 100 записей)
    if (processedOrders.size > 100) {
        const now = Date.now();
        for (const [k, v] of processedOrders.entries()) {
            if (now - v > PROCESSED_ORDERS_TTL) {
                processedOrders.delete(k);
            }
        }
    }
}

// Webhook endpoint для RetailCRM триггера
app.post('/webhook/retailcrm', async (req, res) => {
    try {
        console.log('\n🔔 WEBHOOK RECEIVED FROM RETAILCRM');
        console.log('='.repeat(70));
        
        // Логируем все данные для отладки
        console.log('📦 Full request data:');
        try {
            console.log(JSON.stringify({
                headers: req.headers,
                body: req.body,
                query: req.query,
                params: req.params
            }, null, 2));
        } catch (e) {
            console.log('⚠️ Ошибка сериализации данных:', e.message);
            console.log('   Headers:', req.headers);
            console.log('   Body type:', typeof req.body);
            console.log('   Body:', req.body);
            console.log('   Query:', req.query);
        }
        
        // Пытаемся извлечь данные заказа из разных форматов
        let order = null;
        let accountUrl = null;
        
        // Функция для очистки значений от обратных кавычек и лишних символов
        function cleanValue(value) {
            if (typeof value === 'string') {
                return value.replace(/^`+|`+$/g, '').replace(/^["']|["']$/g, '').trim();
            }
            return value;
        }
        
        // Функция для очистки ключей от обратных кавычек
        function cleanKey(key) {
            return key.replace(/^`+|`+$/g, '').trim();
        }
        
        // Вариант 0: Данные в req.body.order (ПРИОРИТЕТ - полные данные из триггера)
        if (req.body && req.body.order && typeof req.body.order === 'object' && !Array.isArray(req.body.order)) {
            order = req.body.order;
            console.log('✅ Order found in req.body.order (full data from trigger)');
            console.log('   Order ID:', order.id);
            console.log('   Order Number:', order.number);
            console.log('   Order Status:', order.status);
            console.log('   Has customer:', !!order.customer);
            console.log('   Has items:', !!(order.items && order.items.length > 0));
            
            // Если объект заказа пустой ({{ order|json_encode }} вернул {}), нужно получить данные через API
            if (!order.id && !order.number && Object.keys(order).length === 0) {
                console.log('   ⚠️ Order object is empty - {{ order|json_encode }} did not work');
                console.log('   💡 This means the trigger syntax is incorrect or not supported');
                console.log('   🔄 Will try to get data via API using query parameters or fallback methods');
                order = null; // Сбрасываем, чтобы попробовать другие методы
            } else if (!order.id && !order.number) {
                // Если есть какие-то данные, но нет ID/номера, тоже пробуем API
                console.log('   ⚠️ Order object exists but missing ID/number');
                console.log('   🔄 Will try to get full data via API');
                const partialOrder = order; // Сохраняем частичные данные
                order = null; // Сбрасываем для поиска через другие методы
            } else {
                // Определяем account URL из body или query
                accountUrl = req.body.accountUrl || 
                            req.body.account_url ||
                            req.query.account_url ||
                            req.query.accountUrl ||
                            req.headers['x-retailcrm-url'] ||
                            null;
            }
        }
        
        // Вариант 0.5: Данные в req.body (urlencoded - отдельные поля)
        if (!order && req.body && Object.keys(req.body).length > 0) {
            // Проверяем, есть ли поля заказа в body (urlencoded формат)
            const orderId = req.body.order_id || req.body.orderId;
            const orderNumber = req.body.order_number || req.body.orderNumber;
            const orderStatus = req.body.order_status || req.body.orderStatus || req.body.status;
            
            if (orderId || orderNumber) {
                console.log('✅ Order fields found in req.body (urlencoded format)');
                console.log('   Order ID:', orderId);
                console.log('   Order Number:', orderNumber);
                console.log('   Order Status:', orderStatus);
                
                // Создаем объект заказа из полей body
                order = {
                    id: orderId ? parseInt(orderId) : null,
                    number: orderNumber,
                    status: orderStatus,
                    statusCode: orderStatus,
                    // Пытаемся собрать данные из отдельных полей
                    customer: {
                        firstName: req.body.customer_firstName || req.body.customer_first_name,
                        lastName: req.body.customer_lastName || req.body.customer_last_name,
                        phone: req.body.customer_phone || req.body.customer_phone_number
                    },
                    delivery: {
                        address: {
                            text: req.body.delivery_address || req.body.delivery_address_text,
                            city: req.body.delivery_city || req.body.delivery_city_name
                        }
                    },
                    manager: req.body.manager || req.body.manager_name,
                    totalSumm: req.body.totalSumm || req.body.total_summ || req.body.total
                };
                
                // Определяем account URL
                accountUrl = req.body.account_url || 
                            req.body.accountUrl ||
                            req.query.account_url ||
                            req.query.accountUrl ||
                            req.headers['x-retailcrm-url'] ||
                            null;
                
                // Если нет полных данных (customer, items), попробуем получить через API
                if (orderId && (!order.customer.phone || !order.items)) {
                    console.log('   ⚠️ Incomplete data in body, fetching full data via API...');
                    const apiKey = getApiKeyForAccount(accountUrl);
                    if (apiKey && accountUrl) {
                        const fullOrderData = await getOrderFromAPI(accountUrl, apiKey, orderId, orderNumber);
                        if (fullOrderData) {
                            // Объединяем данные из body с данными из API
                            order = { ...order, ...fullOrderData };
                            console.log('   ✅ Full order data merged from API');
                        }
                    }
                }
            }
        }
        
        // Вариант 1: Данные в req.query (query параметры) - только если нет данных в body
        if (!order && Object.keys(req.query).length > 0) {
            console.log('🔍 Проверяю query параметры...');
            const cleanedQuery = {};
            for (const [key, value] of Object.entries(req.query)) {
                const cleanKeyName = cleanKey(key);
                cleanedQuery[cleanKeyName] = cleanValue(value);
            }
            console.log('   Очищенные query параметры:', cleanedQuery);
            
            // Ищем ID заказа в query
            const orderId = cleanedQuery.order_id || cleanedQuery.orderId || cleanedQuery.id;
            const orderNumber = cleanedQuery.order_number || cleanedQuery.orderNumber || cleanedQuery.number;
            const status = cleanedQuery.status || cleanedQuery.statusCode;
            
            if (orderId || orderNumber) {
                console.log('✅ Order found in req.query');
                console.log('   Order ID:', orderId);
                console.log('   Order Number:', orderNumber);
                console.log('   Status:', status);
                
                // Создаем объект заказа из query параметров
                order = {
                    id: orderId ? parseInt(orderId) : null,
                    number: orderNumber,
                    status: status,
                    statusCode: status
                };
                
                // Если есть только ID или статус не approved, попробуем получить полные данные через API
                if (orderId) {
                    // Всегда получаем полные данные через API для query параметров, чтобы иметь полную информацию
                    console.log('📡 Fetching full order data via API...');
                    
                    // Пытаемся определить аккаунт из параметров триггера
                    // ВАЖНО: Сохраняем accountUrl в переменную, чтобы не потерять его
                    const determinedAccountUrl = cleanedQuery.account_url || 
                                                cleanedQuery.accountUrl ||
                                                req.headers['x-retailcrm-url'] || 
                                                req.headers['referer']?.match(/https?:\/\/([^\/]+\.retailcrm\.ru)/)?.[0] ||
                                                null;
                    
                    // Если аккаунт не определен, используем дефолтный или пробуем определить по номеру заказа
                    if (!determinedAccountUrl) {
                        console.log('⚠️ Account URL not found in request');
                        console.log('💡 РЕКОМЕНДАЦИЯ: Добавьте параметр account_url в триггер RetailCRM');
                        console.log('   В настройках триггера добавьте параметр:');
                        console.log('   - Parameter name: account_url');
                        console.log('   - Parameter value: https://slimteapro-store.retailcrm.ru (для Account 3) или https://aff-gh.retailcrm.ru (для Account 1)');
                        
                        // Пробуем определить по номеру заказа (если есть префикс или паттерн)
                        // Для Account 1 обычно номера без префикса или с префиксом A
                        // Для Account 3 может быть другой паттерн
                        // Пока используем дефолтный Account 1
                        accountUrl = process.env.RETAILCRM_URL_1 || 'https://aff-gh.retailcrm.ru';
                        console.log(`   Using default account: ${accountUrl}`);
                    } else {
                        accountUrl = determinedAccountUrl;
                        console.log(`   ✅ Account URL determined from query: ${accountUrl}`);
                    }
                    
                    // Получаем данные через API используя определенный аккаунт
                    try {
                        const apiKey = getApiKeyForAccount(accountUrl);
                        if (apiKey && accountUrl) {
                            console.log(`🔑 Using API key for: ${accountUrl}`);
                            const orderData = await getOrderFromAPI(accountUrl, apiKey, orderId, orderNumber);
                            if (orderData && (orderData.customer || orderData.items)) {
                                order = orderData;
                                console.log('✅ Full order data received via API');
                                console.log('   Order structure:', {
                                    hasCustomer: !!order.customer,
                                    hasItems: !!(order.items && order.items.length > 0),
                                    hasDelivery: !!order.delivery,
                                    hasManager: !!order.manager
                                });
                            } else if (orderData) {
                                console.log('⚠️ Order found but no customer/items data');
                            } else {
                                console.log('⚠️ Order not found or API error');
                                // Аккаунт уже определен из query параметров, не ищем на других аккаунтах
                            }
                        } else {
                            console.log('⚠️ No API key available for:', accountUrl);
                            console.log('   Available keys:', {
                                key1: !!process.env.RETAILCRM_API_KEY_1,
                                key3: !!process.env.RETAILCRM_API_KEY_3,
                                default: !!process.env.RETAILCRM_API_KEY
                            });
                        }
                    } catch (apiError) {
                        console.error('❌ Error fetching data via API:', apiError.message);
                        if (apiError.response) {
                            console.error('   Status:', apiError.response.status);
                            console.error('   Data:', apiError.response.data);
                        }
                    }
                    
                    // Если аккаунт был определен, но не из параметров
                    if (accountUrl && !cleanedQuery.account_url && !cleanedQuery.accountUrl) {
                        // Если аккаунт определен, используем его
                        try {
                            const apiKey = getApiKeyForAccount(accountUrl);
                            if (apiKey && accountUrl) {
                                console.log(`🔑 Using API key for: ${accountUrl}`);
                                const orderData = await getOrderFromAPI(accountUrl, apiKey, orderId, orderNumber);
                                if (orderData) {
                                    order = orderData;
                                    console.log('✅ Full order data received via API');
                                    console.log('   Order structure:', {
                                        hasCustomer: !!order.customer,
                                        hasItems: !!(order.items && order.items.length > 0),
                                        hasDelivery: !!order.delivery,
                                        hasManager: !!order.manager
                                    });
                                } else {
                                    console.log('⚠️ API returned no data, using partial data from query parameters');
                                }
                            } else {
                                console.log('⚠️ No API key available for:', accountUrl);
                                console.log('   Available keys:', {
                                    key1: !!process.env.RETAILCRM_API_KEY_1,
                                    key3: !!process.env.RETAILCRM_API_KEY_3,
                                    default: !!process.env.RETAILCRM_API_KEY
                                });
                            }
                        } catch (apiError) {
                            console.error('❌ Error fetching data via API:', apiError.message);
                            if (apiError.response) {
                                console.error('   Status:', apiError.response.status);
                                console.error('   Data:', apiError.response.data);
                            }
                            console.log('⚠️ Using partial data from query parameters');
                        }
                    }
                    
                    // Если все еще нет данных после всех попыток (по номеру, по ID, пагинация)
                    if (!order || (!order.customer && !order.items)) {
                        console.log('⚠️ Order not found after all search attempts (by number, by ID, pagination)');
                        console.log('   Will send error message to Telegram');
                        
                        // Определяем accountUrl если еще не определен
                        if (!accountUrl) {
                            accountUrl = determinedAccountUrl || 
                                        process.env.RETAILCRM_URL_1 || 
                                        'https://aff-gh.retailcrm.ru';
                        }
                        
                        const telegramChannel = getTelegramChannelForAccount(accountUrl);
                        if (telegramChannel) {
                            const errorMessage = `⚠️ <b>ORDER NOT FOUND</b>

📋 <b>Order Number:</b> ${orderNumber || 'Not specified'}
🆔 <b>Order ID:</b> ${orderId || 'Not specified'}

❌ <b>Error:</b> The order could not be found in the system after checking:
• Search by order number (1 attempt)
• Search by order ID (1 attempt)  
• Pagination search (30 pages × 100 orders = 3000 orders checked)

💡 <b>Possible reasons:</b>
• This is an old order that is not in the last 3000 orders
• An API error occurred and the order could not be retrieved
• The order may have been deleted or archived

🔧 <b>Action required:</b> Please retrieve this order manually from RetailCRM.`;

                            console.log('📤 Sending error message to Telegram...');
                            const sent = await sendTelegramMessage(errorMessage, telegramChannel);
                            if (sent) {
                                console.log('✅ Error message sent to Telegram');
                            } else {
                                console.log('❌ Failed to send error message to Telegram');
                            }
                        }
                        
                        // Используем частичные данные из query для ответа
                        console.log('⚠️ Using partial data from query parameters');
                    }
                }
            }
        }
        
        // Вариант 2: Данные в req.body.order
        if (!order && req.body.order) {
            order = req.body.order;
            console.log('✅ Найден заказ в req.body.order');
        }
        // Вариант 3: Данные напрямую в req.body
        else if (!order && (req.body.id || req.body.number)) {
            order = req.body;
            console.log('✅ Найден заказ в req.body');
        }
        // Вариант 4: Данные в req.body.data
        else if (!order && req.body.data && (req.body.data.id || req.body.data.number)) {
            order = req.body.data;
            console.log('✅ Найден заказ в req.body.data');
        }
        // Вариант 4: Пытаемся извлечь ID заказа из невалидного JSON или сырых данных
        if (!order) {
            // Проверяем сырые данные, если они есть
            const rawData = req.rawBody || JSON.stringify(req.body) || '';
            console.log('🔍 Анализ сырых данных для поиска ID заказа...');
            console.log('   Сырые данные:', rawData.substring(0, 200));
            
            // Ищем ID заказа в разных форматах
            const orderIdMatch = rawData.match(/order[_\s]+(\d{4,})/i) ||  // "order 191490"
                                rawData.match(/"order"[:\s]*(\d+)/i) ||      // "order": 191490
                                rawData.match(/orderId["\s:]*(\d+)/i) ||     // orderId: 191490
                                rawData.match(/id["\s:]*(\d{4,})/i) ||       // id: 191490
                                rawData.match(/(\d{4,})/);                   // Любое число из 4+ цифр
            
            if (orderIdMatch && orderIdMatch[1]) {
                const orderId = orderIdMatch[1];
                console.log('⚠️ Найден возможный ID заказа в невалидном JSON:', orderId);
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
                        const orderData = await getOrderFromAPI(accountUrl, apiKey, orderId, null);
                        if (orderData) {
                            order = orderData;
                            console.log('✅ Данные заказа получены через API по ID:', orderId);
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
        }
        
        // Вариант 5: URL-encoded данные или query параметры
        if (!order && (req.body.order_id || req.body.orderNumber || req.query.order_id || req.query.orderNumber)) {
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
                    const orderData = await getOrderFromAPI(accountUrl, apiKey, orderId, null);
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
        // ВАЖНО: Сохраняем accountUrl, который был определен ранее из query параметров
        // Если accountUrl не был определен, пробуем определить его
        if (!accountUrl) {
            // Сначала проверяем query параметры (они имеют приоритет)
            accountUrl = req.query.account_url || 
                        req.query.accountUrl ||
                        req.headers['x-retailcrm-url'] || 
                        req.body.accountUrl || 
                        req.headers['referer']?.match(/https?:\/\/([^\/]+\.retailcrm\.ru)/)?.[0] ||
                        process.env.RETAILCRM_URL_1 || 
                        process.env.RETAILCRM_URL_3 ||
                        process.env.RETAILCRM_URL;
        } else {
            // Если accountUrl уже определен, логируем это
            console.log('   ✅ Account URL already determined:', accountUrl);
        }
        
        const telegramChannel = getTelegramChannelForAccount(accountUrl);
        const currency = getCurrencyForAccount(accountUrl);
        
        console.log('⚙️ Настройки:');
        console.log('   Account URL:', accountUrl);
        console.log('   Telegram Channel:', telegramChannel);
        console.log('   Currency:', currency);
        
        // Проверяем, не был ли заказ уже обработан (защита от дубликатов)
        const orderNumber = order.number || order.id;
        if (isOrderAlreadyProcessed(accountUrl, orderNumber)) {
            console.log('⏭️ Заказ уже был обработан ранее, пропускаем дубликат');
            res.status(200).json({ 
                success: true, 
                message: 'Order already processed (duplicate)',
                orderNumber: orderNumber
            });
            return;
        }
            
            // Форматируем и отправляем сообщение
        console.log('📝 Форматируем сообщение...');
        const apiKey = getApiKeyForAccount(accountUrl);
        const message = await formatOrderMessage(order, currency, accountUrl, apiKey);
        
        console.log('📤 Отправляем в Telegram...');
        const sent = await sendTelegramMessage(message, telegramChannel);
        
        if (sent) {
            // Отмечаем заказ как обработанный только после успешной отправки
            markOrderAsProcessed(accountUrl, orderNumber);
            console.log('✅ Успешно обработан заказ:', orderNumber);
            res.status(200).json({ 
                success: true, 
                message: 'Order processed successfully',
                orderNumber: orderNumber
            });
        } else {
            console.log('❌ Не удалось отправить сообщение в Telegram');
            res.status(200).json({ 
                success: false, 
                message: 'Failed to send Telegram message',
                orderNumber: orderNumber
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
const server = app.listen(PORT, () => {
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

// Обработка ошибок при запуске
server.on('error', (error) => {
    console.error('❌ Ошибка при запуске сервера:', error.message);
    if (error.code === 'EADDRINUSE') {
        console.error(`   Порт ${PORT} уже занят`);
    }
    process.exit(1);
});

// Обработка необработанных ошибок
process.on('uncaughtException', (error) => {
    console.error('❌ Необработанная ошибка:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Необработанное отклонение промиса:', reason);
    process.exit(1);
});

module.exports = app;


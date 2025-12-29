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
                    const order = response.data.orders[0];
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
// С retry логикой и правильным limit (20, 50 или 100)
async function getOrderByNumber(accountUrl, apiKey, orderNumber, site = null, retryCount = 0) {
    const maxRetries = 3; // Максимум 3 попытки с задержкой
    const retryDelay = 3000; // 3 секунды задержки между попытками (API может быть медленным)
    
    try {
        console.log(`   🔍 Searching order by number: ${orderNumber} (attempt ${retryCount + 1}/${maxRetries + 1})`);
        const params = { apiKey, number: orderNumber, limit: 20 }; // API требует 20, 50 или 100
        if (site) {
            params.site = site;
        }
        
        const response = await axios.get(`${accountUrl}/api/v5/orders`, {
            params: params,
            timeout: 10000
        });
        
        if (response.data.success && response.data.orders && response.data.orders.length > 0) {
            // Ищем заказ с точным номером (может быть несколько результатов)
            const order = response.data.orders.find(o => o.number === orderNumber) || response.data.orders[0];
            console.log(`   ✅ Order found by number: ${order.id}`);
            return order;
        }
        
        // Заказ не найден - возможно задержка в API, пробуем с задержкой
        if (retryCount < maxRetries) {
            console.log(`   ⚠️ Order not found by number (attempt ${retryCount + 1}/${maxRetries + 1})`);
            console.log(`   💡 Possible API delay - waiting ${retryDelay/1000} seconds before retry...`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
            return await getOrderByNumber(accountUrl, apiKey, orderNumber, site, retryCount + 1);
        }
        
        return null;
    } catch (error) {
        console.log(`   ⚠️ Search by number failed: ${error.message}`);
        if (error.response) {
            console.log(`   Response status: ${error.response.status}`);
            console.log(`   Response data:`, error.response.data);
            
            // Если ошибка про site, пробуем получить site код
            if (error.response.status === 400 && 
                error.response.data?.errorMsg?.includes('site')) {
                console.log('   ⚠️ Site parameter required for number search');
                // Пробуем получить site код и повторить
                const siteCode = await getSitesFromAPI(accountUrl, apiKey);
                if (siteCode) {
                    console.log(`   🔄 Retrying with site: ${siteCode}`);
                    try {
                        const retryResponse = await axios.get(`${accountUrl}/api/v5/orders`, {
                            params: { apiKey, number: orderNumber, limit: 20, site: siteCode },
                            timeout: 10000
                        });
                        if (retryResponse.data.success && retryResponse.data.orders && retryResponse.data.orders.length > 0) {
                            const order = retryResponse.data.orders[0];
                            console.log(`   ✅ Order found by number (with site: ${siteCode}): ${order.id}`);
                            return order;
                        }
                    } catch (retryError) {
                        console.log(`   ⚠️ Retry with site also failed: ${retryError.message}`);
                    }
                }
                
                // Пробуем стандартные site коды
                const defaultSites = ['default', 'main', 'store', 'shop', 'site1', 'site'];
                for (const siteCode of defaultSites) {
                    try {
                        console.log(`   🔄 Trying site: ${siteCode}`);
                        const retryResponse = await axios.get(`${accountUrl}/api/v5/orders`, {
                            params: { apiKey, number: orderNumber, limit: 20, site: siteCode },
                            timeout: 10000
                        });
                        if (retryResponse.data.success && retryResponse.data.orders && retryResponse.data.orders.length > 0) {
                            const order = retryResponse.data.orders.find(o => o.number === orderNumber) || retryResponse.data.orders[0];
                            console.log(`   ✅ Order found by number (with site: ${siteCode}): ${order.id}`);
                            return order;
                        }
                    } catch (retryError) {
                        // Продолжаем пробовать
                    }
                }
            }
            
            // Если заказ не найден (404) или другая ошибка, и это не последняя попытка, пробуем с задержкой
            if (retryCount < maxRetries && (error.response.status === 404 || error.response.status === 400)) {
                console.log(`   ⚠️ Order not found by number (attempt ${retryCount + 1}/${maxRetries + 1})`);
                console.log(`   💡 Possible API delay - waiting ${retryDelay/1000} seconds before retry...`);
                await new Promise(resolve => setTimeout(resolve, retryDelay));
                return await getOrderByNumber(accountUrl, apiKey, orderNumber, site, retryCount + 1);
            }
        }
        return null;
    }
}

// Функция для получения данных заказа через API
// ПРИОРИТЕТ: ТОЛЬКО по номеру заказа (orderNumber более точный)
// Если номер не указан, только тогда пробуем по ID
async function getOrderFromAPI(accountUrl, apiKey, orderId, orderNumber = null, site = null, retryCount = 0) {
    const maxRetries = 3; // Максимум 3 попытки с задержкой
    const retryDelay = 3000; // 3 секунды задержки между попытками (API может быть медленным)
    
    // ПРИОРИТЕТ 1: Если есть номер заказа, используем ТОЛЬКО его (более точный)
    if (orderNumber) {
        console.log(`📡 API Request (by number ONLY): ${accountUrl}/api/v5/orders?number=${orderNumber} (attempt ${retryCount + 1}/${maxRetries + 1})`);
        const order = await getOrderByNumber(accountUrl, apiKey, orderNumber, site, retryCount);
        if (order) {
            return order;
        }
        // Если не нашли после всех попыток, возвращаем null (не пробуем по ID)
        console.log(`   ❌ Order not found by number after ${maxRetries + 1} attempts`);
        return null;
    }
    
    // ПРИОРИТЕТ 2: Если номер не указан, только тогда пробуем по ID (fallback)
    // НО: если номер был указан, но не найден - не пробуем по ID (ID может быть неправильным)
    if (orderId && !orderNumber) {
        try {
            console.log(`📡 API Request (by ID): ${accountUrl}/api/v5/orders/${orderId}`);
            
            // Формируем параметры запроса
            const params = { apiKey };
            
            // Если нужен параметр site, добавляем его
            if (site) {
                params.site = site;
            }
            
            const response = await axios.get(`${accountUrl}/api/v5/orders/${orderId}`, {
                params: params,
                timeout: 10000
            });

            if (response.data.success && response.data.order) {
                const order = response.data.order;
                console.log('✅ API Response received');
                console.log('   Order ID:', order.id);
                console.log('   Order Number:', order.number);
                console.log('   Available fields:', Object.keys(order).slice(0, 20).join(', '));
                
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
                console.error('❌ API Error:', response.data.errorMsg);
                
                // Если 404 и есть номер заказа, пробуем найти по номеру
                if (response.data.errorMsg && response.data.errorMsg.includes('Not found') && orderNumber) {
                    console.log('   ⚠️ Order not found by ID, trying to find by number...');
                    const orderByNumber = await getOrderByNumber(accountUrl, apiKey, orderNumber, site);
                    if (orderByNumber) {
                        console.log('✅ Order found by number!');
                        return orderByNumber;
                    }
                }
                
                // Если ошибка про site, получаем список сайтов и пробуем с site параметром
                if (response.data.errorMsg && response.data.errorMsg.includes('site')) {
                    console.log('   ⚠️ Site parameter required, getting sites list...');
                    const siteCode = await getSitesFromAPI(accountUrl, apiKey);
                    
                    // Список site кодов для попытки
                    const sitesToTry = [];
                    if (siteCode) {
                        sitesToTry.push(siteCode);
                    }
                    // Добавляем дефолтные значения
                    sitesToTry.push('default', 'main', 'store', 'shop', 'site1', 'site');
                    
                    // Пробуем каждый site код
                    for (const site of sitesToTry) {
                        console.log(`   🔄 Trying with site parameter: ${site}`);
                        try {
                            const retryResponse = await axios.get(`${accountUrl}/api/v5/orders/${orderId}`, {
                                params: { apiKey, site: site },
                                timeout: 10000
                            });
                            if (retryResponse.data.success && retryResponse.data.order) {
                                console.log(`✅ API Response received (with site: ${site})`);
                                return retryResponse.data.order;
                            }
                        } catch (retryError) {
                            // Продолжаем пробовать следующий site
                            if (retryError.response?.status !== 400) {
                                console.log(`   ⚠️ Site ${site} failed: ${retryError.message}`);
                            }
                        }
                    }
                }
                return null;
            }
        } catch (error) {
            console.error('❌ API Request Error:', error.message);
            if (error.response) {
                console.error('   Response status:', error.response.status);
                console.error('   Response data:', error.response.data);
                
                // Если 404 и это первая попытка, пробуем с задержкой (возможно задержка в API)
                if (error.response.status === 404 && retryCount < maxRetries) {
                    console.log(`   ⚠️ Order not found (404) - attempt ${retryCount + 1}/${maxRetries}`);
                    console.log(`   💡 Possible API delay - waiting ${retryDelay/1000} seconds before retry...`);
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                    return await getOrderFromAPI(accountUrl, apiKey, orderId, orderNumber, site, retryCount + 1);
                }
                
                // Если ошибка 400 про site, получаем список сайтов и пробуем с site параметром
                if (error.response.status === 400 && 
                    error.response.data?.errorMsg?.includes('site')) {
                    console.log('   ⚠️ Site parameter required, getting sites list...');
                    try {
                        const siteCode = await getSitesFromAPI(accountUrl, apiKey);
                        
                        // Список site кодов для попытки
                        const sitesToTry = [];
                        if (siteCode) {
                            sitesToTry.push(siteCode);
                        }
                        // Добавляем дефолтные значения
                        sitesToTry.push('default', 'main', 'store', 'shop', 'site1', 'site');
                        
                        // Пробуем каждый site код
                        for (const siteCode of sitesToTry) {
                            console.log(`   🔄 Trying with site parameter: ${siteCode}`);
                            try {
                                // Сначала пробуем по ID
                                const retryResponse = await axios.get(`${accountUrl}/api/v5/orders/${orderId}`, {
                                    params: { apiKey, site: siteCode },
                                    timeout: 10000
                                });
                                if (retryResponse.data.success && retryResponse.data.order) {
                                    console.log(`✅ API Response received (with site: ${siteCode})`);
                                    return retryResponse.data.order;
                                }
                                
                                // Если не нашли по ID и есть номер, пробуем по номеру
                                if (orderNumber) {
                                    const orderByNumber = await getOrderByNumber(accountUrl, apiKey, orderNumber, siteCode);
                                    if (orderByNumber) {
                                        console.log(`✅ Order found by number (with site: ${siteCode})`);
                                        return orderByNumber;
                                    }
                                }
                            } catch (retryError) {
                                // Продолжаем пробовать следующий site
                                if (retryError.response?.status !== 400 && retryError.response?.status !== 404) {
                                    console.log(`   ⚠️ Site ${siteCode} failed: ${retryError.message}`);
                                }
                            }
                        }
                        
                        // Последняя попытка без site
                        console.log('   ⚠️ All site codes failed, trying without site parameter...');
                        try {
                            const lastRetry = await axios.get(`${accountUrl}/api/v5/orders/${orderId}`, {
                                params: { apiKey },
                                timeout: 10000
                            });
                            if (lastRetry.data.success && lastRetry.data.order) {
                                console.log('✅ API Response received (retry without site)');
                                return lastRetry.data.order;
                            }
                        } catch (lastError) {
                            // Если не нашли по ID и есть номер, пробуем по номеру без site
                            if (lastError.response?.status === 404 && orderNumber) {
                                console.log('   🔍 Last attempt: searching by number without site...');
                                const orderByNumber = await getOrderByNumber(accountUrl, apiKey, orderNumber);
                                if (orderByNumber) {
                                    console.log('✅ Order found by number (without site)!');
                                    return orderByNumber;
                                }
                            }
                        }
                    } catch (retryError) {
                        console.error('   ❌ All retry attempts failed:', retryError.message);
                    }
                }
            }
        }
    }
    
    // Если ничего не помогло
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

// Функция для форматирования сообщения о заказе (на английском)
function formatOrderMessage(order, currency = 'GHS') {
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
    const manager = order.manager || 
                   order.managerName || 
                   (order.manager && typeof order.manager === 'object' ? order.manager.name : null) ||
                   'Not specified';

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
                                // Если не нашли в первом аккаунте, пробуем второй (fallback)
                                if (accountUrl.includes('aff-gh.retailcrm.ru')) {
                                    const account3Url = process.env.RETAILCRM_URL_3 || 'https://slimteapro-store.retailcrm.ru';
                                    const account3Key = process.env.RETAILCRM_API_KEY_3;
                                    if (account3Key) {
                                        console.log(`🔑 Trying Account 3 as fallback: ${account3Url}`);
                                        const orderData3 = await getOrderFromAPI(account3Url, account3Key, orderId, orderNumber);
                                        if (orderData3 && (orderData3.customer || orderData3.items)) {
                                            order = orderData3;
                                            accountUrl = account3Url;
                                            console.log('✅ Full order data received via API (Account 3 fallback)');
                                        }
                                    }
                                } else {
                                    const account1Url = process.env.RETAILCRM_URL_1 || 'https://aff-gh.retailcrm.ru';
                                    const account1Key = process.env.RETAILCRM_API_KEY_1;
                                    if (account1Key) {
                                        console.log(`🔑 Trying Account 1 as fallback: ${account1Url}`);
                                        const orderData1 = await getOrderFromAPI(account1Url, account1Key, orderId, orderNumber);
                                        if (orderData1 && (orderData1.customer || orderData1.items)) {
                                            order = orderData1;
                                            accountUrl = account1Url;
                                            console.log('✅ Full order data received via API (Account 1 fallback)');
                                        }
                                    }
                                }
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
                    
                    // Если все еще нет данных, используем частичные данные из query
                    if (!order || (!order.customer && !order.items)) {
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


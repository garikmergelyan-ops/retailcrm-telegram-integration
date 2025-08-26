const axios = require('axios');
require('dotenv').config();

// Тестовые данные заказа
const testOrder = {
    number: "TEST-001",
    status: "approved",
    manager: "Иван Иванов",
    deliveryDate: "2024-08-26",
    firstName: "Петр",
    lastName: "Петров",
    phone: "+233 20 123 4567",
    additionalPhone: "+233 24 987 6543",
    deliveryAddress: "ул. Аддо, д. 15, кв. 7",
    city: "Аккра",
    totalSumm: "1500.00",
    items: [
        {
            productName: "Смартфон Samsung Galaxy",
            quantity: 1
        },
        {
            productName: "Чехол для телефона",
            quantity: 2
        }
    ]
};

// Функция для отправки тестового сообщения
async function sendTestMessage() {
    try {
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        const channelId = process.env.TELEGRAM_CHANNEL_ID;
        
        if (!botToken || !channelId) {
            console.error('❌ Отсутствуют настройки Telegram в .env файле');
            console.log('Создайте .env файл на основе env.example и заполните все данные');
            return;
        }

        console.log('🧪 Отправляю тестовое сообщение...');
        
        const response = await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            chat_id: channelId,
            text: formatOrderMessage(testOrder),
            parse_mode: 'HTML'
        });

        if (response.data.ok) {
            console.log('✅ Тестовое сообщение успешно отправлено в Telegram!');
            console.log('📱 Проверьте ваш канал:', channelId);
        } else {
            console.error('❌ Ошибка отправки:', response.data);
        }
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
        
        if (error.response) {
            console.error('Детали ошибки:', error.response.data);
        }
        
        console.log('\n🔍 Возможные причины:');
        console.log('1. Неправильный токен бота');
        console.log('2. Бот не добавлен в канал');
        console.log('3. Неправильный ID канала');
        console.log('4. Проблемы с интернет-соединением');
    }
}

// Функция форматирования сообщения (копия из server.js)
function formatOrderMessage(order) {
    const items = order.items || [];
    const itemsText = items.map(item => 
        `• ${item.productName} - ${item.quantity} шт.`
    ).join('\n');

    return `🛒 <b>НОВЫЙ ЗАКАЗ АППРУВЛЕН!</b>

📋 <b>Номер заказа:</b> ${order.number}
👤 <b>Оператор:</b> ${order.manager || 'Не указан'}
📅 <b>Дата доставки:</b> ${order.deliveryDate || 'Не указана'}
👨‍💼 <b>Имя клиента:</b> ${order.firstName} ${order.lastName}
📱 <b>Телефон:</b> ${order.phone || 'Не указан'}
📱 <b>Доп. телефон:</b> ${order.additionalPhone || 'Не указан'}
📍 <b>Адрес доставки:</b> ${order.deliveryAddress || 'Не указан'}
🏙️ <b>Город:</b> ${order.city || 'Не указан'}

🛍️ <b>Товары:</b>
${itemsText}

💰 <b>Сумма заказа:</b> ${order.totalSumm} ${process.env.CURRENCY || 'GHS'}

⏰ <b>Время аппрува:</b> ${new Date().toLocaleString('ru-RU')}

🧪 <i>Это тестовое сообщение для проверки интеграции</i>`;
}

// Проверка настроек
function checkSettings() {
    console.log('🔍 Проверка настроек...\n');
    
    const required = [
        'TELEGRAM_BOT_TOKEN',
        'TELEGRAM_CHANNEL_ID',
        'RETAILCRM_URL',
        'RETAILCRM_API_KEY'
    ];
    
    let allSet = true;
    
    required.forEach(key => {
        const value = process.env[key];
        if (value) {
            console.log(`✅ ${key}: ${key.includes('TOKEN') || key.includes('KEY') ? '***' + value.slice(-4) : value}`);
        } else {
            console.log(`❌ ${key}: не установлен`);
            allSet = false;
        }
    });
    
    console.log('');
    return allSet;
}

// Главная функция
async function main() {
    console.log('🚀 Тестирование RetailCRM → Telegram интеграции\n');
    
    if (!checkSettings()) {
        console.log('⚠️  Не все настройки установлены. Создайте .env файл на основе env.example');
        return;
    }
    
    console.log('📤 Отправка тестового сообщения...\n');
    await sendTestMessage();
}

// Запуск теста
if (require.main === module) {
    main().catch(console.error);
}

module.exports = { sendTestMessage, formatOrderMessage };

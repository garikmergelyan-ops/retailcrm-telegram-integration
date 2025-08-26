const axios = require('axios');
require('dotenv').config();

async function testBotOnly() {
    try {
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        
        if (!botToken) {
            console.error('❌ Отсутствует токен бота');
            return;
        }

        console.log('🤖 Тестирую бота...');
        
        // Получаем информацию о боте
        const botInfo = await axios.get(`https://api.telegram.org/bot${botToken}/getMe`);
        
        if (botInfo.data.ok) {
            console.log('✅ Бот работает!');
            console.log('📱 Имя бота:', botInfo.data.result.first_name);
            console.log('🔗 Username:', botInfo.data.result.username);
            console.log('🆔 ID бота:', botInfo.data.result.id);
        } else {
            console.error('❌ Ошибка получения информации о боте');
        }
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
        
        if (error.response) {
            console.error('Детали ошибки:', error.response.data);
        }
    }
}

testBotOnly();

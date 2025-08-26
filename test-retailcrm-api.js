const axios = require('axios');
require('dotenv').config();

async function testRetailCRMAPI() {
    try {
        const retailcrmUrl = process.env.RETAILCRM_URL;
        const apiKey = process.env.RETAILCRM_API_KEY;
        
        if (!retailcrmUrl || !apiKey) {
            console.error('❌ Отсутствуют настройки RetailCRM');
            return;
        }

        console.log('🔍 Тестирую API RetailCRM...\n');
        
        // 1. Проверяем базовую доступность API
        console.log('1️⃣ Проверяю базовую доступность API...');
        try {
            const response = await axios.get(`${retailcrmUrl}/api/v5/orders`, {
                params: { apiKey, limit: 20 }
            });
            
            if (response.data.success) {
                console.log('✅ API доступен');
                console.log('📊 Получено заказов:', response.data.orders?.length || 0);
                
                // 2. Анализируем полученные заказы
                console.log('\n2️⃣ Анализирую полученные заказы...');
                if (response.data.orders?.length > 0) {
                    console.log('✅ Заказы получены. Примеры статусов:');
                    response.data.orders.slice(0, 5).forEach(order => {
                        console.log(`   - Заказ ${order.number || order.id}: статус "${order.status}"`);
                    });
                } else {
                    console.log('ℹ️ Заказы не найдены');
                }
                
            } else {
                console.error('❌ API недоступен:', response.data.errorMsg);
                return;
            }
        } catch (error) {
            console.error('❌ Ошибка API:', error.message);
            if (error.response) {
                console.error('Детали:', error.response.data);
            }
            return;
        }

        // 3. Пробуем получить справочник статусов
        console.log('\n3️⃣ Пробую получить справочник статусов...');
        try {
            const refResponse = await axios.get(`${retailcrmUrl}/api/v5/reference/order-statuses`, {
                params: { apiKey }
            });
            
            if (refResponse.data.success) {
                console.log('✅ Справочник статусов:');
                refResponse.data.orderStatuses?.forEach(status => {
                    console.log(`   - ${status.code}: ${status.name}`);
                });
            } else {
                console.log('ℹ️ Справочник статусов недоступен');
            }
        } catch (error) {
            console.log('ℹ️ Справочник статусов недоступен');
        }

    } catch (error) {
        console.error('❌ Общая ошибка:', error.message);
    }
}

testRetailCRMAPI();

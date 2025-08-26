const axios = require('axios');
require('dotenv').config();

async function debugOrderFields() {
    try {
        const retailcrmUrl = process.env.RETAILCRM_URL;
        const apiKey = process.env.RETAILCRM_API_KEY;
        
        if (!retailcrmUrl || !apiKey) {
            console.error('Отсутствуют настройки RetailCRM');
            return;
        }

        console.log('🔍 Получаю заказы для анализа полей...');
        console.log('URL:', retailcrmUrl);
        console.log('API Key:', apiKey.substring(0, 10) + '...');
        
        const response = await axios.get(`${retailcrmUrl}/api/v5/orders`, {
            params: { 
                apiKey,
                limit: 20
            }
        });

        if (response.data.success && response.data.orders && response.data.orders.length > 0) {
            console.log('\n📊 АНАЛИЗ СТАТУСОВ ЗАКАЗОВ:');
            console.log('=' .repeat(50));
            
            // Группируем заказы по статусам
            const statusGroups = {};
            response.data.orders.forEach(order => {
                const status = order.status;
                if (!statusGroups[status]) {
                    statusGroups[status] = [];
                }
                statusGroups[status].push(order.number || order.id);
            });
            
            console.log('📋 Статусы заказов:');
            Object.entries(statusGroups).forEach(([status, orders]) => {
                console.log(`  ${status}: ${orders.length} заказов`);
            });
            
            // Ищем заказы с разными статусами для анализа
            const order = response.data.orders[0];
            
            // Ищем approved заказ для анализа
            const approvedOrder = response.data.orders.find(o => o.status === 'approved');
            if (approvedOrder) {
                console.log('\n🎯 АНАЛИЗ APPROVED ЗАКАЗА:');
                console.log('=' .repeat(50));
                console.log('🔑 ID заказа:', approvedOrder.id);
                console.log('📝 Номер заказа:', approvedOrder.number);
                console.log('📊 Статус:', approvedOrder.status);
                
                // Ищем поля оператора в approved заказе
                console.log('\n👤 ПОЛЯ ОПЕРАТОРА В APPROVED ЗАКАЗЕ:');
                console.log('manager:', approvedOrder.manager);
                console.log('managerName:', approvedOrder.managerName);
                console.log('managerId:', approvedOrder.managerId);
                console.log('createdBy:', approvedOrder.createdBy);
                console.log('updatedBy:', approvedOrder.updatedBy);
                console.log('assignedTo:', approvedOrder.assignedTo);
                
                // Проверяем все поля approved заказа
                console.log('\n📋 ВСЕ ПОЛЯ APPROVED ЗАКАЗА:');
                Object.keys(approvedOrder).forEach(key => {
                    const value = approvedOrder[key];
                    if (value !== null && value !== undefined) {
                        if (typeof value === 'object') {
                            console.log(`📁 ${key}:`, JSON.stringify(value, null, 2));
                        } else {
                            console.log(`📝 ${key}: ${value}`);
                        }
                    }
                });
            }
            
            console.log('\n📋 АНАЛИЗ ПОЛЕЙ ЗАКАЗА:');
            console.log('=' .repeat(50));
            
            // Выводим все поля заказа
            console.log('🔑 ID заказа:', order.id);
            console.log('📝 Номер заказа:', order.number);
            console.log('📊 Статус:', order.status);
            
            // Ищем поля, связанные с оператором/менеджером
            console.log('\n👤 ПОЛЯ ОПЕРАТОРА/МЕНЕДЖЕРА:');
            console.log('manager:', order.manager);
            console.log('managerName:', order.managerName);
            console.log('managerId:', order.managerId);
            console.log('managerEmail:', order.managerEmail);
            console.log('managerPhone:', order.managerPhone);
            
            // Проверяем вложенные объекты
            if (order.manager) {
                console.log('\n📋 Объект manager:');
                console.log(JSON.stringify(order.manager, null, 2));
            }
            
            // Проверяем другие возможные места
            console.log('\n🔍 ДРУГИЕ ВОЗМОЖНЫЕ ПОЛЯ:');
            console.log('createdBy:', order.createdBy);
            console.log('updatedBy:', order.updatedBy);
            console.log('assignedTo:', order.assignedTo);
            
            // Проверяем контактную информацию
            if (order.contact) {
                console.log('\n📞 Объект contact:');
                console.log(JSON.stringify(order.contact, null, 2));
            }
            
            // Проверяем доставку
            if (order.delivery) {
                console.log('\n🚚 Объект delivery:');
                console.log(JSON.stringify(order.delivery, null, 2));
            }
            
            // Выводим все доступные поля
            console.log('\n📋 ВСЕ ДОСТУПНЫЕ ПОЛЯ:');
            console.log(Object.keys(order).sort());
            
        } else {
            console.error('Ошибка получения заказов:', response.data.errorMsg);
        }
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
        if (error.response) {
            console.error('Статус:', error.response.status);
            console.error('Данные:', error.response.data);
        }
    }
}

// Запускаем отладку
debugOrderFields();

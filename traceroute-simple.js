#!/usr/bin/env node

/**
 * Упрощенная версия скрипта для трассировки маршрута
 * Выводит результат в стандартном формате (как tracert/traceroute)
 * Для отправки поддержке RetailCRM
 * 
 * Использование: node traceroute-simple.js
 */

const { exec } = require('child_process');
const util = require('util');
const fs = require('fs');
const dns = require('dns').promises;
const axios = require('axios');
const execPromise = util.promisify(exec);

async function runTraceroute(hostname) {
    let result = '';
    
    // Попытка 1: Использовать traceroute
    try {
        console.log(`\nТрассировка маршрута до ${hostname}`);
        console.log('='.repeat(70));
        console.log(`Команда: traceroute -n -m 30 -w 5 ${hostname}\n`);
        
        const command = `traceroute -n -m 30 -w 5 ${hostname}`;
        const { stdout, stderr } = await execPromise(command, {
            timeout: 180000
        });
        
        if (stderr) {
            console.error('Предупреждения:', stderr);
        }
        
        console.log(stdout);
        return stdout;
    } catch (error) {
        // Если traceroute не найден, используем альтернативные методы
        if (error.message.includes('traceroute: command not found') || 
            error.message.includes('ENOENT') ||
            error.message.includes('not found')) {
            
            console.log('\n⚠️ Traceroute не установлен на сервере.');
            console.log('Использую альтернативные методы диагностики...\n');
            
            result += `\nПРИМЕЧАНИЕ: Команда traceroute недоступна на сервере Render.com.\n`;
            result += `Используются альтернативные методы диагностики сети.\n\n`;
            
            // Метод 1: DNS резолвинг
            try {
                console.log('1. DNS резолвинг...');
                const addresses = await dns.resolve4(hostname);
                result += `DNS резолвинг для ${hostname}:\n`;
                result += `IP адреса: ${addresses.join(', ')}\n\n`;
                console.log(`   IP адреса: ${addresses.join(', ')}`);
            } catch (dnsError) {
                result += `DNS резолвинг: ОШИБКА - ${dnsError.message}\n\n`;
                console.error(`   Ошибка DNS: ${dnsError.message}`);
            }
            
            // Метод 2: Ping
            try {
                console.log('2. Ping тест...');
                const { stdout: pingOutput } = await execPromise(`ping -c 10 -W 5 ${hostname}`, {
                    timeout: 60000
                });
                result += `Ping тест (10 пакетов):\n${pingOutput}\n`;
                console.log(pingOutput);
            } catch (pingError) {
                // Попробуем без флага -W (для некоторых систем)
                try {
                    const { stdout: pingOutput2 } = await execPromise(`ping -c 10 ${hostname}`, {
                        timeout: 60000
                    });
                    result += `Ping тест (10 пакетов):\n${pingOutput2}\n`;
                    console.log(pingOutput2);
                } catch (pingError2) {
                    result += `Ping тест: ОШИБКА - ${pingError2.message}\n\n`;
                    console.error(`   Ошибка ping: ${pingError2.message}`);
                }
            }
            
            // Метод 3: HTTP запрос с измерением времени
            try {
                console.log('3. HTTP запрос с измерением времени...');
                const startTime = Date.now();
                const response = await axios.get(`https://${hostname}`, {
                    timeout: 30000,
                    validateStatus: () => true // Принимаем любой статус
                });
                const endTime = Date.now();
                const duration = endTime - startTime;
                
                result += `HTTP запрос к https://${hostname}:\n`;
                result += `Статус: ${response.status}\n`;
                result += `Время ответа: ${duration}ms\n`;
                result += `Размер ответа: ${JSON.stringify(response.data).length} байт\n\n`;
                
                console.log(`   Статус: ${response.status}, Время: ${duration}ms`);
            } catch (httpError) {
                result += `HTTP запрос: ОШИБКА - ${httpError.message}\n\n`;
                console.error(`   Ошибка HTTP: ${httpError.message}`);
            }
            
            // Метод 4: Информация о сетевых интерфейсах
            try {
                console.log('4. Информация о сетевых интерфейсах...');
                const { stdout: ifconfig } = await execPromise('hostname -I 2>/dev/null || ip addr show 2>/dev/null || ifconfig 2>/dev/null || echo "Недоступно"', {
                    timeout: 5000
                });
                result += `Сетевые интерфейсы сервера:\n${ifconfig}\n`;
                console.log(`   ${ifconfig.trim()}`);
            } catch (netError) {
                // Игнорируем ошибки
            }
            
            return result;
        } else {
            // Другая ошибка
            throw error;
        }
    }
}

// Выполняем трассировку для обоих аккаунтов
async function main() {
    const accounts = [
        {
            name: 'Account 1 (Ghana)',
            hostname: 'aff-gh.retailcrm.ru'
        },
        {
            name: 'Account 3 (SlimTeaPro)',
            hostname: 'slimteapro-store.retailcrm.ru'
        }
    ];
    
    console.log('='.repeat(70));
    console.log('ДИАГНОСТИКА СЕТИ ДО RETAILCRM СЕРВЕРОВ');
    console.log('='.repeat(70));
    console.log('Выполняется с сервера Render.com (Linux)');
    console.log('Метод: traceroute (если доступен) или альтернативные методы');
    console.log('='.repeat(70));
    
    const results = {};
    const outputLines = [];
    
    // Добавляем заголовок в вывод
    outputLines.push('='.repeat(70));
    outputLines.push('ДИАГНОСТИКА СЕТИ ДО RETAILCRM СЕРВЕРОВ');
    outputLines.push('='.repeat(70));
    outputLines.push('Выполнено: ' + new Date().toISOString());
    outputLines.push('Сервер: Render.com (Linux)');
    outputLines.push('Метод: traceroute (если доступен) или альтернативные методы');
    outputLines.push('='.repeat(70));
    outputLines.push('');
    
    for (const account of accounts) {
        try {
            outputLines.push('\n' + '='.repeat(70));
            outputLines.push(`${account.name} - ${account.hostname}`);
            outputLines.push('='.repeat(70));
            
            console.log(`\n\n${'='.repeat(70)}`);
            console.log(`${account.name} - ${account.hostname}`);
            console.log('='.repeat(70));
            
            const result = await runTraceroute(account.hostname);
            
            results[account.name] = {
                success: true,
                result: result,
                hostname: account.hostname
            };
            
            outputLines.push(result);
            
        } catch (error) {
            const errorMsg = `Ошибка: ${error.message}`;
            console.error(`\n❌ Не удалось выполнить трассировку до ${account.name}`);
            console.error(errorMsg);
            
            results[account.name] = {
                success: false,
                error: error.message,
                hostname: account.hostname
            };
            
            outputLines.push(`\nОШИБКА: ${error.message}`);
        }
        
        // Пауза между трассировками
        if (account !== accounts[accounts.length - 1]) {
            console.log('\nПауза 3 секунды перед следующей трассировкой...');
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    }
    
    // Сохраняем результаты в файл
    const outputFile = 'traceroute-results.txt';
    const fullOutput = outputLines.join('\n');
    
    try {
        fs.writeFileSync(outputFile, fullOutput, 'utf8');
        console.log(`\n\n${'='.repeat(70)}`);
        console.log('Результаты сохранены в файл: ' + outputFile);
        console.log('='.repeat(70));
        console.log('\nЭтот файл можно отправить поддержке RetailCRM');
    } catch (error) {
        console.error(`\nНе удалось сохранить результаты в файл: ${error.message}`);
    }
    
    // Итоговый отчет
    console.log('\n' + '='.repeat(70));
    console.log('ИТОГОВЫЙ ОТЧЕТ');
    console.log('='.repeat(70));
    
    for (const [accountName, result] of Object.entries(results)) {
        if (result.success) {
            console.log(`✅ ${accountName}: Трассировка выполнена успешно`);
        } else {
            console.log(`❌ ${accountName}: Ошибка - ${result.error}`);
        }
    }
    
    console.log('\n' + '='.repeat(70));
    console.log('Следующие шаги:');
    console.log('1. Проверьте файл traceroute-results.txt');
    console.log('2. Отправьте содержимое файла поддержке RetailCRM');
    console.log('3. Удалите скрипт после использования');
    console.log('='.repeat(70));
}

// Запускаем
main().catch(error => {
    console.error(`\nКритическая ошибка: ${error.message}`);
    process.exit(1);
});


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
const execPromise = util.promisify(exec);

async function runTraceroute(hostname) {
    try {
        console.log(`\nТрассировка маршрута до ${hostname}`);
        console.log('='.repeat(70));
        console.log(`Команда: traceroute -n -m 30 -w 5 ${hostname}\n`);
        
        // Для Linux/Unix систем (Render.com использует Linux)
        // -n: не резолвить имена хостов (быстрее, как в tracert)
        // -m: максимальное количество узлов (30)
        // -w: таймаут для каждого узла (5 секунд)
        const command = `traceroute -n -m 30 -w 5 ${hostname}`;
        
        const { stdout, stderr } = await execPromise(command, {
            timeout: 180000 // 3 минуты таймаут
        });
        
        if (stderr) {
            console.error('Предупреждения:', stderr);
        }
        
        // Выводим чистый результат (без цветов и анализа)
        console.log(stdout);
        
        return stdout;
    } catch (error) {
        console.error(`\nОшибка при выполнении трассировки: ${error.message}`);
        
        // Если traceroute не установлен, попробуем ping
        if (error.message.includes('traceroute: command not found') || 
            error.message.includes('ENOENT')) {
            console.log('\nTraceroute не найден. Пробую альтернативный метод через ping...\n');
            
            try {
                const { stdout } = await execPromise(`ping -c 10 ${hostname}`);
                console.log(stdout);
            } catch (pingError) {
                console.error(`Ping тоже не работает: ${pingError.message}`);
            }
        }
        
        throw error;
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
    console.log('ТРАССИРОВКА МАРШРУТА ДО RETAILCRM СЕРВЕРОВ');
    console.log('='.repeat(70));
    console.log('Выполняется с сервера Render.com (Linux)');
    console.log('Команда: traceroute (Linux эквивалент tracert в Windows)');
    console.log('='.repeat(70));
    
    const results = {};
    const outputLines = [];
    
    // Добавляем заголовок в вывод
    outputLines.push('='.repeat(70));
    outputLines.push('ТРАССИРОВКА МАРШРУТА ДО RETAILCRM СЕРВЕРОВ');
    outputLines.push('='.repeat(70));
    outputLines.push('Выполнено: ' + new Date().toISOString());
    outputLines.push('Сервер: Render.com (Linux)');
    outputLines.push('Команда: traceroute (Linux эквивалент tracert в Windows)');
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


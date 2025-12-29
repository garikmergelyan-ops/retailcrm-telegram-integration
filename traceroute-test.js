#!/usr/bin/env node

/**
 * Скрипт для выполнения трассировки маршрута до RetailCRM серверов
 * Использование: node traceroute-test.js
 */

const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

// Цвета для вывода (если поддерживается)
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

async function runTraceroute(hostname) {
    try {
        log(`\n${'='.repeat(70)}`, 'cyan');
        log(`🔍 Выполняю трассировку до: ${hostname}`, 'bright');
        log('='.repeat(70), 'cyan');
        
        // Для Linux/Unix систем (Render.com использует Linux)
        // -n: не резолвить имена хостов (быстрее)
        // -m: максимальное количество узлов (30)
        // -w: таймаут для каждого узла (5 секунд)
        const command = `traceroute -n -m 30 -w 5 ${hostname}`;
        
        log(`\n📡 Команда: ${command}`, 'blue');
        log('⏳ Ожидайте, это может занять до 2-3 минут...\n', 'yellow');
        
        const { stdout, stderr } = await execPromise(command, {
            timeout: 180000 // 3 минуты таймаут
        });
        
        if (stderr) {
            log('\n⚠️ Предупреждения:', 'yellow');
            console.log(stderr);
        }
        
        log('\n📊 Результат трассировки:', 'green');
        console.log(stdout);
        
        // Анализ результатов
        analyzeTraceroute(stdout, hostname);
        
        return stdout;
    } catch (error) {
        log(`\n❌ Ошибка при выполнении трассировки: ${error.message}`, 'red');
        
        // Если traceroute не установлен, попробуем ping
        if (error.message.includes('traceroute: command not found') || 
            error.message.includes('ENOENT')) {
            log('\n🔄 Traceroute не найден. Пробую альтернативный метод через ping...', 'yellow');
            
            try {
                const { stdout } = await execPromise(`ping -c 10 ${hostname}`);
                log('\n📊 Результат ping:', 'green');
                console.log(stdout);
            } catch (pingError) {
                log(`❌ Ping тоже не работает: ${pingError.message}`, 'red');
            }
        }
        
        throw error;
    }
}

function analyzeTraceroute(output, hostname) {
    log('\n📈 Анализ результатов:', 'cyan');
    log('='.repeat(70), 'cyan');
    
    const lines = output.split('\n').filter(line => line.trim());
    const hops = [];
    
    for (const line of lines) {
        // Парсим строки вида: " 1  10.0.0.1  0.123 ms  0.098 ms  0.087 ms"
        const match = line.match(/^\s*(\d+)\s+(\S+)\s+(.+)$/);
        if (match) {
            const hopNumber = parseInt(match[1]);
            const ip = match[2];
            const times = match[3].split(/\s+/).filter(t => t && t !== 'ms');
            
            // Пропускаем узлы с потерями пакетов (*)
            const validTimes = times.filter(t => t !== '*' && !t.includes('*')).map(t => parseFloat(t));
            
            if (validTimes.length > 0) {
                const avgTime = validTimes.reduce((a, b) => a + b, 0) / validTimes.length;
                const maxTime = Math.max(...validTimes);
                
                hops.push({
                    hop: hopNumber,
                    ip: ip,
                    avgTime: avgTime,
                    maxTime: maxTime,
                    packetLoss: times.length - validTimes.length
                });
            } else {
                // Все пакеты потеряны
                hops.push({
                    hop: hopNumber,
                    ip: ip,
                    avgTime: null,
                    maxTime: null,
                    packetLoss: times.length
                });
            }
        }
    }
    
    // Находим проблемные узлы
    const problematicHops = hops.filter(h => 
        (h.avgTime && h.avgTime > 100) || // Задержка > 100ms
        h.packetLoss > 0 || // Потери пакетов
        (h.maxTime && h.maxTime > 200) // Максимальная задержка > 200ms
    );
    
    if (problematicHops.length > 0) {
        log('\n⚠️ Обнаружены проблемные узлы:', 'yellow');
        problematicHops.forEach(h => {
            if (h.packetLoss > 0) {
                log(`  Узел ${h.hop} (${h.ip}): Потеряно ${h.packetLoss} пакетов`, 'red');
            } else if (h.avgTime > 100) {
                log(`  Узел ${h.hop} (${h.ip}): Средняя задержка ${h.avgTime.toFixed(2)}ms`, 'yellow');
            }
        });
    } else {
        log('\n✅ Все узлы в норме (задержки < 100ms, потерь пакетов нет)', 'green');
    }
    
    // Статистика
    const totalHops = hops.length;
    const avgDelay = hops.filter(h => h.avgTime).reduce((sum, h) => sum + h.avgTime, 0) / hops.filter(h => h.avgTime).length;
    const totalPacketLoss = hops.reduce((sum, h) => sum + h.packetLoss, 0);
    
    log('\n📊 Статистика:', 'blue');
    log(`  Всего узлов: ${totalHops}`, 'reset');
    if (avgDelay) {
        log(`  Средняя задержка: ${avgDelay.toFixed(2)}ms`, 'reset');
    }
    log(`  Всего потеряно пакетов: ${totalPacketLoss}`, totalPacketLoss > 0 ? 'yellow' : 'reset');
    
    // Определяем, где может быть проблема
    if (problematicHops.length > 0) {
        log('\n💡 Рекомендации:', 'cyan');
        
        // Проверяем, в какой части пути проблема
        const midPoint = Math.floor(totalHops / 2);
        const earlyProblems = problematicHops.filter(h => h.hop <= midPoint);
        const lateProblems = problematicHops.filter(h => h.hop > midPoint);
        
        if (earlyProblems.length > 0) {
            log('  - Проблемы в начале пути (возможно, сеть Render.com или провайдер)', 'yellow');
        }
        if (lateProblems.length > 0) {
            log('  - Проблемы в конце пути (возможно, сеть RetailCRM)', 'yellow');
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
    
    log('\n🚀 Начинаю трассировку маршрута до RetailCRM серверов', 'bright');
    log('Это может занять несколько минут...\n', 'yellow');
    
    const results = {};
    
    for (const account of accounts) {
        try {
            log(`\n\n${'='.repeat(70)}`, 'bright');
            log(`📋 ${account.name}`, 'bright');
            log('='.repeat(70), 'bright');
            
            const result = await runTraceroute(account.hostname);
            results[account.name] = {
                success: true,
                result: result,
                hostname: account.hostname
            };
        } catch (error) {
            log(`\n❌ Не удалось выполнить трассировку до ${account.name}`, 'red');
            results[account.name] = {
                success: false,
                error: error.message,
                hostname: account.hostname
            };
        }
        
        // Пауза между трассировками
        if (account !== accounts[accounts.length - 1]) {
            log('\n⏳ Пауза 3 секунды перед следующей трассировкой...', 'yellow');
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    }
    
    // Итоговый отчет
    log('\n\n' + '='.repeat(70), 'bright');
    log('📋 ИТОГОВЫЙ ОТЧЕТ', 'bright');
    log('='.repeat(70), 'bright');
    
    for (const [accountName, result] of Object.entries(results)) {
        if (result.success) {
            log(`\n✅ ${accountName}: Трассировка выполнена успешно`, 'green');
        } else {
            log(`\n❌ ${accountName}: Ошибка - ${result.error}`, 'red');
        }
    }
    
    log('\n💡 Следующие шаги:', 'cyan');
    log('1. Сохраните результаты трассировки', 'reset');
    log('2. Проанализируйте проблемные узлы', 'reset');
    log('3. Отправьте результаты поддержке RetailCRM', 'reset');
    log('4. Удалите этот скрипт после использования (traceroute-test.js)', 'yellow');
}

// Запускаем
main().catch(error => {
    log(`\n❌ Критическая ошибка: ${error.message}`, 'red');
    process.exit(1);
});



# 🚀 Быстрый старт - RetailCRM → Telegram

## ⚡ За 5 минут к работающей интеграции

### 1️⃣ Установка зависимостей
```bash
npm install
```

### 2️⃣ Создание .env файла
```bash
cp env.example .env
```

### 3️⃣ Заполнение .env файла
```env
TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_CHANNEL_ID=@your_channel
RETAILCRM_URL=https://your-domain.retailcrm.ru
RETAILCRM_API_KEY=your_api_key
```

### 4️⃣ Тестирование
```bash
node test-integration.js
```

### 5️⃣ Запуск сервера
```bash
npm start
```

## 🔑 Что нужно получить

- **Telegram Bot Token** - от @BotFather
- **Channel ID** - username вашего канала
- **RetailCRM API Key** - из панели администратора
- **RetailCRM URL** - адрес вашего RetailCRM

## 📱 Результат

При аппруве заказа в RetailCRM → автоматическое уведомление в Telegram с полными данными заказа!

## ❓ Проблемы?

Смотрите подробное руководство в `README.md`

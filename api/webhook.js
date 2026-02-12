// api/webhook.js — исправленная версия
let responsesDB = [];
let mailingActive = false;
let mailingQueue = [];
let mailingStats = { sent: 0, failed: 0 };
let CONFIG = {
  vkToken: '',
  groupId: '',
  confirmation: 'c327af64',
  mode: 'normal',
  userToken: ''
};

// ========== ВАЖНО: парсим тело запроса вручную ==========
async function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        resolve({});
      }
    });
  });
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url = req.url;
  const method = req.method;

  // ----- ТЕСТОВЫЙ ENDPOINT (чтобы убедиться, что сервер работает) -----
  if (method === 'GET' && url === '/test') {
    return res.status(200).send('OK');
  }

  // ----- ВЕБХУК ДЛЯ VK -----
  if (method === 'POST' && url === '/webhook') {
    // Явно парсим тело запроса (VK присылает JSON)
    const body = await parseBody(req);
    console.log('Webhook body:', body);

    const { type, group_id } = body;

    // ПОДТВЕРЖДЕНИЕ СЕРВЕРА — ОБЯЗАТЕЛЬНО ОТПРАВЛЯЕМ ПРОСТО СТРОКУ
    if (type === 'confirmation') {
      console.log('Confirmation request, sending:', CONFIG.confirmation);
      return res.status(200).send(CONFIG.confirmation); // !!! НЕ res.json, а res.send !!!
    }

    // Проверка группы (если ID не совпадает — игнорируем)
    if (parseInt(group_id) !== parseInt(CONFIG.groupId)) {
      return res.status(200).json({ ok: true });
    }

    // Обработка нового сообщения
    if (type === 'message_new') {
      const object = body.object;
      if (object && object.message) {
        const { from_id, text, peer_id } = object.message;
        if (from_id > 0 && peer_id === from_id) {
          const lower = text.toLowerCase();
          const keywords = ['каталог','прайс','цены','интересно','да','хочу','подробнее','интересует'];
          const phoneRegex = /(?:\+7|8|7)[\s\-]?\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}/;
          const phoneMatch = lower.match(phoneRegex);
          
          if (keywords.some(k => lower.includes(k)) || phoneMatch) {
            responsesDB.push({
              userId: from_id,
              phone: phoneMatch ? phoneMatch[0].replace(/[^\d+]/g, '') : null,
              message: text,
              timestamp: new Date().toISOString()
            });
            // автоответ
            try {
              await sendVKMessage(from_id, 'Спасибо за интерес! Наш специалист свяжется с вами.');
            } catch (e) {}
          }
        }
      }
    }
    return res.status(200).json({ ok: true });
  }

  // ----- ВСЕ ОСТАЛЬНЫЕ API МАРШРУТЫ -----
  // (конфиг, старт, стоп, статус, ответы)
  // ... (код из предыдущей версии, можно оставить как есть)
  
  // Если ни один маршрут не подошёл
  res.status(404).json({ error: 'Not found' });
};

// Функция отправки сообщения (без изменений)
async function sendVKMessage(userId, text, isAutoReply = false) {
  const token = CONFIG.userToken || CONFIG.vkToken;
  const params = new URLSearchParams({
    access_token: token,
    v: '5.199',
    user_id: userId,
    message: text,
    random_id: Math.floor(Math.random() * 1e6)
  });
  if (!CONFIG.userToken && CONFIG.groupId) {
    params.append('group_id', CONFIG.groupId);
  }
  const res = await fetch('https://api.vk.com/method/messages.send', {
    method: 'POST',
    body: params
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.error_msg);
  return json;
}

// ... (остальные функции: processMailing, randomizeText)

// api/webhook.js — бэкенд для VK Callback API
let usersDB = [];
let responsesDB = [];
let mailingActive = false;
let mailingQueue = [];
let mailingStats = { sent: 0, failed: 0 };
let CONFIG = {
  vkToken: '',
  groupId: '',
  confirmation: '9eca19a0',
  mode: 'normal',
  userToken: '' // опционально: токен пользователя для обхода ограничений
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url = req.url;
  const method = req.method;

  // ============= ВЕБХУК ДЛЯ VK =============
  if (method === 'POST' && url === '/webhook') {
    const { type, group_id, object } = req.body;

    if (type === 'confirmation') {
      return res.send(CONFIG.confirmation);
    }

    if (parseInt(group_id) !== parseInt(CONFIG.groupId)) {
      return res.json({ ok: true });
    }

    if (type === 'message_new') {
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
          // Отправляем автоответ
          try {
            await sendVKMessage(from_id, 'Спасибо за интерес! Наш специалист свяжется с вами.');
          } catch (e) {}
        }
      }
    }
    return res.json({ ok: true });
  }

  // ============= API ДЛЯ ФРОНТЕНДА =============
  if (method === 'POST' && url === '/api/config') {
    CONFIG = { ...CONFIG, ...req.body };
    return res.json({ success: true });
  }

  if (method === 'GET' && url === '/api/config') {
    return res.json({ groupId: CONFIG.groupId, mode: CONFIG.mode });
  }

  if (method === 'POST' && url === '/api/start') {
    const { userIds, message, mode, token, groupId, confirmation, userToken } = req.body;
    CONFIG.vkToken = token;
    CONFIG.groupId = groupId;
    CONFIG.confirmation = confirmation;
    CONFIG.mode = mode;
    if (userToken) CONFIG.userToken = userToken;

    const ids = userIds.split('\n').map(s => s.trim()).filter(s => /^\d+$/.test(s));
    if (!ids.length) return res.json({ error: 'Нет валидных ID' });

    mailingActive = true;
    mailingQueue = ids;
    mailingStats = { sent: 0, failed: 0 };

    // Запускаем асинхронно
    processMailing(message);
    return res.json({ success: true, count: ids.length });
  }

  if (method === 'POST' && url === '/api/stop') {
    mailingActive = false;
    return res.json({ success: true });
  }

  if (method === 'GET' && url === '/api/status') {
    return res.json({
      mailingActive,
      queueLength: mailingQueue.length,
      stats: mailingStats,
      responsesCount: responsesDB.length
    });
  }

  if (method === 'GET' && url === '/api/responses') {
    return res.json(responsesDB);
  }

  if (method === 'DELETE' && url === '/api/responses') {
    responsesDB = [];
    return res.json({ success: true });
  }

  res.status(404).json({ error: 'Not found' });
};

// Функция отправки сообщения
async function sendVKMessage(userId, text, isAutoReply = false) {
  const token = CONFIG.userToken || CONFIG.vkToken;
  const params = new URLSearchParams({
    access_token: token,
    v: '5.199',
    user_id: userId,
    message: text,
    random_id: Math.floor(Math.random() * 1e6)
  });
  // Если используем токен группы, добавляем group_id
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

// Асинхронная рассылка
async function processMailing(message) {
  const delays = { slow: 5000, normal: 1000, fast: 200 };
  const delay = delays[CONFIG.mode] || 1000;

  while (mailingActive && mailingQueue.length) {
    const userId = mailingQueue.shift();
    try {
      await sendVKMessage(userId, randomizeText(message));
      mailingStats.sent++;
    } catch (e) {
      mailingStats.failed++;
    }
    await new Promise(r => setTimeout(r, delay));
  }
  mailingActive = false;
}

// Рандомизация текста
function randomizeText(text) {
  let result = text;
  const syn = {
    'здравствуйте': ['добрый день', 'приветствую'],
    'пишу': ['обращаюсь', 'сообщаю'],
    'мастерская': ['студия', 'компания'],
    'памятников': ['надгробий', 'мемориалов'],
    'скидка': ['специальное предложение', 'выгодные условия'],
    'бесплатная': ['без оплаты', 'не требующая оплаты'],
    'установка': ['монтаж', 'размещение'],
    'гарантия': ['обеспечение', 'страховка']
  };
  Object.keys(syn).forEach(word => {
    if (Math.random() < 0.3 && result.toLowerCase().includes(word)) {
      const repl = syn[word][Math.floor(Math.random() * syn[word].length)];
      const regex = new RegExp(word, 'gi');
      result = result.replace(regex, match =>
        match[0] === match[0].toUpperCase()
          ? repl.charAt(0).toUpperCase() + repl.slice(1)
          : repl
      );
    }
  });
  return result;
}

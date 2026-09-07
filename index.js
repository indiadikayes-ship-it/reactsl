import https from 'https';

const positiveReactions = ["👍", "❤", "🔥", "🥰", "👏", "😁", "🎉", "🤩", "🙏", "👌", "🕊", "😍", "🐳", "❤‍🔥", "🌭", "💯", "🤣", "⚡", "🍌", "🏆", "😘", "🍓", "🍾", "💋", "😇", "🤝", "✍", "🤗", "🫡", "🎅", "🎄", "☃", "🆒", "💘", "🦄", "😎"];
const negativeReactions = ["👎", "🤔", "🤯", "😱", "🤬", "😢", "🤮", "💩", "🤡", "🥱", "🥴", "💔", "🤨", "😐", "🖕", "😈", "😴", "😭", "😨", "🙈", "🙉", "🙊", "😡", "🗿"];
const allReactions = ["👍", "👎", "❤", "🔥", "🥰", "👏", "😁", "🤔", "🤯", "😱", "🤬", "😢", "🎉", "🤩", "🤮", "💩", "🙏", "👌", "🕊", "🤡", "🥱", "🥴", "😍", "🐳", "❤‍🔥", "🌚", "🌭", "💯", "🤣", "⚡", "🍌", "🏆", "💔", "🤨", "😐", "🍓", "🍾", "💋", "🖕", "😈", "😴", "😭", "🤓", "👻", "👨‍💻", "👀", "🎃", "🙈", "😇", "😨", "🤝", "✍", "🤗", "🫡", "🎅", "🎄", "☃", "💅", "🤪", "🗿", "🆒", "💘", "🙉", "🦄", "😘", "💊", "🙊", "😎", "👾", "🤷‍♂", "🤷", "🤷‍♀", "😡"];

function getRandomReaction(type) {
  let pool;
  if (type === 'positive') {
    pool = positiveReactions;
  } else if (type === 'negative') {
    pool = negativeReactions;
  } else {
    pool = allReactions;
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

function tryGetMessageId(token, chatId, offset = -1) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${token}/getUpdates?offset=${offset}&limit=100`,
      method: 'GET'
    };

    const request = https.request(options, (response) => {
      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result.ok && result.result.length > 0) {
            for (let i = result.result.length - 1; i >= 0; i--) {
              const update = result.result[i];
              const message = update.channel_post || update.message || update.edited_channel_post || update.edited_message;
              if (message && message.chat && message.chat.id.toString() === chatId.toString()) {
                resolve(message.message_id);
                return;
              }
            }
          }
          reject(new Error('No matching message found'));
        } catch (e) {
          reject(e);
        }
      });
    });

    request.on('error', reject);
    request.setTimeout(10000, () => {
      request.destroy();
      reject(new Error('Timeout'));
    });
    request.end();
  });
}

async function findMessageId(tokens, chatId) {
  for (const token of tokens) {
    try {
      const messageId = await tryGetMessageId(token, chatId, -1);
      return messageId;
    } catch (e) {
      continue;
    }
  }
  
  for (const token of tokens) {
    try {
      const messageId = await tryGetMessageId(token, chatId, 0);
      return messageId;
    } catch (e) {
      continue;
    }
  }
  
  throw new Error(`Could not find message in chat ${chatId}`);
}

function makeRequest(token, chatId, messageId, reaction) {
  return new Promise((resolve, reject) => {
    const payload = {
      chat_id: chatId,
      message_id: parseInt(messageId),
      reaction: [{ type: "emoji", emoji: reaction }],
      is_big: false
    };
    const postData = JSON.stringify(payload);
    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${token}/setMessageReaction`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const request = https.request(options, (response) => {
      let responseData = '';
      response.on('data', chunk => responseData += chunk);
      response.on('end', () => {
        try {
          resolve(JSON.parse(responseData));
        } catch (e) {
          resolve(responseData);
        }
      });
    });

    request.on('error', reject);
    request.setTimeout(10000, () => {
      request.destroy();
      reject(new Error('Request timeout'));
    });
    request.write(postData);
    request.end();
  });
}

export default async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const query = Object.fromEntries(url.searchParams);
  
  const tokens = query.token ? query.token.split(',').map(t => t.trim()) : [];
  const chatIds = query.chat ? query.chat.split(',').map(c => c.trim()) : [];
  let messageIds = query.message ? query.message.split(',').map(m => m.trim()) : [];
  const reactType = query.reaction || query.react || 'mix';

  if (!tokens.length) {
    return res.status(400).json({ error: 'No bot tokens provided' });
  }

  if (!chatIds.length) {
    return res.status(400).json({ error: 'No chat IDs provided' });
  }

  if (!['positive', 'negative', 'mix'].includes(reactType)) {
    return res.status(400).json({ error: 'Invalid reaction type. Use: positive, negative, or mix' });
  }

  if (!messageIds.length) {
    const chatMessageMap = new Map();
    
    for (const chatId of chatIds) {
      try {
        const messageId = await findMessageId(tokens, chatId);
        chatMessageMap.set(chatId, messageId.toString());
      } catch (error) {
        console.error(`Failed to find message for chat ${chatId}:`, error.message);
      }
    }
    
    if (chatMessageMap.size === 0) {
      return res.status(400).json({ 
        error: 'Could not find any messages in the specified chats',
        hint: 'Please provide message IDs manually using &message=123456 parameter'
      });
    }

    const usedReactions = new Map();
    const combinations = [];
    
    tokens.forEach(token => {
      chatMessageMap.forEach((messageId, chatId) => {
        const key = `${chatId}-${messageId}`;
        
        if (!usedReactions.has(key)) {
          usedReactions.set(key, new Set());
        }
        
        let reaction = getRandomReaction(reactType);
        const usedSet = usedReactions.get(key);
        let attempts = 0;
        const maxPool = reactType === 'positive' ? positiveReactions.length : 
                        reactType === 'negative' ? negativeReactions.length : allReactions.length;
        
        while (usedSet.has(reaction) && usedSet.size < maxPool && attempts < 100) {
          reaction = getRandomReaction(reactType);
          attempts++;
        }
        
        usedSet.add(reaction);
        combinations.push({ token, chatId, messageId, reaction });
      });
    });
    
    const results = await Promise.allSettled(
      combinations.map(combo => makeRequest(combo.token, combo.chatId, combo.messageId, combo.reaction))
    );

    const response = results.map((result, index) => ({
      token: combinations[index].token,
      chat_id: combinations[index].chatId,
      message_id: combinations[index].messageId,
      reaction: combinations[index].reaction,
      status: result.status,
      data: result.status === 'fulfilled' ? result.value : result.reason
    }));

    return res.status(200).json({ results: response });
  }

  const usedReactions = new Map();
  const combinations = [];
  
  tokens.forEach(token => {
    chatIds.forEach(chatId => {
      messageIds.forEach(messageId => {
        const key = `${chatId}-${messageId}`;
        if (!usedReactions.has(key)) {
          usedReactions.set(key, new Set());
        }
        
        let reaction = getRandomReaction(reactType);
        const usedSet = usedReactions.get(key);
        let attempts = 0;
        const maxPool = reactType === 'positive' ? positiveReactions.length : 
                        reactType === 'negative' ? negativeReactions.length : allReactions.length;
        
        while (usedSet.has(reaction) && usedSet.size < maxPool && attempts < 100) {
          reaction = getRandomReaction(reactType);
          attempts++;
        }
        
        usedSet.add(reaction);
        combinations.push({ token, chatId, messageId, reaction });
      });
    });
  });

  const results = await Promise.allSettled(
    combinations.map(combo => makeRequest(combo.token, combo.chatId, combo.messageId, combo.reaction))
  );

  const response = results.map((result, index) => ({
    token: combinations[index].token,
    chat_id: combinations[index].chatId,
    message_id: combinations[index].messageId,
    reaction: combinations[index].reaction,
    status: result.status,
    data: result.status === 'fulfilled' ? result.value : result.reason
  }));

  res.status(200).json({ results: response });
};

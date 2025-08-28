const axios = require('axios');

class TelegramNotifier {
  constructor(config) {
    this.botToken = config.botToken;
    this.chatId = config.chatId;
    this.baseUrl = `https://api.telegram.org/bot${this.botToken}`;
    this.messageQueue = [];
    this.isProcessingQueue = false;
    this.rateLimitDelay = 1000; // 1 second between messages to avoid rate limits
  }

  // Send message with rate limiting
  async sendMessage(text, parseMode = undefined) {
    return new Promise((resolve, reject) => {
      this.messageQueue.push({ text, parseMode, resolve, reject });
      this.processQueue();
    });
  }

  // Process message queue to avoid rate limits
  async processQueue() {
    if (this.isProcessingQueue || this.messageQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;

    while (this.messageQueue.length > 0) {
      const { text, parseMode, resolve, reject } = this.messageQueue.shift();

      try {
        const result = await this.sendMessageDirect(text, parseMode);
        resolve(result);
      } catch (error) {
        reject(error);
      }

      // Wait before sending next message
      if (this.messageQueue.length > 0) {
        await this.delay(this.rateLimitDelay);
      }
    }

    this.isProcessingQueue = false;
  }

  // Direct message sending (internal use)
  async sendMessageDirect(text, parseMode = undefined) {
    try {
      // Split long messages
      const chunks = this.splitMessage(text);
      const results = [];

      for (const chunk of chunks) {
        const payload = {
          chat_id: this.chatId,
          text: chunk,
          disable_web_page_preview: true
        };
        
        // Only add parse_mode if it's defined
        if (parseMode) {
          payload.parse_mode = parseMode;
        }
        
        const response = await axios.post(`${this.baseUrl}/sendMessage`, payload, {
          timeout: 10000
        });

        results.push(response.data);

        // Small delay between chunks
        if (chunks.length > 1) {
          await this.delay(500);
        }
      }

      return results.length === 1 ? results[0] : results;

    } catch (error) {
      const errorMsg = error.response?.data?.description || error.message;
      console.error('❌ Telegram send error:', errorMsg);
      
      // Handle specific Telegram errors
      if (error.response?.data?.error_code === 429) {
        // Rate limited - wait and retry
        const retryAfter = error.response.data.parameters?.retry_after || 60;
        console.log(`⏳ Rate limited. Retrying after ${retryAfter} seconds...`);
        await this.delay(retryAfter * 1000);
        return this.sendMessageDirect(text, parseMode);
      }
      
      throw new Error(`Telegram API Error: ${errorMsg}`);
    }
  }

  // Split long messages into chunks
  splitMessage(text, maxLength = 4096) {
    if (text.length <= maxLength) {
      return [text];
    }

    const chunks = [];
    let currentChunk = '';

    const lines = text.split('\n');

    for (const line of lines) {
      if ((currentChunk + line + '\n').length > maxLength) {
        if (currentChunk.length > 0) {
          chunks.push(currentChunk.trim());
          currentChunk = '';
        }

        // If single line is too long, split it
        if (line.length > maxLength) {
          const words = line.split(' ');
          let wordChunk = '';

          for (const word of words) {
            if ((wordChunk + word + ' ').length > maxLength) {
              if (wordChunk.length > 0) {
                chunks.push(wordChunk.trim());
                wordChunk = '';
              }
              
              // If single word is too long, truncate it
              if (word.length > maxLength) {
                chunks.push(word.substring(0, maxLength - 3) + '...');
              } else {
                wordChunk = word + ' ';
              }
            } else {
              wordChunk += word + ' ';
            }
          }

          if (wordChunk.length > 0) {
            currentChunk = wordChunk;
          }
        } else {
          currentChunk = line + '\n';
        }
      } else {
        currentChunk += line + '\n';
      }
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }

  // Send formatted message with markdown
  async sendMarkdownMessage(text) {
    return this.sendMessage(text, 'Markdown');
  }

  // Send formatted message with HTML
  async sendHTMLMessage(text) {
    return this.sendMessage(text, 'HTML');
  }

  // Test connection
  async testConnection() {
    try {
      const response = await axios.get(`${this.baseUrl}/getMe`, {
        timeout: 5000
      });

      if (response.data.ok) {
        console.log(`✅ Telegram bot connected: ${response.data.result.first_name} (@${response.data.result.username})`);
        return true;
      } else {
        throw new Error('Bot token invalid');
      }
    } catch (error) {
      console.error('❌ Telegram connection failed:', error.response?.data?.description || error.message);
      throw error;
    }
  }

  // Get chat info
  async getChatInfo() {
    try {
      const response = await axios.post(`${this.baseUrl}/getChat`, {
        chat_id: this.chatId
      });

      return response.data.result;
    } catch (error) {
      throw new Error(`Failed to get chat info: ${error.response?.data?.description || error.message}`);
    }
  }

  // Send photo with caption
  async sendPhoto(photoUrl, caption = '') {
    try {
      const response = await axios.post(`${this.baseUrl}/sendPhoto`, {
        chat_id: this.chatId,
        photo: photoUrl,
        caption: caption,
        disable_web_page_preview: true
      });

      return response.data;
    } catch (error) {
      throw new Error(`Failed to send photo: ${error.response?.data?.description || error.message}`);
    }
  }

  // Utility function for delays
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Format number with proper decimals
  static formatNumber(num, decimals = 4) {
    if (typeof num !== 'number') {
      return 'N/A';
    }
    return num.toFixed(decimals);
  }

  // Format currency
  static formatCurrency(num, symbol = '$') {
    if (typeof num !== 'number') {
      return 'sN/A';
    }
    return `${symbol}${num.toFixed(2)}`;
  }

  // Format percentage
  static formatPercentage(num) {
    if (typeof num !== 'number') {
      return 'N/A';
    }
    return `${(num * 100).toFixed(2)}%`;
  }

  // Create progress bar
  static createProgressBar(percentage, length = 10) {
    const filled = Math.round((percentage / 100) * length);
    const empty = length - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
  }
}

module.exports = TelegramNotifier;

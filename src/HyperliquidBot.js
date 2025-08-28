const axios = require('axios');
const TelegramNotifier = require('./TelegramNotifier');

class HyperliquidBot {
  constructor(config) {
    this.config = config;
    this.signalProviderPositions = new Map();
    this.isRunning = false;
    this.telegram = new TelegramNotifier(config.telegram);
    this.pollInterval = null;
    this.errorCount = 0;
    this.maxErrors = 10; // Stop after too many consecutive errors
  }

  async start() {
    console.log('🤖 Initializing Hyperliquid Bot...');
    this.isRunning = true;
    
    try {
      // Test Telegram connection
      await this.telegram.sendMessage('🚀 Hyperliquid Copy Trading Monitor Started!\n\n' +
        `📊 Monitoring: ${this.config.signalProviderAddress.slice(0, 6)}...${this.config.signalProviderAddress.slice(-4)}\n` +
        `⏰ Poll Interval: ${this.config.pollInterval / 1000}s\n` +
        `💰 Position Sizing: ${this.config.sizingMethod} (${this.config.accountRatio}x)\n` +
        `📏 Max Position Size: ${this.config.maxPositionSize}`);
      
      console.log('✅ Telegram connection established');
      
      // Initial position fetch
      await this.loadInitialPositions();
      
      // Start monitoring loop
      this.startMonitoring();
      
    } catch (error) {
      console.error('❌ Failed to start bot:', error.message);
      throw error;
    }
  }

  async loadInitialPositions() {
    try {
      console.log('📊 Loading initial positions...');
      const positions = await this.getPositions(this.config.signalProviderAddress);
      
      // Filter out zero positions and update tracking
      let activePositions = 0;
      for (const position of positions) {
        if (position.position && parseFloat(position.position.szi) !== 0) {
          this.signalProviderPositions.set(position.position.coin, position);
          activePositions++;
        }
      }
      
      console.log(`✅ Found ${activePositions} active positions`);
      
      if (activePositions > 0) {
        await this.sendPositionsSummary();
      } else {
        await this.telegram.sendMessage('📊 No active positions found. Monitoring for new trades...');
      }
      
    } catch (error) {
      console.error('❌ Error loading initial positions:', error.message);
      await this.telegram.sendMessage(`❌ Error loading initial positions: ${error.message}`);
      throw error;
    }
  }

  startMonitoring() {
    console.log(`⏰ Starting monitoring loop (${this.config.pollInterval}ms interval)`);
    
    this.pollInterval = setInterval(async () => {
      if (this.isRunning) {
        try {
          await this.checkForPositionChanges();
          this.errorCount = 0; // Reset error count on success
        } catch (error) {
          this.errorCount++;
          console.error(`❌ Monitor error (${this.errorCount}/${this.maxErrors}):`, error.message);
          
          if (this.errorCount >= this.maxErrors) {
            await this.telegram.sendMessage(`🛑 Too many consecutive errors (${this.maxErrors}). Stopping bot.`);
            await this.stop();
          }
        }
      }
    }, this.config.pollInterval);
  }

  async getPositions(address) {
    try {
      const response = await axios.post('https://api.hyperliquid.xyz/info', {
        type: 'clearinghouseState',
        user: address
      }, {
        timeout: 10000, // 10 second timeout
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.data || !response.data.assetPositions) {
        throw new Error('Invalid response format from Hyperliquid API');
      }

      return response.data.assetPositions;
    } catch (error) {
      if (error.code === 'ECONNABORTED') {
        throw new Error('Request timeout - Hyperliquid API may be slow');
      }
      throw new Error(`API Error: ${error.response?.data?.message || error.message}`);
    }
  }

  async checkForPositionChanges() {
    const currentPositions = await this.getPositions(this.config.signalProviderAddress);
    
    // Create map of current positions (excluding zero positions)
    const currentPositionsMap = new Map();
    for (const pos of currentPositions) {
      if (pos.position && parseFloat(pos.position.szi) !== 0) {
        currentPositionsMap.set(pos.position.coin, pos);
      }
    }

    // Check for new or modified positions
    for (const [coin, newPosition] of currentPositionsMap) {
      const oldPosition = this.signalProviderPositions.get(coin);

      if (!oldPosition) {
        await this.handleNewPosition(newPosition);
      } else if (this.hasPositionChanged(oldPosition, newPosition)) {
        await this.handlePositionChange(oldPosition, newPosition);
      }
    }

    // Check for closed positions
    for (const [coin, oldPosition] of this.signalProviderPositions) {
      if (!currentPositionsMap.has(coin)) {
        await this.handlePositionClosed(oldPosition);
      }
    }

    // Update tracking
    this.signalProviderPositions = currentPositionsMap;
  }

  hasPositionChanged(oldPos, newPos) {
    const oldSize = parseFloat(oldPos.position.szi);
    const newSize = parseFloat(newPos.position.szi);
    const threshold = 0.001;
    return Math.abs(oldSize - newSize) > threshold;
  }

  async handleNewPosition(position) {
    const coin = position.position.coin;
    const size = parseFloat(position.position.szi);
    const isLong = size > 0;
    const pnl = parseFloat(position.position.unrealizedPnl || 0);
    const entryPrice = parseFloat(position.position.entryPx || 0);

    console.log(`🆕 New position: ${coin} ${isLong ? 'LONG' : 'SHORT'} ${Math.abs(size)}`);

    const message = `🆕 NEW POSITION OPENED\n\n` +
      `💰 Coin: ${coin}\n` +
      `📊 Side: ${isLong ? '🟢 LONG' : '🔴 SHORT'}\n` +
      `📏 Size: ${Math.abs(size).toFixed(4)}\n` +
      `💵 Entry: $${entryPrice.toFixed(4)}\n` +
      `📈 Unrealized PnL: $${pnl.toFixed(2)}\n` +
      `⏰ Time: ${new Date().toLocaleString()}`;

    await this.telegram.sendMessage(message);
    await this.sendCopyTradeInfo(coin, size, 'OPEN');
  }

  async handlePositionChange(oldPos, newPos) {
    const coin = newPos.position.coin;
    const oldSize = parseFloat(oldPos.position.szi);
    const newSize = parseFloat(newPos.position.szi);
    const sizeDiff = newSize - oldSize;
    const pnl = parseFloat(newPos.position.unrealizedPnl || 0);
    const currentPrice = parseFloat(newPos.position.markPx || 0);

    console.log(`🔄 Position change: ${coin} ${oldSize} → ${newSize}`);

    const message = `🔄 POSITION MODIFIED\n\n` +
      `💰 Coin: ${coin}\n` +
      `📊 Old Size: ${oldSize.toFixed(4)}\n` +
      `📊 New Size: ${newSize.toFixed(4)}\n` +
      `📈 Change: ${sizeDiff > 0 ? '⬆️' : '⬇️'} ${Math.abs(sizeDiff).toFixed(4)}\n` +
      `💵 Mark Price: $${currentPrice.toFixed(4)}\n` +
      `📈 Unrealized PnL: $${pnl.toFixed(2)}\n` +
      `⏰ Time: ${new Date().toLocaleString()}`;

    await this.telegram.sendMessage(message);
    await this.sendCopyTradeInfo(coin, sizeDiff, sizeDiff > 0 ? 'INCREASE' : 'DECREASE');
  }

  async handlePositionClosed(position) {
    const coin = position.position.coin;
    const size = parseFloat(position.position.szi);

    console.log(`❌ Position closed: ${coin} ${size}`);

    const message = `❌ POSITION CLOSED\n\n` +
      `💰 Coin: ${coin}\n` +
      `📊 Size: ${Math.abs(size).toFixed(4)}\n` +
      `📊 Side: ${size > 0 ? '🟢 LONG' : '🔴 SHORT'}\n` +
      `⏰ Time: ${new Date().toLocaleString()}`;

    await this.telegram.sendMessage(message);
    await this.sendCopyTradeInfo(coin, -size, 'CLOSE');
  }

  async sendCopyTradeInfo(coin, signalSize, action) {
    const mySize = this.calculatePositionSize(signalSize);
    const currentPrice = await this.getCurrentPrice(coin);
    
    const message = `📋 COPY TRADE INFO\n\n` +
      `🔧 Action: ${action}\n` +
      `💰 Coin: ${coin}\n` +
      `📊 Signal Size: ${signalSize.toFixed(4)}\n` +
      `📊 Your Size: ${mySize.toFixed(4)}\n` +
      `💵 Current Price: $${currentPrice || 'N/A'}\n` +
      `📐 Method: ${this.config.sizingMethod}\n` +
      `📊 Ratio: ${this.config.accountRatio}x\n\n` +
      `💡 Manual Command:\n` +
      `${mySize > 0 ? 'BUY' : 'SELL'} ${Math.abs(mySize).toFixed(4)} ${coin}`;

    await this.telegram.sendMessage(message);
  }

  async sendPositionsSummary() {
    if (this.signalProviderPositions.size === 0) {
      await this.telegram.sendMessage('📊 No active positions found');
      return;
    }

    let message = `📊 CURRENT POSITIONS (${this.signalProviderPositions.size})\n\n`;
    let totalPnl = 0;

    for (const [coin, position] of this.signalProviderPositions) {
      const size = parseFloat(position.position.szi);
      const pnl = parseFloat(position.position.unrealizedPnl || 0);
      const entryPrice = parseFloat(position.position.entryPx || 0);
      const markPrice = parseFloat(position.position.markPx || 0);
      
      totalPnl += pnl;
      
      message += `💰 ${coin}\n`;
      message += `   📊 ${size > 0 ? '🟢 LONG' : '🔴 SHORT'} ${Math.abs(size).toFixed(4)}\n`;
      message += `   💵 Entry: $${entryPrice.toFixed(4)}\n`;
      message += `   💵 Mark: $${markPrice.toFixed(4)}\n`;
      message += `   📈 PnL: $${pnl.toFixed(2)}\n\n`;
    }

    message += `💰 Total Unrealized PnL: $${totalPnl.toFixed(2)}`;
    await this.telegram.sendMessage(message);
  }

  calculatePositionSize(signalSize) {
    const { sizingMethod, maxPositionSize, accountRatio } = this.config;
    let mySize = 0;

    switch (sizingMethod) {
      case 'fixed_ratio':
        mySize = signalSize * accountRatio;
        break;
      case 'fixed_size':
        mySize = Math.sign(signalSize) * (this.config.fixedSize || 1);
        break;
      case 'percentage':
        mySize = signalSize * (this.config.percentageMultiplier || 1);
        break;
    }

    if (maxPositionSize && Math.abs(mySize) > maxPositionSize) {
      mySize = Math.sign(mySize) * maxPositionSize;
    }

    return mySize;
  }

  async getCurrentPrice(coin) {
    try {
      const response = await axios.post('https://api.hyperliquid.xyz/info', {
        type: 'l2Book',
        coin: coin
      }, { timeout: 5000 });

      const book = response.data;
      if (book.levels && book.levels.length > 0) {
        const bestBid = parseFloat(book.levels[0][0]);
        const bestAsk = parseFloat(book.levels[0][2]);
        return ((bestBid + bestAsk) / 2).toFixed(4);
      }
    } catch (error) {
      console.error(`Error getting price for ${coin}:`, error.message);
    }
    return null;
  }

  async stop() {
    console.log('🛑 Stopping Hyperliquid Bot...');
    this.isRunning = false;
    
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    
    try {
      await this.telegram.sendMessage('⏹️ Hyperliquid Monitor Stopped');
    } catch (error) {
      console.error('Error sending stop message:', error.message);
    }
    
    console.log('✅ Bot stopped successfully');
  }
}

module.exports = HyperliquidBot;
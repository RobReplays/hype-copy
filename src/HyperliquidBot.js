const axios = require('axios');
const { spawn } = require('child_process');
const path = require('path');
const { ethers } = require('ethers');
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

  async getMarketPrices() {
    try {
      const response = await axios.post('https://api.hyperliquid.xyz/info', {
        type: 'metaAndAssetCtxs'
      }, {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const [meta, assetCtxs] = response.data;
      const priceMap = new Map();
      
      meta.universe.forEach((asset, index) => {
        if (assetCtxs[index]) {
          priceMap.set(asset.name, parseFloat(assetCtxs[index].markPx || 0));
        }
      });
      
      return priceMap;
    } catch (error) {
      console.error('Failed to fetch market prices:', error.message);
      return new Map();
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

    // Check for new positions only (ignore modifications to prevent scaling issues)
    for (const [coin, newPosition] of currentPositionsMap) {
      const oldPosition = this.signalProviderPositions.get(coin);

      if (!oldPosition) {
        // Only copy NEW positions - prevents scaling in issues
        await this.handleNewPosition(newPosition);
      } else if (this.hasPositionChanged(oldPosition, newPosition)) {
        // Log but don't copy position modifications 
        const oldSize = parseFloat(oldPosition.position.szi);
        const newSize = parseFloat(newPosition.position.szi);
        const sizeDiff = newSize - oldSize;
        
        console.log(`🔄 Position modified (not copied): ${coin} ${oldSize} → ${newSize} (${sizeDiff > 0 ? '+' : ''}${sizeDiff.toFixed(4)})`);
        
        // Send notification but don't execute trade
        const message = `🔄 SIGNAL PROVIDER MODIFIED POSITION\n\n` +
          `💰 Coin: ${coin}\n` +
          `📊 Old Size: ${oldSize.toFixed(4)}\n` +
          `📊 New Size: ${newSize.toFixed(4)}\n` +
          `📈 Change: ${sizeDiff > 0 ? '⬆️' : '⬇️'} ${Math.abs(sizeDiff).toFixed(4)}\n` +
          `⚠️ Position scaling - not copied\n` +
          `⏰ Time: ${new Date().toLocaleString()}`;
        
        await this.telegram.sendMessage(message);
      }
    }

    // Check for closed positions (still copy closes)
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
    
    // Get current price properly - markPx is often 0 for new positions
    let currentPrice = parseFloat(position.position.markPx || 0);
    if (currentPrice === 0 || !currentPrice) {
      // If mark price is 0, try to fetch it or use entry price
      const fetchedPrice = await this.getCurrentPrice(coin);
      currentPrice = fetchedPrice !== 'N/A' ? parseFloat(fetchedPrice) : entryPrice;
    }

    console.log(`🆕 New position: ${coin} ${isLong ? 'LONG' : 'SHORT'} ${Math.abs(size)}`);

    const message = `🆕 SIGNAL PROVIDER OPENED POSITION\n\n` +
      `💰 Coin: ${coin}\n` +
      `📊 Side: ${isLong ? '🟢 LONG' : '🔴 SHORT'}\n` +
      `📏 Size: ${Math.abs(size).toFixed(4)}\n` +
      `💵 Entry: $${entryPrice.toFixed(4)}\n` +
      `📍 Current: $${currentPrice.toFixed(4)}\n` +
      `📊 Position Value: $${(Math.abs(size) * currentPrice).toFixed(2)}\n` +
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
    
    // Get current price properly
    let currentPrice = parseFloat(newPos.position.markPx || 0);
    if (currentPrice === 0 || !currentPrice) {
      const fetchedPrice = await this.getCurrentPrice(coin);
      currentPrice = fetchedPrice !== 'N/A' ? parseFloat(fetchedPrice) : parseFloat(newPos.position.entryPx || 0);
    }

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

  async executeTrade(coin, signalSize, action) {
    console.log(`🔄 Executing trade: ${action} ${coin} (signal: ${signalSize})`);
    
    try {
      // Call Python trade executor
      const pythonScript = path.join(__dirname, 'trade_executor.py');
      const pythonProcess = spawn('python3', [
        pythonScript,
        coin,
        signalSize.toString(),
        action
      ]);

      let output = '';
      let errorOutput = '';

      pythonProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      pythonProcess.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      return new Promise((resolve) => {
        pythonProcess.on('close', (code) => {
          try {
            // Clean output by finding the JSON part
            const jsonMatch = output.match(/\{[\s\S]*\}$/);
            if (!jsonMatch) {
              throw new Error('No JSON found in output');
            }
            
            const result = JSON.parse(jsonMatch[0]);
            if (code === 0 || result.success) {
              console.log('✅ Trade executed successfully:', result);
              resolve({ success: true, ...result });
            } else {
              console.error('❌ Trade failed:', result);
              resolve({ success: false, ...result });
            }
          } catch (parseError) {
            console.error('❌ Failed to parse trade result:', output, errorOutput);
            resolve({ 
              success: false, 
              error: `Parse error: ${parseError.message}`,
              raw_output: output,
              raw_error: errorOutput 
            });
          }
        });
      });
    } catch (error) {
      console.error('❌ Error executing trade:', error.message);
      return { success: false, error: error.message };
    }
  }

  async sendCopyTradeInfo(coin, signalSize, action) {
    // Auto-execute trades
    const executeTradesAutomatically = process.env.AUTO_EXECUTE_TRADES === 'true';
    
    if (executeTradesAutomatically) {
      console.log('🤖 Auto-executing trade...');
      const tradeResult = await this.executeTrade(coin, signalSize, action);
      
      if (tradeResult.success) {
        // Send success message with trade details
        const message = `✅ TRADE EXECUTED AUTOMATICALLY\n\n` +
          `🔧 Action: ${action}\n` +
          `💰 Coin: ${coin}\n` +
          `📊 Signal Size: ${signalSize.toFixed(4)}\n` +
          `📊 Executed Size: ${parseFloat(tradeResult.filled_size || 0).toFixed(4)}\n` +
          `💵 Fill Price: $${parseFloat(tradeResult.avg_price || 0).toFixed(4)}\n` +
          `💰 Order Value: $${parseFloat(tradeResult.order_value || 0).toFixed(2)}\n` +
          `🆔 Order ID: ${tradeResult.order_id || 'N/A'}\n` +
          `⏰ Time: ${new Date().toLocaleString()}`;
        
        await this.telegram.sendMessage(message);
        
        // Wait a moment for position to update, then send YOUR position breakdown
        setTimeout(async () => {
          await this.sendMyPositionUpdate(coin);
        }, 2000);
        
      } else {
        // Trade failed, send error only
        let errorMessage = `❌ AUTO-TRADE FAILED\n\n` +
          `🔧 Action: ${action}\n` +
          `💰 Coin: ${coin}\n` +
          `📊 Signal Size: ${signalSize.toFixed(4)}\n` +
          `❌ Error: ${tradeResult.error}`;
        
        if (tradeResult.skipped) {
          errorMessage += `\n⚠️ Trade skipped (order too small)`;
        }
        
        await this.telegram.sendMessage(errorMessage);
      }
    } else {
      // Auto-execute is disabled
      await this.telegram.sendMessage(
        `⚠️ AUTO-EXECUTION DISABLED\n\n` +
        `Set AUTO_EXECUTE_TRADES=true to enable automatic trading`
      );
    }
  }

  async sendMyPositionUpdate(specificCoin = null) {
    console.log(`📊 Fetching your ${specificCoin || 'current'} position(s)...`);
    
    try {
      // Get your wallet address from private key
      const wallet = new ethers.Wallet(process.env.PRIVATE_KEY);
      
      // Fetch your positions using the API
      const response = await axios.post('https://api.hyperliquid.xyz/info', {
        type: 'clearinghouseState',
        user: wallet.address
      });

      if (!response.data || !response.data.assetPositions) {
        return;
      }

      const positions = response.data.assetPositions;
      const accountValue = parseFloat(response.data.marginSummary?.accountValue || 0);
      const withdrawable = parseFloat(response.data.withdrawable || 0);
      
      // If specific coin requested, only show that
      if (specificCoin) {
        const position = positions.find(p => p.position && p.position.coin === specificCoin);
        
        if (!position || parseFloat(position.position.szi) === 0) {
          await this.telegram.sendMessage(
            `📊 YOUR ${specificCoin} POSITION\n\n` +
            `❌ Position closed or not found\n` +
            `💰 Account Balance: $${accountValue.toFixed(2)}\n` +
            `💳 Available: $${withdrawable.toFixed(2)}`
          );
          return;
        }
        
        const size = parseFloat(position.position.szi);
        const entryPrice = parseFloat(position.position.entryPx || 0);
        const markPrice = parseFloat(position.position.markPx || 0);
        const pnl = parseFloat(position.position.unrealizedPnl || 0);
        const margin = parseFloat(position.position.marginUsed || 0);
        
        const message = `📊 YOUR ${specificCoin} POSITION\n\n` +
          `📈 Status: ${size > 0 ? '🟢 LONG' : '🔴 SHORT'}\n` +
          `📏 Size: ${Math.abs(size).toFixed(6)} ${specificCoin}\n` +
          `💵 Entry Price: $${entryPrice.toFixed(4)}\n` +
          `📍 Current Price: $${markPrice.toFixed(4)}\n` +
          `📊 Position Value: $${(Math.abs(size) * markPrice).toFixed(2)}\n` +
          `💰 Unrealized PnL: ${pnl >= 0 ? '✅' : '❌'} $${pnl.toFixed(2)}\n` +
          `📈 Return: ${((pnl / (Math.abs(size) * entryPrice)) * 100).toFixed(2)}%\n` +
          `💳 Margin Used: $${margin.toFixed(2)}\n\n` +
          `💰 Account Balance: $${accountValue.toFixed(2)}\n` +
          `💳 Available: $${withdrawable.toFixed(2)}`;
        
        await this.telegram.sendMessage(message);
        
      } else {
        // Show all positions
        await this.sendMyPositions();
      }
      
    } catch (error) {
      console.error('❌ Error fetching position update:', error.message);
    }
  }

  async sendMyPositions() {
    console.log('📊 Fetching your current positions...');
    
    try {
      // Call Python script to get your positions
      const pythonScript = path.join(__dirname, 'trade_executor.py');
      const pythonProcess = spawn('python3', [
        pythonScript,
        'SOL', '0', 'OPEN', '--dry-run'  // Dummy call to initialize executor and get balance
      ]);

      let output = '';
      pythonProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      return new Promise(async (resolve) => {
        pythonProcess.on('close', async (code) => {
          try {
            // Get your wallet address from private key
            const wallet = new ethers.Wallet(process.env.PRIVATE_KEY);
            
            // Fetch your positions using the API
            const response = await axios.post('https://api.hyperliquid.xyz/info', {
              type: 'clearinghouseState',
              user: wallet.address
            });

            if (!response.data || !response.data.assetPositions) {
              await this.telegram.sendMessage('📭 No positions data found for your account');
              resolve();
              return;
            }

            const positions = response.data.assetPositions;
            const activePositions = positions.filter(p => p.position && parseFloat(p.position.szi) !== 0);
            
            if (activePositions.length === 0) {
              const accountValue = parseFloat(response.data.marginSummary?.accountValue || 0);
              await this.telegram.sendMessage(`📭 No active positions\n💰 Account Balance: $${accountValue.toFixed(2)}`);
              resolve();
              return;
            }

            // Build positions message
            let message = `📊 YOUR POSITIONS (${activePositions.length})\n\n`;
            let totalPnl = 0;
            const accountValue = parseFloat(response.data.marginSummary?.accountValue || 0);

            activePositions.forEach(pos => {
              const coin = pos.position.coin;
              const size = parseFloat(pos.position.szi);
              const entryPrice = parseFloat(pos.position.entryPx || 0);
              const markPrice = parseFloat(pos.position.markPx || 0);
              const pnl = parseFloat(pos.position.unrealizedPnl || 0);
              totalPnl += pnl;
              
              message += `💰 ${coin}\n`;
              message += `   📊 ${size > 0 ? '🟢 LONG' : '🔴 SHORT'} ${Math.abs(size).toFixed(4)}\n`;
              message += `   💵 Entry: $${entryPrice.toFixed(4)}\n`;
              message += `   💵 Mark: $${markPrice.toFixed(4)}\n`;
              message += `   📈 PnL: $${pnl.toFixed(2)}\n\n`;
            });

            message += `💰 Total PnL: $${totalPnl.toFixed(2)}\n`;
            message += `💳 Account Value: $${accountValue.toFixed(2)}`;

            await this.telegram.sendMessage(message);
            resolve();
            
          } catch (error) {
            console.error('❌ Error fetching your positions:', error.message);
            await this.telegram.sendMessage(`❌ Error fetching your positions: ${error.message}`);
            resolve();
          }
        });
      });
      
    } catch (error) {
      console.error('❌ Error getting positions:', error.message);
      await this.telegram.sendMessage(`❌ Error getting positions: ${error.message}`);
    }
  }

  async sendPositionsSummary() {
    if (this.signalProviderPositions.size === 0) {
      await this.telegram.sendMessage('📊 No active signal provider positions found');
      return;
    }

    // Fetch current market prices
    const marketPrices = await this.getMarketPrices();

    let message = `📊 SIGNAL PROVIDER POSITIONS (${this.signalProviderPositions.size})\n\n`;
    let totalPnl = 0;

    for (const [coin, position] of this.signalProviderPositions) {
      const size = parseFloat(position.position.szi);
      const pnl = parseFloat(position.position.unrealizedPnl || 0);
      const entryPrice = parseFloat(position.position.entryPx || 0);
      // Try to get mark price from market data, fallback to position data
      const markPrice = marketPrices.get(coin) || parseFloat(position.position.markPx || 0);
      
      totalPnl += pnl;
      
      message += `💰 ${coin}\n`;
      message += `   📊 ${size > 0 ? '🟢 LONG' : '🔴 SHORT'} ${Math.abs(size).toFixed(4)}\n`;
      message += `   💵 Entry: $${entryPrice.toFixed(4)}\n`;
      message += `   💵 Mark: $${markPrice.toFixed(4)}\n`;
      message += `   📈 PnL: $${pnl.toFixed(2)}\n\n`;
    }

    message += `💰 Signal Total PnL: $${totalPnl.toFixed(2)}\n\n`;
    message += `📱 Checking your positions...`;
    await this.telegram.sendMessage(message);
    
    // Also send your positions
    await this.sendMyPositions();
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
      // First try to get from all mids (more reliable)
      const midsResponse = await axios.post('https://api.hyperliquid.xyz/info', {
        type: 'allMids'
      }, { timeout: 5000 });
      
      if (midsResponse.data && midsResponse.data[coin]) {
        return parseFloat(midsResponse.data[coin]).toFixed(4);
      }
      
      // Fallback to l2Book if not found in mids
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
    return 'N/A';
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
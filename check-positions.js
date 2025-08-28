require('dotenv').config();
const axios = require('axios');
const TelegramNotifier = require('./src/TelegramNotifier');

async function checkCurrentPositions() {
  console.log('📊 Fetching current positions...\n');
  
  const signalProviderAddress = process.env.SIGNAL_PROVIDER_ADDRESS;
  const telegram = new TelegramNotifier({
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID
  });

  try {
    // Fetch positions from Hyperliquid API
    const response = await axios.post('https://api.hyperliquid.xyz/info', {
      type: 'clearinghouseState',
      user: signalProviderAddress
    }, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });

    if (!response.data || !response.data.assetPositions) {
      throw new Error('Invalid response from API');
    }

    const positions = response.data.assetPositions;
    const activePositions = positions.filter(p => p.position && parseFloat(p.position.szi) !== 0);
    
    console.log(`Found ${activePositions.length} active positions\n`);
    
    // Fetch market prices
    const priceResponse = await axios.post('https://api.hyperliquid.xyz/info', {
      type: 'metaAndAssetCtxs'
    });
    
    const [meta, assetCtxs] = priceResponse.data;
    const marketPrices = new Map();
    
    meta.universe.forEach((asset, index) => {
      if (assetCtxs[index]) {
        marketPrices.set(asset.name, parseFloat(assetCtxs[index].markPx || 0));
      }
    });

    // Build detailed message
    let message = `📊 **CURRENT POSITIONS UPDATE**\n`;
    message += `👤 Signal Provider: \`${signalProviderAddress.slice(0, 6)}...${signalProviderAddress.slice(-4)}\`\n`;
    message += `⏰ Time: ${new Date().toLocaleString()}\n`;
    message += `━━━━━━━━━━━━━━━━━━━\n\n`;

    if (activePositions.length === 0) {
      message += `📭 No active positions\n`;
      message += `All positions are currently closed.\n`;
    } else {
      message += `📈 **Active Positions: ${activePositions.length}**\n\n`;
      
      let totalUnrealizedPnl = 0;
      let positionDetails = [];

      activePositions.forEach((pos, index) => {
        const coin = pos.position.coin;
        const size = parseFloat(pos.position.szi);
        const entryPrice = parseFloat(pos.position.entryPx || 0);
        const markPrice = marketPrices.get(coin) || parseFloat(pos.position.markPx || 0);
        const unrealizedPnl = parseFloat(pos.position.unrealizedPnl || 0);
        const returnOnEquity = parseFloat(pos.position.returnOnEquity || 0);
        const leverage = pos.position.leverage ? parseFloat(pos.position.leverage.value || 1) : 1;
        
        totalUnrealizedPnl += unrealizedPnl;
        
        const isLong = size > 0;
        const direction = isLong ? '🟢 LONG' : '🔴 SHORT';
        const pnlEmoji = unrealizedPnl >= 0 ? '✅' : '❌';
        
        // Calculate your position (10% of signal)
        const yourSize = Math.abs(size * 0.1);
        const cappedSize = Math.min(yourSize, 10); // Cap at $10
        
        positionDetails.push({
          coin,
          size: Math.abs(size),
          direction,
          entryPrice,
          markPrice,
          unrealizedPnl,
          returnOnEquity,
          leverage,
          yourSize: cappedSize,
          isLong
        });

        message += `${index + 1}️⃣ **${coin}**\n`;
        message += `   Direction: ${direction}\n`;
        message += `   Size: ${Math.abs(size).toFixed(4)}\n`;
        message += `   Entry: $${entryPrice.toFixed(2)}\n`;
        message += `   Mark: $${markPrice.toFixed(2)}\n`;
        message += `   PnL: ${pnlEmoji} $${unrealizedPnl.toFixed(2)} (${(returnOnEquity * 100).toFixed(2)}%)\n`;
        message += `   Leverage: ${leverage}x\n`;
        message += `   📋 Your Size: ${cappedSize.toFixed(4)}\n\n`;
      });

      message += `━━━━━━━━━━━━━━━━━━━\n`;
      message += `💰 **Total Unrealized PnL:** ${totalUnrealizedPnl >= 0 ? '✅' : '❌'} $${totalUnrealizedPnl.toFixed(2)}\n\n`;
      
      // Add copy trade summary
      message += `📋 **COPY TRADE SUMMARY**\n`;
      message += `To mirror these positions (at 10% size):\n\n`;
      
      positionDetails.forEach(pos => {
        message += `• ${pos.isLong ? 'BUY' : 'SELL'} ${pos.yourSize.toFixed(4)} ${pos.coin} @ market\n`;
      });
    }

    message += `\n━━━━━━━━━━━━━━━━━━━\n`;
    message += `_Updated at ${new Date().toTimeString().split(' ')[0]}_`;

    // Send to Telegram
    await telegram.sendMarkdownMessage(message);
    console.log('✅ Position update sent to Telegram!');
    
    // Also log summary to console
    console.log('\nPosition Summary:');
    console.log('━━━━━━━━━━━━━━━');
    activePositions.forEach(pos => {
      const coin = pos.position.coin;
      const size = parseFloat(pos.position.szi);
      const pnl = parseFloat(pos.position.unrealizedPnl || 0);
      console.log(`${coin}: ${size > 0 ? 'LONG' : 'SHORT'} ${Math.abs(size).toFixed(4)} | PnL: $${pnl.toFixed(2)}`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    await telegram.sendMessage(`❌ Error fetching positions: ${error.message}`);
  }
}

// Run the check
checkCurrentPositions();
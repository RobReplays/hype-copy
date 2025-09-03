require('dotenv').config();
const HyperliquidBot = require('./src/HyperliquidBot');
const PortfolioMirror = require('./src/PortfolioMirror');
const TelegramNotifier = require('./src/TelegramNotifier');
const http = require('http');

// Configuration from environment variables
const config = {
  signalProviderAddress: process.env.SIGNAL_PROVIDER_ADDRESS,
  sizingMethod: process.env.SIZING_METHOD || 'fixed_ratio',
  accountRatio: parseFloat(process.env.ACCOUNT_RATIO) || 0.1,
  maxPositionSize: parseFloat(process.env.MAX_POSITION_SIZE) || 10,
  pollInterval: parseInt(process.env.POLL_INTERVAL) || 5000,
  myAddress: process.env.MY_ADDRESS, // Optional for future use
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID
  }
};

// Validate required configuration
function validateConfig() {
  const required = [
    'SIGNAL_PROVIDER_ADDRESS',
    'TELEGRAM_BOT_TOKEN', 
    'TELEGRAM_CHAT_ID'
  ];

  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:');
    missing.forEach(key => console.error(`   - ${key}`));
    console.error('\nPlease check your .env file');
    process.exit(1);
  }

  // Validate address format (basic check)
  if (!config.signalProviderAddress.startsWith('0x') || config.signalProviderAddress.length !== 42) {
    console.error('❌ Invalid SIGNAL_PROVIDER_ADDRESS format. Should be 42 characters starting with 0x');
    process.exit(1);
  }

  console.log('✅ Configuration validated');
}

// Main function
async function main() {
  try {
    // FIRST: Start HTTP server immediately for Render
    const PORT = process.env.PORT || 3000;
    let botInstance = null;
    
    const server = http.createServer((req, res) => {
      if (req.url === '/health' || req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'healthy',
          botRunning: botInstance ? botInstance.isRunning : false,
          uptime: process.uptime(),
          timestamp: new Date().toISOString()
        }));
      } else {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Hyperliquid Copy Trading Bot is running!');
      }
    });

    // Start server IMMEDIATELY
    await new Promise((resolve) => {
      server.listen(PORT, '0.0.0.0', () => {
        console.log(`🌐 HTTP server started on port ${PORT}`);
        resolve();
      });
    });
    
    // THEN validate config and start bot
    validateConfig();
    
    console.log('🚀 Starting Hyperliquid Copy Trading Monitor...');
    console.log(`📊 Monitoring: ${config.signalProviderAddress}`);
    console.log(`💬 Telegram Bot: ${config.telegram.botToken.slice(0, 10)}...`);
    console.log(`📱 Chat ID: ${config.telegram.chatId}`);
    console.log(`⚙️  Sizing: ${config.sizingMethod} (${config.accountRatio}x)`);
    
    // Create appropriate bot instance based on sizing method
    if (config.sizingMethod === 'portfolio_mirror') {
      console.log('🔄 Using Portfolio Mirror mode');
      const telegram = new TelegramNotifier(config.telegram);
      botInstance = new PortfolioMirror(config, telegram);
    } else {
      console.log('📊 Using traditional copy trading mode');
      botInstance = new HyperliquidBot(config);
    }
    
    // Handle graceful shutdown - but DON'T exit on SIGTERM for Render
    const gracefulShutdown = async (signal) => {
      console.log(`\n📡 Received ${signal}`);
      
      // For Render deployments, ignore SIGTERM during normal operation
      if (signal === 'SIGTERM' && process.env.PORT) {
        console.log('📌 Ignoring SIGTERM on Render - keeping service alive');
        return;
      }
      
      console.log('Shutting down gracefully...');
      try {
        if (botInstance) {
          await botInstance.stop();
        }
        console.log('✅ Bot stopped successfully');
        server.close();
        process.exit(0);
      } catch (error) {
        console.error('❌ Error during shutdown:', error);
        process.exit(1);
      }
    };

    // Register signal handlers
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    
    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
      console.error('❌ Uncaught Exception:', error);
      // Don't exit, try to recover
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
      // Don't exit, try to recover
    });

    // Start the bot
    await botInstance.start();
    
    // Keep the process alive
    console.log('🟢 Bot is running successfully!');
    console.log(`🔗 Health check: http://localhost:${PORT}/health`);
    
  } catch (error) {
    console.error('❌ Failed to start bot:', error);
    process.exit(1);
  }
}

// Start the application
main();
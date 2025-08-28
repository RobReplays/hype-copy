require('dotenv').config();
const HyperliquidBot = require('./src/HyperliquidBot');
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
    validateConfig();
    
    console.log('🚀 Starting Hyperliquid Copy Trading Monitor...');
    console.log(`📊 Monitoring: ${config.signalProviderAddress}`);
    console.log(`💬 Telegram Bot: ${config.telegram.botToken.slice(0, 10)}...`);
    console.log(`📱 Chat ID: ${config.telegram.chatId}`);
    console.log(`⚙️  Sizing: ${config.sizingMethod} (${config.accountRatio}x)`);
    
    // Create and start the bot
    const bot = new HyperliquidBot(config);
    
    // Handle graceful shutdown
    const gracefulShutdown = async (signal) => {
      console.log(`\n📡 Received ${signal}, shutting down gracefully...`);
      try {
        await bot.stop();
        console.log('✅ Bot stopped successfully');
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
      gracefulShutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
      gracefulShutdown('unhandledRejection');
    });

    // Create a simple HTTP server to keep Render happy
    const server = http.createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'healthy',
          uptime: process.uptime(),
          isRunning: bot.isRunning,
          timestamp: new Date().toISOString()
        }));
      } else {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Hyperliquid Copy Trading Bot is running!\n\nFor health check: /health');
      }
    });

    const PORT = process.env.PORT || 3000;
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`🌐 Health server running on port ${PORT}`);
    });

    // Start the bot
    await bot.start();
    
    // Keep the process alive
    console.log('🟢 Bot is running. Press Ctrl+C to stop.');
    console.log(`🔗 Health check available at: http://localhost:${PORT}/health`);
    
  } catch (error) {
    console.error('❌ Failed to start bot:', error);
    process.exit(1);
  }
}

// Start the application
main();
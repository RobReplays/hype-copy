const axios = require('axios');
const { ethers } = require('ethers');
const { spawn } = require('child_process');
const path = require('path');

class PortfolioMirror {
  constructor(config, telegram) {
    this.config = config;
    this.telegram = telegram;
    this.signalProviderAddress = config.signalProviderAddress;
    this.rebalanceInterval = parseInt(process.env.REBALANCE_INTERVAL || 300000); // 5 min default
    this.minRebalanceDiff = parseFloat(process.env.MIN_REBALANCE_DIFF || 0.05); // 5% default
    this.maxUtilization = parseFloat(process.env.MAX_UTILIZATION || 1.0); // 100% default
    this.lastRebalance = null;
    this.rebalanceTimer = null;
  }

  async start() {
    console.log('🔄 Starting Portfolio Mirror mode');
    console.log(`  Rebalance interval: ${this.rebalanceInterval / 1000}s`);
    console.log(`  Min difference: ${this.minRebalanceDiff * 100}%`);
    console.log(`  Max utilization: ${this.maxUtilization * 100}%`);

    // Send startup message
    await this.telegram.sendMessage(
      '🚀 Hyperliquid Portfolio Mirror Started!\n\n' +
      `📊 Monitoring: ${this.signalProviderAddress.slice(0, 6)}...${this.signalProviderAddress.slice(-4)}\n` +
      `⏰ Rebalance Interval: ${this.rebalanceInterval / 60000} minutes\n` +
      `📏 Min Difference: ${this.minRebalanceDiff * 100}%\n` +
      `💰 Mode: Portfolio Mirroring`
    );

    // Initial portfolio check
    await this.rebalancePortfolio();

    // Schedule periodic rebalancing
    this.rebalanceTimer = setInterval(async () => {
      await this.rebalancePortfolio();
    }, this.rebalanceInterval);
  }

  async stop() {
    if (this.rebalanceTimer) {
      clearInterval(this.rebalanceTimer);
      this.rebalanceTimer = null;
    }
  }

  async sendDetailedPositions(signalInfo, myInfo) {
    // Get current prices for better display
    try {
      const priceResponse = await axios.post('https://api.hyperliquid.xyz/info', {
        type: 'allMids'
      });
      const prices = priceResponse.data;

      // Build signal provider positions message
      const signalPositions = Object.entries(signalInfo.positions);
      if (signalPositions.length > 0) {
        let message = `📊 SIGNAL PROVIDER POSITIONS (${signalPositions.length})\n\n`;
        let totalPnl = 0;

        for (const [coin, pos] of signalPositions) {
          const isLong = pos.size > 0;
          const currentPrice = prices[coin] || pos.markPrice;
          
          message += `💰 ${coin}\n`;
          message += `   📊 ${isLong ? '🟢 LONG' : '🔴 SHORT'} ${Math.abs(pos.size).toFixed(4)}\n`;
          message += `   💵 Mark: $${currentPrice.toFixed(4)}\n`;
          message += `   💰 Value: $${pos.value.toFixed(2)}\n\n`;
        }

        message += `💰 Total Value: $${signalInfo.totalPositionValue.toFixed(2)}\n`;
        message += `📊 Utilization: ${(signalInfo.utilization * 100).toFixed(1)}%`;
        
        await this.telegram.sendMessage(message);
      } else {
        await this.telegram.sendMessage('📊 Signal provider has no active positions');
      }

      // Build your positions message
      const myPositions = Object.entries(myInfo.positions);
      if (myPositions.length > 0) {
        let message = `📊 YOUR POSITIONS (${myPositions.length})\n\n`;

        for (const [coin, pos] of myPositions) {
          const isLong = pos.size > 0;
          const currentPrice = prices[coin] || pos.markPrice;
          
          message += `💰 ${coin}\n`;
          message += `   📊 ${isLong ? '🟢 LONG' : '🔴 SHORT'} ${Math.abs(pos.size).toFixed(4)}\n`;
          message += `   💵 Mark: $${currentPrice.toFixed(4)}\n`;
          message += `   💰 Value: $${pos.value.toFixed(2)}\n\n`;
        }

        message += `💰 Total Value: $${myInfo.totalPositionValue.toFixed(2)}\n`;
        message += `💳 Account Balance: $${myInfo.accountValue.toFixed(2)}`;
        
        await this.telegram.sendMessage(message);
      } else {
        await this.telegram.sendMessage(
          `📭 No active positions\n` +
          `💰 Account Balance: $${myInfo.accountValue.toFixed(2)}`
        );
      }
    } catch (error) {
      console.error('Error sending detailed positions:', error.message);
    }
  }

  async getAccountInfo(address) {
    try {
      const response = await axios.post('https://api.hyperliquid.xyz/info', {
        type: 'clearinghouseState',
        user: address
      });

      const data = response.data;
      const accountValue = parseFloat(data.marginSummary?.accountValue || 0);
      const positions = data.assetPositions || [];

      // Calculate total position value
      let totalPositionValue = 0;
      const positionDetails = {};

      for (const pos of positions) {
        if (pos.position && parseFloat(pos.position.szi) !== 0) {
          const coin = pos.position.coin;
          const size = Math.abs(parseFloat(pos.position.szi));
          const markPrice = parseFloat(pos.position.markPx || 0);
          const positionValue = size * markPrice;
          
          totalPositionValue += positionValue;
          positionDetails[coin] = {
            size: parseFloat(pos.position.szi), // Keep sign for long/short
            value: positionValue,
            markPrice: markPrice
          };
        }
      }

      return {
        accountValue,
        totalPositionValue,
        utilization: accountValue > 0 ? totalPositionValue / accountValue : 0,
        positions: positionDetails
      };
    } catch (error) {
      console.error('Error fetching account info:', error.message);
      return null;
    }
  }

  async rebalancePortfolio() {
    try {
      console.log('\n🔍 Checking portfolio for rebalancing...');

      // Get signal provider's portfolio
      const signalInfo = await this.getAccountInfo(this.signalProviderAddress);
      if (!signalInfo) {
        console.error('Failed to fetch signal provider info');
        return;
      }

      // Get our portfolio
      const wallet = new ethers.Wallet(process.env.PRIVATE_KEY);
      const myInfo = await this.getAccountInfo(wallet.address);
      if (!myInfo) {
        console.error('Failed to fetch our account info');
        return;
      }

      console.log(`📊 Signal Provider:`);
      console.log(`  Account: $${signalInfo.accountValue.toFixed(2)}`);
      console.log(`  Positions: $${signalInfo.totalPositionValue.toFixed(2)}`);
      console.log(`  Utilization: ${(signalInfo.utilization * 100).toFixed(1)}%`);

      console.log(`📊 Your Account:`);
      console.log(`  Account: $${myInfo.accountValue.toFixed(2)}`);
      console.log(`  Positions: $${myInfo.totalPositionValue.toFixed(2)}`);
      console.log(`  Utilization: ${(myInfo.utilization * 100).toFixed(1)}%`);

      // Send detailed position breakdown
      await this.sendDetailedPositions(signalInfo, myInfo);

      // Calculate target utilization (capped by maxUtilization)
      const targetUtilization = Math.min(signalInfo.utilization, this.maxUtilization);
      
      // Calculate target position values
      const targetTotalValue = myInfo.accountValue * targetUtilization;
      const rebalanceActions = [];

      // Build rebalance actions for each coin
      const allCoins = new Set([
        ...Object.keys(signalInfo.positions),
        ...Object.keys(myInfo.positions)
      ]);

      for (const coin of allCoins) {
        const signalPos = signalInfo.positions[coin] || { value: 0, size: 0 };
        const myPos = myInfo.positions[coin] || { value: 0, size: 0 };

        // Calculate target based on signal's proportion
        let targetValue = 0;
        if (signalInfo.totalPositionValue > 0 && signalPos.value > 0) {
          const proportion = signalPos.value / signalInfo.totalPositionValue;
          targetValue = targetTotalValue * proportion;
        }

        // Calculate difference
        const currentValue = myPos.value;
        const valueDiff = targetValue - currentValue;
        const percentDiff = currentValue > 0 
          ? Math.abs(valueDiff / currentValue)
          : targetValue > 0 ? 1 : 0;

        // Check if rebalance needed (exceeds threshold or closing position)
        if (percentDiff > this.minRebalanceDiff || (currentValue > 0 && targetValue === 0)) {
          // Determine if signal is long or short
          const signalIsLong = signalPos.size > 0;
          
          rebalanceActions.push({
            coin,
            currentValue,
            targetValue,
            valueDiff,
            action: valueDiff > 0 ? 'INCREASE' : valueDiff < 0 ? 'DECREASE' : 'NONE',
            isLong: signalIsLong
          });
        }
      }

      // Execute rebalancing if needed
      if (rebalanceActions.length > 0) {
        await this.executeRebalancing(rebalanceActions, myInfo.accountValue);
      } else {
        console.log('✅ Portfolio is balanced (within threshold)');
        
        // Portfolio is balanced - send status
        console.log('Portfolio is balanced, no rebalancing needed');
      }

    } catch (error) {
      console.error('❌ Rebalancing error:', error.message);
      await this.telegram.sendMessage(`❌ Rebalancing error: ${error.message}`);
    }
  }

  async executeRebalancing(actions, accountValue) {
    console.log(`\n🔄 Executing ${actions.length} rebalancing actions...`);

    // Send initial rebalancing notification
    let message = `🔄 PORTFOLIO REBALANCING STARTED\n\n`;
    message += `Account Value: $${accountValue.toFixed(2)}\n`;
    message += `Actions to execute: ${actions.length}\n\n`;

    for (const action of actions) {
      const { coin, currentValue, targetValue, valueDiff, isLong } = action;
      const actionType = valueDiff > 0 ? 'BUY' : (targetValue === 0 ? 'CLOSE' : 'SELL');

      message += `${coin}:\n`;
      message += `  Current: $${currentValue.toFixed(2)}\n`;
      message += `  Target: $${targetValue.toFixed(2)}\n`;
      message += `  Action: ${actionType === 'BUY' ? '🟢 BUY' : actionType === 'CLOSE' ? '❌ CLOSE' : '🔴 SELL'} `;
      message += `$${Math.abs(valueDiff).toFixed(2)}\n\n`;

      // Execute the trade
      await this.executeTrade(coin, valueDiff, targetValue, isLong);
      
      // Small delay between trades
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    message += `⏰ Next check in ${this.rebalanceInterval / 60000} minutes`;
    await this.telegram.sendMessage(message);
  }

  async executeTrade(coin, valueDiff, targetValue, isLong) {
    try {
      // Get current price
      const priceResponse = await axios.post('https://api.hyperliquid.xyz/info', {
        type: 'allMids'
      });
      
      const currentPrice = parseFloat(priceResponse.data[coin] || 0);
      if (currentPrice === 0) {
        console.error(`Failed to get price for ${coin}`);
        return;
      }

      const pythonScript = path.join(__dirname, 'portfolio_executor.py');
      
      // Call Python executor with portfolio rebalancing mode
      const pythonProcess = spawn('python3', [
        pythonScript,
        coin,
        targetValue.toString(),
        currentPrice.toString(),
        isLong ? 'LONG' : 'SHORT'
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
        pythonProcess.on('close', async (code) => {
          try {
            const jsonMatch = output.match(/\{[\s\S]*\}$/);
            if (!jsonMatch) {
              throw new Error('No JSON in output');
            }

            const result = JSON.parse(jsonMatch[0]);
            if (result.success) {
              console.log(`✅ ${coin} rebalanced successfully`);
              
              // Determine action type based on position value
              let actionType = 'ADJUSTED';
              if (result.position_value == 0) {
                actionType = 'CLOSED';
              } else if (targetValue > currentValue * 1.5) {
                actionType = 'OPENED';
              }
              
              const tradeMessage = `✅ POSITION ${actionType}\n\n` +
                `💰 Coin: ${coin}\n` +
                `📊 Direction: ${isLong ? '🟢 LONG' : '🔴 SHORT'}\n` +
                `📏 Size: ${result.executed_size} ${coin}\n` +
                `💵 Fill Price: $${result.avg_price}\n` +
                `💰 Position Value: $${result.position_value}\n` +
                `⏰ Time: ${new Date().toLocaleString()}`;
              
              await this.telegram.sendMessage(tradeMessage);
            } else {
              console.error(`❌ Failed to rebalance ${coin}: ${result.error}`);
            }
            resolve(result);
          } catch (error) {
            console.error(`❌ Error parsing trade result: ${error.message}`);
            resolve({ success: false, error: error.message });
          }
        });
      });

    } catch (error) {
      console.error(`❌ Error executing trade for ${coin}:`, error.message);
      return { success: false, error: error.message };
    }
  }
}

module.exports = PortfolioMirror;
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
    this.baselinePositions = new Set(); // Track positions that existed at startup
    this.failedTrades = new Map(); // Track failed trades to avoid retrying
    this.isFirstRun = true; // Flag to set baseline on first check
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
      `⏰ Check Interval: ${this.rebalanceInterval / 60000} minutes\n` +
      `📏 Min Difference: ${this.minRebalanceDiff * 100}%\n` +
      `💰 Mode: Portfolio Mirroring`
    );

    // Load and display initial positions
    await this.loadInitialPositions();

    // Initial portfolio check (will only message if rebalancing needed)
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

  async loadInitialPositions() {
    try {
      console.log('📊 Loading initial positions...');
      
      // Get signal provider info
      const signalInfo = await this.getAccountInfo(this.signalProviderAddress);
      if (!signalInfo) {
        await this.telegram.sendMessage('❌ Failed to load signal provider positions');
        return;
      }

      // Mark all current positions as baseline
      for (const coin in signalInfo.positions) {
        this.baselinePositions.add(coin);
        console.log(`  📌 ${coin}: Marked as baseline (won't auto-copy)`);
      }
      this.isFirstRun = false; // Already set baseline

      // Get current prices
      const priceResponse = await axios.post('https://api.hyperliquid.xyz/info', {
        type: 'allMids'
      });
      const prices = priceResponse.data;

      // Get full position details for PnL
      const response = await axios.post('https://api.hyperliquid.xyz/info', {
        type: 'clearinghouseState',
        user: this.signalProviderAddress
      });
      
      const positions = response.data.assetPositions || [];
      const activePositions = positions.filter(p => 
        p.position && Math.abs(parseFloat(p.position.szi)) > 0
      );

      if (activePositions.length > 0) {
        let message = `📊 SIGNAL PROVIDER POSITIONS (${activePositions.length})\n\n`;
        let totalPnl = 0;

        for (const pos of activePositions) {
          const coin = pos.position.coin;
          const size = parseFloat(pos.position.szi);
          const isLong = size > 0;
          const entryPrice = parseFloat(pos.position.entryPx || 0);
          const markPrice = parseFloat(prices[coin] || pos.position.markPx || 0);
          const pnl = parseFloat(pos.position.unrealizedPnl || 0);
          totalPnl += pnl;

          message += `💰 ${coin}\n`;
          message += `   📊 ${isLong ? '🟢 LONG' : '🔴 SHORT'} ${Math.abs(size).toFixed(4)}\n`;
          message += `   💵 Entry: $${entryPrice.toFixed(4)}\n`;
          message += `   💵 Mark: $${markPrice.toFixed(4)}\n`;
          message += `   📈 PnL: $${pnl.toFixed(2)}\n\n`;
        }

        message += `💰 Signal Total PnL: $${totalPnl.toFixed(2)}\n\n`;
        message += `🔍 Checking your positions...`;
        
        await this.telegram.sendMessage(message);
      } else {
        await this.telegram.sendMessage('📊 Signal provider has no active positions\n\n🔍 Monitoring for new trades...');
      }

      // Now show your positions
      const wallet = new ethers.Wallet(process.env.PRIVATE_KEY);
      const myInfo = await this.getAccountInfo(wallet.address);
      
      if (myInfo && Object.keys(myInfo.positions).length > 0) {
        let message = `📊 YOUR POSITIONS\n\n`;
        
        for (const [coin, pos] of Object.entries(myInfo.positions)) {
          const isLong = pos.size > 0;
          message += `💰 ${coin}: ${isLong ? '🟢 LONG' : '🔴 SHORT'} ${Math.abs(pos.size).toFixed(4)}\n`;
        }
        
        message += `\n💰 Account Balance: $${myInfo.accountValue.toFixed(2)}`;
        await this.telegram.sendMessage(message);
      } else {
        await this.telegram.sendMessage(
          `📭 No active positions\n` +
          `💰 Account Balance: $${myInfo?.accountValue?.toFixed(2) || '0.00'}`
        );
      }
      
    } catch (error) {
      console.error('Error loading initial positions:', error.message);
      await this.telegram.sendMessage('❌ Error loading initial positions');
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
          const currentPrice = parseFloat(prices[coin] || pos.markPrice || 0);
          
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
          const currentPrice = parseFloat(prices[coin] || pos.markPrice || 0);
          
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

      // Get current prices for accurate position values
      const priceResponse = await axios.post('https://api.hyperliquid.xyz/info', {
        type: 'allMids'
      });
      const prices = priceResponse.data || {};

      for (const pos of positions) {
        if (pos.position && parseFloat(pos.position.szi) !== 0) {
          const coin = pos.position.coin;
          const size = Math.abs(parseFloat(pos.position.szi));
          // Use market price first, fallback to mark price
          const markPrice = parseFloat(prices[coin] || pos.position.markPx || 0);
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

      // On first run, set baseline positions and don't rebalance
      if (this.isFirstRun) {
        console.log('📸 Setting baseline positions (will ignore these)');
        for (const coin in signalInfo.positions) {
          this.baselinePositions.add(coin);
          console.log(`  - ${coin}: Marked as baseline (won't copy)`);
        }
        this.isFirstRun = false;
        console.log('✅ Baseline set. Will only copy NEW positions from now on.');
        return; // Don't rebalance on first run
      }

      console.log(`📊 Signal Provider:`);
      console.log(`  Account: $${signalInfo.accountValue.toFixed(2)}`);
      console.log(`  Positions: $${signalInfo.totalPositionValue.toFixed(2)}`);
      console.log(`  Utilization: ${(signalInfo.utilization * 100).toFixed(1)}%`);

      console.log(`📊 Your Account:`);
      console.log(`  Account: $${myInfo.accountValue.toFixed(2)}`);
      console.log(`  Positions: $${myInfo.totalPositionValue.toFixed(2)}`);
      console.log(`  Utilization: ${(myInfo.utilization * 100).toFixed(1)}%`);

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

      // Only check for NEW coins (not in baseline) and CLOSES of our existing positions
      for (const coin of allCoins) {
        const signalPos = signalInfo.positions[coin] || { value: 0, size: 0 };
        const myPos = myInfo.positions[coin] || { value: 0, size: 0 };

        // Case 1: NEW position from signal provider (not in baseline) 
        if (!this.baselinePositions.has(coin) && signalPos.value > 0 && myPos.value === 0) {
          console.log(`🆕 New position detected: ${coin}`);
          const targetValue = (signalPos.value / signalInfo.totalPositionValue) * targetTotalValue;
          
          rebalanceActions.push({
            coin,
            currentValue: myPos.value,
            targetValue,
            valueDiff: targetValue - myPos.value,
            action: 'OPEN',
            isLong: signalPos.size > 0
          });
        }
        
        // Case 2: Update existing position (if we already have one)
        else if (myPos.value > 0 && signalPos.value > 0) {
          const targetValue = (signalPos.value / signalInfo.totalPositionValue) * targetTotalValue;
          const valueDiff = targetValue - myPos.value;
          const percentDiff = Math.abs(valueDiff / myPos.value);
          
          if (percentDiff > this.minRebalanceDiff) {
            console.log(`🔄 Position update: ${coin} (${percentDiff * 100:.1f}% change)`);
            
            rebalanceActions.push({
              coin,
              currentValue: myPos.value,
              targetValue,
              valueDiff,
              action: valueDiff > 0 ? 'INCREASE' : 'DECREASE',
              isLong: signalPos.size > 0
            });
          }
        }
        
        // Case 3: CLOSE our position if signal provider closed theirs
        else if (myPos.value > 0 && signalPos.value === 0) {
          console.log(`❌ Position to close: ${coin}`);
          
          rebalanceActions.push({
            coin,
            currentValue: myPos.value,
            targetValue: 0,
            valueDiff: -myPos.value,
            action: 'CLOSE',
            isLong: myPos.size > 0
          });
        }
      }

      // Execute rebalancing if needed
      if (rebalanceActions.length > 0) {
        console.log(`🎯 Rebalancing needed: ${rebalanceActions.length} actions`);
        
        // Check if any are closes
        const closeActions = rebalanceActions.filter(a => a.targetValue === 0);
        if (closeActions.length > 0) {
          console.log(`❌ Closing ${closeActions.length} positions: ${closeActions.map(a => a.coin).join(', ')}`);
        }
        
        // Execute the rebalancing (will only send messages if successful)
        const success = await this.executeRebalancing(rebalanceActions, myInfo.accountValue, signalInfo, myInfo);
        
        if (!success) {
          console.log('⚠️ Rebalancing failed - will retry next check');
        }
      } else {
        // Portfolio is balanced - no message, just log
        console.log('✅ Portfolio is balanced (no changes needed)');
      }

    } catch (error) {
      console.error('❌ Rebalancing error:', error.message);
      await this.telegram.sendMessage(`❌ Rebalancing error: ${error.message}`);
    }
  }

  async executeRebalancing(actions, accountValue, signalInfo, myInfo) {
    console.log(`\n🔄 Executing ${actions.length} rebalancing actions...`);
    let successCount = 0;
    let failedActions = [];

    for (const action of actions) {
      const { coin, currentValue, targetValue, valueDiff, isLong } = action;
      
      // Execute the trade
      const result = await this.executeTrade(coin, valueDiff, targetValue, isLong);
      
      if (result && result.success) {
        successCount++;
      } else {
        failedActions.push(coin);
      }
      
      // Small delay between trades
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Only send messages if we had successful trades
    if (successCount > 0) {
      // Send positions before message
      await this.sendDetailedPositions(signalInfo, myInfo);
      
      // Send success summary
      await this.telegram.sendMessage(
        `✅ REBALANCING COMPLETE\n\n` +
        `Successful trades: ${successCount}/${actions.length}\n` +
        `${failedActions.length > 0 ? `Failed: ${failedActions.join(', ')}\n` : ''}` +
        `⏰ Next check in ${this.rebalanceInterval / 60000} minutes`
      );
      
      // Get updated positions after trades
      setTimeout(async () => {
        const wallet = new ethers.Wallet(process.env.PRIVATE_KEY);
        const updatedMyInfo = await this.getAccountInfo(wallet.address);
        if (updatedMyInfo) {
          await this.sendDetailedPositions(signalInfo, updatedMyInfo);
        }
      }, 3000);
    }
    
    return successCount > 0;
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
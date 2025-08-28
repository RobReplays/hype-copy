require('dotenv').config();
const { Hyperliquid } = require('hyperliquid');
const { ethers } = require('ethers');
const axios = require('axios');

async function checkBalance() {
  console.log('💰 Checking Hyperliquid Account Balance\विन');
  console.log('═══════════════════════════════════════\n');
  
  if (!process.env.PRIVATE_KEY) {
    console.error('❌ PRIVATE_KEY not found in .env file');
    process.exit(1);
  }

  try {
    // Initialize wallet
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY);
    console.log('📱 Wallet Address:', wallet.address);
    console.log('   (Make sure this matches where you sent USDC)\n');
    
    // Try API method first (more reliable)
    console.log('📊 Fetching account state via API...');
    const response = await axios.post('https://api.hyperliquid.xyz/info', {
      type: 'clearinghouseState', 
      user: wallet.address
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (response.data) {
      console.log('\n💵 Account Summary:');
      
      // Check margin summary
      if (response.data.marginSummary) {
        const margin = response.data.marginSummary;
        console.log(`   Account Value: $${parseFloat(margin.accountValue || 0).toFixed(2)}`);
        console.log(`   Total Margin Used: $${parseFloat(margin.totalMarginUsed || 0).toFixed(2)}`);
        console.log(`   Total NLV: $${parseFloat(margin.totalNtlPos || 0).toFixed(2)}`);
      }
      
      // Check withdrawable balance
      if (response.data.withdrawable) {
        console.log(`   Withdrawable: $${parseFloat(response.data.withdrawable || 0).toFixed(2)}`);
      }
      
      // Check cross margin
      if (response.data.crossMarginSummary) {
        const cross = response.data.crossMarginSummary;
        console.log(`   Available Balance: $${parseFloat(cross.availableBalance || 0).toFixed(2)}`);
        console.log(`   Total Position Value: $${parseFloat(cross.totalPositionValue || 0).toFixed(2)}`);
      }
      
      // List active positions
      const positions = response.data.assetPositions || [];
      const activePositions = positions.filter(p => p.position && parseFloat(p.position.szi) !== 0);
      
      if (activePositions.length > 0) {
        console.log(`\n📈 Active Positions (${activePositions.length}):`);
        activePositions.forEach(pos => {
          const coin = pos.position.coin;
          const size = parseFloat(pos.position.szi);
          const pnl = parseFloat(pos.position.unrealizedPnl || 0);
          const side = size > 0 ? 'LONG' : 'SHORT';
          console.log(`   ${coin}: ${side} ${Math.abs(size).toFixed(4)} | PnL: $${pnl.toFixed(2)}`);
        });
      } else {
        console.log('\n📭 No active positions');
      }
      
      // Raw data for debugging
      console.log('\n🔍 Raw Account Data:');
      console.log(JSON.stringify({
        marginSummary: response.data.marginSummary,
        crossMarginSummary: response.data.crossMarginSummary,
        withdrawable: response.data.withdrawable
      }, null, 2));
      
    } else {
      console.log('❌ No account data returned');
      console.log('   Your wallet may not be registered on Hyperliquid yet');
      console.log('   Please deposit USDC through the Hyperliquid interface first');
    }
    
    // Also try SDK method
    console.log('\n🔄 Trying SDK method...');
    const client = new Hyperliquid({
      privateKey: process.env.PRIVATE_KEY,
      testnet: false
    });
    
    // Get user state
    const userState = await client.info.getUserState(wallet.address);
    if (userState) {
      console.log('✅ SDK connection successful');
      if (userState.marginSummary) {
        console.log(`   Account value via SDK: $${parseFloat(userState.marginSummary.accountValue || 0).toFixed(2)}`);
      }
    }
    
    console.log('\n✅ Balance check complete!');
    console.log('\n💡 Next steps:');
    console.log('1. If balance shows $0, deposit USDC at app.hyperliquid.xyz');
    console.log('2. Make sure to deposit to the L2 (Hyperliquid chain)');
    console.log('3. Once deposited, run: node test-buy.js');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.log('\n💡 This might mean:');
    console.log('1. Your wallet hasn\'t been used on Hyperliquid yet');
    console.log('2. You need to deposit USDC first at app.hyperliquid.xyz');
    console.log('3. Make sure to use the same wallet address');
  }
}

checkBalance();
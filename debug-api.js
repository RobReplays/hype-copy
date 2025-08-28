require('dotenv').config();
const axios = require('axios');

async function debugAPI() {
  console.log('🔍 Debugging Hyperliquid API Response\n');
  
  const signalProviderAddress = process.env.SIGNAL_PROVIDER_ADDRESS;
  
  try {
    // 1. Get positions
    console.log('Fetching positions for:', signalProviderAddress);
    const response = await axios.post('https://api.hyperliquid.xyz/info', {
      type: 'clearinghouseState',
      user: signalProviderAddress
    });

    const positions = response.data.assetPositions;
    const promptPosition = positions.find(p => p.position?.coin === 'PROMPT');
    
    if (promptPosition) {
      console.log('\n📊 PROMPT Position Raw Data:');
      console.log(JSON.stringify(promptPosition, null, 2));
      
      console.log('\n🔍 Key Fields:');
      console.log('Entry Price (entryPx):', promptPosition.position.entryPx);
      console.log('Mark Price (markPx):', promptPosition.position.markPx);
      console.log('Size (szi):', promptPosition.position.szi);
      console.log('Unrealized PnL:', promptPosition.position.unrealizedPnl);
      console.log('Return on Equity:', promptPosition.position.returnOnEquity);
    }

    // 2. Try to get market data
    console.log('\n\nFetching market data...');
    const marketResponse = await axios.post('https://api.hyperliquid.xyz/info', {
      type: 'meta'
    });
    
    const promptMarket = marketResponse.data.universe.find(m => m.name === 'PROMPT');
    if (promptMarket) {
      console.log('\n📈 PROMPT Market Data:');
      console.log(JSON.stringify(promptMarket, null, 2));
    } else {
      console.log('\n⚠️ PROMPT not found in market universe');
    }

    // 3. Try to get all asset contexts for prices
    console.log('\n\nFetching asset contexts...');
    const contextResponse = await axios.post('https://api.hyperliquid.xyz/info', {
      type: 'metaAndAssetCtxs'
    });
    
    // Find PROMPT in the contexts
    const assetCtxs = contextResponse.data[1]; // Second element is asset contexts
    const promptIndex = contextResponse.data[0].universe.findIndex(m => m.name === 'PROMPT');
    
    if (promptIndex !== -1 && assetCtxs[promptIndex]) {
      console.log('\n💰 PROMPT Asset Context:');
      console.log('Mark Price:', assetCtxs[promptIndex].markPx);
      console.log('Last Price:', assetCtxs[promptIndex].lastPx);
      console.log('24h Volume:', assetCtxs[promptIndex].dayNtlVlm);
      console.log('Open Interest:', assetCtxs[promptIndex].openInterest);
      console.log('Full context:', JSON.stringify(assetCtxs[promptIndex], null, 2));
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('Response:', error.response.data);
    }
  }
}

debugAPI();
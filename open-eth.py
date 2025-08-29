#!/usr/bin/env python3
"""Open ETH position with exactly $10.01 to meet minimum"""

from hyperliquid.exchange import Exchange
from hyperliquid.info import Info
from eth_account import Account
import os
from dotenv import load_dotenv

load_dotenv()

account = Account.from_key(os.getenv('PRIVATE_KEY'))
exchange = Exchange(account)
info = Info(skip_ws=True)

# Get ETH price
all_mids = info.all_mids()
eth_price = float(all_mids['ETH'])
print(f'ETH Price: ${eth_price:.2f}')

# Calculate size for exactly $10.01 to ensure we meet minimum
eth_size = 10.01 / eth_price
print(f'Size for $10.01: {eth_size:.6f} ETH')

# Round properly
meta = info.meta()
eth_ctx = next((a for a in meta['universe'] if a['name'] == 'ETH'), None)
if eth_ctx:
    decimals = eth_ctx['szDecimals']
    # Round up slightly to ensure we're over $10
    import math
    eth_size = math.ceil(eth_size * (10 ** decimals)) / (10 ** decimals)
    
print(f'Rounded size: {eth_size:.6f} ETH')
print(f'Value: ${eth_size * eth_price:.2f}')

# Calculate margin with leverage
eth_leverage = 50  # ETH typically 50x
margin_needed = (eth_size * eth_price) / eth_leverage
print(f'Margin needed (50x leverage): ${margin_needed:.2f}')

print('\nExecuting trade...')
result = exchange.market_open(
    name='ETH',
    is_buy=True,
    sz=eth_size,
    slippage=0.02
)

if result.get('status') == 'ok':
    response_data = result.get('response', {}).get('data', {})
    statuses = response_data.get('statuses', [])
    if statuses and 'filled' in statuses[0]:
        fill = statuses[0]['filled']
        print(f'✅ ETH Filled: {fill["totalSz"]} @ ${fill["avgPx"]}')
        print(f'✅ Position opened! Will auto-close when signal provider exits.')
    elif statuses and 'error' in statuses[0]:
        print(f'❌ Error: {statuses[0]["error"]}')
else:
    print(f'❌ Failed: {result}')
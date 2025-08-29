#!/usr/bin/env python3
"""Close HYPE position"""

from hyperliquid.exchange import Exchange
from hyperliquid.info import Info
from eth_account import Account
import os
from dotenv import load_dotenv

load_dotenv()

account = Account.from_key(os.getenv('PRIVATE_KEY'))
exchange = Exchange(account)
info = Info(skip_ws=True)

# Check current position
user_state = info.user_state(account.address)
positions = user_state.get("assetPositions", [])
hype_pos = next((p for p in positions if p["position"]["coin"] == "HYPE"), None)

if not hype_pos or float(hype_pos["position"]["szi"]) == 0:
    print("❌ No HYPE position to close")
else:
    size = abs(float(hype_pos["position"]["szi"]))
    is_long = float(hype_pos["position"]["szi"]) > 0
    
    print(f"Closing HYPE position: {size} {'LONG' if is_long else 'SHORT'}")
    
    # To close a LONG, we SELL. To close a SHORT, we BUY
    result = exchange.market_open(
        name='HYPE',
        is_buy=not is_long,  # Opposite direction to close
        sz=size,
        slippage=0.02
    )
    
    if result.get('status') == 'ok':
        response_data = result.get('response', {}).get('data', {})
        statuses = response_data.get('statuses', [])
        if statuses and 'filled' in statuses[0]:
            fill = statuses[0]['filled']
            print(f'✅ HYPE Closed: {fill["totalSz"]} @ ${fill["avgPx"]}')
        elif statuses and 'error' in statuses[0]:
            print(f'❌ Error: {statuses[0]["error"]}')
    else:
        print(f'Failed: {result}')
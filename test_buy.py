#!/usr/bin/env python3
"""
Hyperliquid test buy script using Python SDK
"""

import os
import json
import time
from eth_account import Account
from hyperliquid.exchange import Exchange
from hyperliquid.info import Info
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

def main():
    print("💰 Testing Buy Order on Hyperliquid (Python)\n")
    print("=" * 40, "\n")
    
    # Get private key from environment
    private_key = os.getenv("PRIVATE_KEY")
    if not private_key:
        print("❌ PRIVATE_KEY not found in .env file")
        return
    
    try:
        # Initialize account from private key
        account = Account.from_key(private_key)
        print(f"📱 Wallet Address: {account.address}")
        
        # Initialize Hyperliquid Info API (no key needed for public data)
        info = Info(skip_ws=True)  # Skip websocket for simple test
        
        # Get user state
        print("\n📊 Fetching account state...")
        user_state = info.user_state(account.address)
        
        if user_state and "marginSummary" in user_state:
            account_value = float(user_state["marginSummary"]["accountValue"])
            print(f"💵 Account Value: ${account_value:.2f}")
            withdrawable = float(user_state.get("withdrawable", 0))
            print(f"💰 Withdrawable: ${withdrawable:.2f}")
        else:
            print("⚠️  No account data found")
            account_value = 0
        
        # Get all market prices
        print("\n📈 Fetching market prices...")
        all_mids = info.all_mids()
        
        # Choose a test coin
        test_coin = "SOL"
        if test_coin not in all_mids:
            print(f"❌ {test_coin} not found in markets")
            return
        
        current_price = float(all_mids[test_coin])
        print(f"\n🎯 {test_coin} Current Price: ${current_price:.2f}")
        
        # Calculate test order
        order_value_usd = 10.0  # $10 test order (minimum on Hyperliquid)
        order_size_raw = order_value_usd / current_price
        
        # Get asset decimals for proper rounding
        asset_info = info.meta()
        asset_ctx = next((a for a in asset_info["universe"] if a["name"] == test_coin), None)
        
        if not asset_ctx:
            print(f"❌ Could not find {test_coin} metadata")
            return
            
        sz_decimals = asset_ctx["szDecimals"]
        order_size = round(order_size_raw, sz_decimals)
        
        print("\n📋 Test Order Details:")
        print(f"   Coin: {test_coin}")
        print(f"   Side: BUY (Long)")
        print(f"   Size: {order_size:.6f} {test_coin}")
        print(f"   Value: ${order_value_usd:.2f}")
        print(f"   Type: Market Order")
        print(f"   Slippage: 2%")
        
        if account_value < order_value_usd:
            print(f"\n❌ Insufficient balance. Need ${order_value_usd}, have ${account_value:.2f}")
            return
        
        # Initialize Exchange for trading
        print("\n🔄 Initializing exchange connection...")
        exchange = Exchange(account)
        
        # Prepare to place order
        print("\n⚠️  Ready to place REAL order!")
        print("   Press Ctrl+C within 5 seconds to cancel...")
        print("   ", end="", flush=True)
        
        for i in range(5, 0, -1):
            print(f"{i}... ", end="", flush=True)
            time.sleep(1)
        print()
        
        print("\n📤 Placing market buy order...")
        
        # Place the order (size already rounded properly)
        order_result = exchange.market_open(
            name=test_coin,
            is_buy=True, 
            sz=order_size,  # SDK should handle conversion
            slippage=0.02  # 2% slippage tolerance
        )
        
        print("✅ Order Response:")
        print(json.dumps(order_result, indent=2))
        
        if order_result.get("status") == "ok":
            print("\n🎉 Order placed successfully!")
            
            # Wait a moment then check position
            print("\n⏳ Waiting for position update...")
            time.sleep(3)
            
            # Check new position
            user_state = info.user_state(account.address)
            if user_state and "assetPositions" in user_state:
                positions = user_state["assetPositions"]
                sol_position = next((p for p in positions if p["position"]["coin"] == test_coin), None)
                
                if sol_position and float(sol_position["position"]["szi"]) != 0:
                    print(f"\n✅ Position confirmed:")
                    print(f"   Size: {sol_position['position']['szi']}")
                    print(f"   Entry: ${float(sol_position['position']['entryPx']):.2f}")
                    print(f"   Mark: ${float(sol_position['position'].get('markPx', 0)):.2f}")
                    print(f"   PnL: ${float(sol_position['position'].get('unrealizedPnl', 0)):.2f}")
        else:
            print(f"\n❌ Order failed: {order_result}")
            
    except KeyboardInterrupt:
        print("\n\n🛑 Order cancelled by user")
    except Exception as e:
        print(f"\n❌ Error: {str(e)}")
        print("\n💡 Troubleshooting:")
        print("1. Make sure you have USDC on Hyperliquid L2")
        print("2. Check that your private key is correct")
        print("3. Ensure sufficient balance for the trade")
        print(f"4. Error details: {type(e).__name__}")
        
        # Try to give more specific guidance
        if "insufficient" in str(e).lower():
            print("\n⚠️  Looks like insufficient balance")
        elif "api" in str(e).lower():
            print("\n⚠️  API connection issue - check network")

if __name__ == "__main__":
    main()
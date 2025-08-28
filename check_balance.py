#!/usr/bin/env python3
"""
Check Hyperliquid account balance using Python SDK
"""

import os
from eth_account import Account
from hyperliquid.info import Info
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

def main():
    print("💰 Checking Hyperliquid Balance (Python)\n")
    print("=" * 40, "\n")
    
    # Get private key
    private_key = os.getenv("PRIVATE_KEY")
    if not private_key:
        print("❌ PRIVATE_KEY not found in .env file")
        return
    
    try:
        # Create account from private key
        account = Account.from_key(private_key)
        print(f"📱 Wallet Address: {account.address}")
        
        # Initialize Info API
        info = Info(skip_ws=True)
        
        # Get user state
        print("\n📊 Fetching account state...")
        user_state = info.user_state(account.address)
        
        if user_state:
            # Display balance info
            if "marginSummary" in user_state:
                margin = user_state["marginSummary"]
                print("\n💵 Account Summary:")
                print(f"   Account Value: ${float(margin['accountValue']):.2f}")
                print(f"   Total Position: ${float(margin.get('totalNtlPos', 0)):.2f}")
                print(f"   Total Margin Used: ${float(margin.get('totalMarginUsed', 0)):.2f}")
                print(f"   Total Raw USD: ${float(margin.get('totalRawUsd', 0)):.2f}")
            
            if "crossMarginSummary" in user_state:
                cross = user_state["crossMarginSummary"]
                print(f"\n📊 Cross Margin:")
                print(f"   Account Value: ${float(cross['accountValue']):.2f}")
                
            withdrawable = user_state.get("withdrawable", "0")
            print(f"\n💰 Withdrawable: ${float(withdrawable):.2f}")
            
            # Check positions
            if "assetPositions" in user_state:
                positions = user_state["assetPositions"]
                active = [p for p in positions if float(p["position"]["szi"]) != 0]
                
                if active:
                    print(f"\n📈 Active Positions ({len(active)}):")
                    total_pnl = 0
                    for pos in active:
                        coin = pos["position"]["coin"]
                        size = float(pos["position"]["szi"])
                        side = "LONG" if size > 0 else "SHORT"
                        entry = float(pos["position"]["entryPx"])
                        pnl = float(pos["position"].get("unrealizedPnl", 0))
                        total_pnl += pnl
                        
                        print(f"   {coin}: {side} {abs(size):.4f} @ ${entry:.2f} | PnL: ${pnl:.2f}")
                    
                    print(f"\n   Total PnL: ${total_pnl:.2f}")
                else:
                    print("\n📭 No active positions")
            
            # Also check open orders
            open_orders = info.open_orders(account.address)
            if open_orders:
                print(f"\n📋 Open Orders ({len(open_orders)}):")
                for order in open_orders:
                    print(f"   {order['coin']}: {order['side']} {order['sz']} @ ${order['limitPx']}")
            
            print("\n✅ Balance check complete!")
            
        else:
            print("❌ No account data returned")
            print("   Your wallet may not be registered on Hyperliquid")
            
    except Exception as e:
        print(f"\n❌ Error: {str(e)}")
        print("\n💡 Make sure:")
        print("1. Your private key is correct")
        print("2. You have deposited USDC to Hyperliquid L2")
        print("3. Your wallet address matches where you deposited")

if __name__ == "__main__":
    main()
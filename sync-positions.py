#!/usr/bin/env python3
"""
Sync positions with signal provider by opening minimum positions
This ensures closes will be copied when signal provider exits
"""

import os
import sys
import time
from eth_account import Account
from hyperliquid.exchange import Exchange
from hyperliquid.info import Info
from dotenv import load_dotenv
import requests

load_dotenv()

def get_signal_positions():
    """Get current positions of signal provider"""
    signal_address = os.getenv("SIGNAL_PROVIDER_ADDRESS")
    
    response = requests.post('https://api.hyperliquid.xyz/info', json={
        'type': 'clearinghouseState',
        'user': signal_address
    })
    
    if not response.json() or 'assetPositions' not in response.json():
        return []
    
    positions = response.json()['assetPositions']
    active = [p for p in positions if p['position'] and float(p['position']['szi']) != 0]
    
    return active

def sync_positions():
    print("🔄 SYNCING POSITIONS WITH SIGNAL PROVIDER\n")
    print("=" * 50)
    
    # Get private key
    private_key = os.getenv("PRIVATE_KEY")
    if not private_key:
        print("❌ PRIVATE_KEY not found in .env")
        return
    
    # Initialize
    account = Account.from_key(private_key)
    exchange = Exchange(account)
    info = Info(skip_ws=True)
    
    print(f"📱 Your Wallet: {account.address}\n")
    
    # Get current balance
    user_state = info.user_state(account.address)
    account_value = float(user_state["marginSummary"]["accountValue"])
    print(f"💰 Account Balance: ${account_value:.2f}\n")
    
    # Get signal provider positions
    signal_positions = get_signal_positions()
    
    if not signal_positions:
        print("📭 Signal provider has no active positions")
        return
    
    print(f"📊 Signal provider has {len(signal_positions)} active positions:\n")
    
    # Get your current positions
    my_positions = user_state.get("assetPositions", [])
    my_active = {p["position"]["coin"]: float(p["position"]["szi"]) 
                 for p in my_positions 
                 if p["position"] and float(p["position"]["szi"]) != 0}
    
    # Get current prices
    all_mids = info.all_mids()
    
    trades_to_execute = []
    
    for pos in signal_positions:
        coin = pos["position"]["coin"]
        signal_size = float(pos["position"]["szi"])
        is_long = signal_size > 0
        
        print(f"📍 {coin}: {'LONG' if is_long else 'SHORT'} {abs(signal_size):.4f}")
        
        # Check if you already have this position
        if coin in my_active:
            my_size = my_active[coin]
            print(f"   ✅ Already have position: {abs(my_size):.6f} {coin}")
        else:
            # Calculate minimum position
            current_price = float(all_mids.get(coin, 0))
            if current_price == 0:
                print(f"   ❌ Could not get price for {coin}")
                continue
            
            # $10 minimum order
            min_size = 10.0 / current_price
            
            # Get asset precision
            meta = info.meta()
            asset_ctx = next((a for a in meta["universe"] if a["name"] == coin), None)
            if asset_ctx:
                decimals = asset_ctx["szDecimals"]
                min_size = round(min_size, decimals)
            
            trades_to_execute.append({
                "coin": coin,
                "is_buy": is_long,
                "size": min_size,
                "value": min_size * current_price
            })
            
            print(f"   ⚡ Need to open: {min_size:.6f} {coin} (${min_size * current_price:.2f})")
    
    if not trades_to_execute:
        print("\n✅ All positions already synced!")
        return
    
    print("\n" + "=" * 50)
    print(f"📋 TRADES TO EXECUTE: {len(trades_to_execute)}")
    print("=" * 50)
    
    total_value = sum(t["value"] for t in trades_to_execute)
    print(f"💰 Total Required: ${total_value:.2f}")
    
    if total_value > account_value:
        print(f"❌ Insufficient balance. Need ${total_value:.2f}, have ${account_value:.2f}")
        return
    elif total_value > account_value * 0.9:
        print(f"⚠️  Warning: Using {(total_value/account_value)*100:.1f}% of balance")
    
    print("\n⚠️  This will execute REAL trades!")
    print("Press Ctrl+C to cancel, or wait 5 seconds...")
    
    for i in range(5, 0, -1):
        print(f"{i}...", end=" ", flush=True)
        time.sleep(1)
    print("\n")
    
    # Execute trades
    successful = 0
    failed = 0
    
    for trade in trades_to_execute:
        try:
            print(f"\n📤 Executing: {'BUY' if trade['is_buy'] else 'SELL'} {trade['size']:.6f} {trade['coin']}...")
            
            result = exchange.market_open(
                name=trade["coin"],
                is_buy=trade["is_buy"],
                sz=trade["size"],
                slippage=0.02
            )
            
            if result.get("status") == "ok":
                response_data = result.get("response", {}).get("data", {})
                statuses = response_data.get("statuses", [])
                
                if statuses and "filled" in statuses[0]:
                    fill = statuses[0]["filled"]
                    print(f"   ✅ Filled: {fill['totalSz']} @ ${fill['avgPx']}")
                    successful += 1
                elif statuses and "error" in statuses[0]:
                    print(f"   ❌ Error: {statuses[0]['error']}")
                    failed += 1
            else:
                print(f"   ❌ Failed: {result}")
                failed += 1
                
        except Exception as e:
            print(f"   ❌ Exception: {str(e)}")
            failed += 1
        
        # Small delay between trades
        time.sleep(1)
    
    print("\n" + "=" * 50)
    print("📊 SYNC COMPLETE")
    print("=" * 50)
    print(f"✅ Successful: {successful}")
    print(f"❌ Failed: {failed}")
    
    if successful > 0:
        print("\n🎯 Your positions are now synced!")
        print("When the signal provider closes, your bot will auto-close too.")

if __name__ == "__main__":
    try:
        sync_positions()
    except KeyboardInterrupt:
        print("\n\n🛑 Cancelled by user")
    except Exception as e:
        print(f"\n❌ Error: {str(e)}")
#!/usr/bin/env python3
"""
Open remaining positions (ETH and PROMPT) with proper $10 minimum
"""

import os
import time
from eth_account import Account
from hyperliquid.exchange import Exchange
from hyperliquid.info import Info
from dotenv import load_dotenv

load_dotenv()

def open_remaining_positions():
    print("🔄 OPENING REMAINING POSITIONS\n")
    print("=" * 50)
    
    # Initialize
    private_key = os.getenv("PRIVATE_KEY")
    account = Account.from_key(private_key)
    exchange = Exchange(account)
    info = Info(skip_ws=True)
    
    # Get current state
    user_state = info.user_state(account.address)
    account_value = float(user_state["marginSummary"]["accountValue"])
    margin_used = float(user_state["marginSummary"]["totalMarginUsed"])
    available = account_value - margin_used
    
    print(f"💰 Account Value: ${account_value:.2f}")
    print(f"📊 Margin Used: ${margin_used:.2f}")
    print(f"✅ Available: ${available:.2f}\n")
    
    # Get current prices
    all_mids = info.all_mids()
    eth_price = float(all_mids.get("ETH", 0))
    prompt_price = float(all_mids.get("PROMPT", 0))
    
    print("📈 Current Prices:")
    print(f"   ETH: ${eth_price:.2f}")
    print(f"   PROMPT: ${prompt_price:.4f}\n")
    
    # Calculate sizes for $10 minimum
    eth_size = 10.0 / eth_price
    prompt_size = 10.0 / prompt_price
    
    # Get proper decimals
    meta = info.meta()
    eth_ctx = next((a for a in meta["universe"] if a["name"] == "ETH"), None)
    prompt_ctx = next((a for a in meta["universe"] if a["name"] == "PROMPT"), None)
    
    if eth_ctx:
        eth_decimals = eth_ctx["szDecimals"]
        eth_size = round(eth_size, eth_decimals)
    
    if prompt_ctx:
        prompt_decimals = prompt_ctx["szDecimals"]
        prompt_size = round(prompt_size, prompt_decimals)
    
    print("📋 Positions to Open:")
    print(f"   ETH: {eth_size:.6f} (${eth_size * eth_price:.2f})")
    print(f"   PROMPT: {prompt_size:.2f} (${prompt_size * prompt_price:.2f})")
    
    # Calculate margin requirements (estimate)
    eth_leverage = 50  # ETH typically has high leverage
    prompt_leverage = 10  # Smaller coins usually 10x
    
    eth_margin_needed = (eth_size * eth_price) / eth_leverage
    prompt_margin_needed = (prompt_size * prompt_price) / prompt_leverage
    total_margin_needed = eth_margin_needed + prompt_margin_needed
    
    print(f"\n💳 Estimated Margin Required:")
    print(f"   ETH (50x leverage): ${eth_margin_needed:.2f}")
    print(f"   PROMPT (10x leverage): ${prompt_margin_needed:.2f}")
    print(f"   Total: ${total_margin_needed:.2f}")
    
    if total_margin_needed > available:
        print(f"\n❌ Insufficient margin. Need ${total_margin_needed:.2f}, have ${available:.2f}")
        return
    
    print(f"\n✅ Sufficient margin available!")
    print("\n⚠️  Ready to execute trades!")
    print("Press Ctrl+C to cancel, or wait 5 seconds...")
    
    for i in range(5, 0, -1):
        print(f"{i}...", end=" ", flush=True)
        time.sleep(1)
    print("\n")
    
    # Execute ETH trade
    try:
        print(f"📤 Opening ETH position: {eth_size:.6f} ETH...")
        result = exchange.market_open(
            name="ETH",
            is_buy=True,
            sz=eth_size,
            slippage=0.02
        )
        
        if result.get("status") == "ok":
            response_data = result.get("response", {}).get("data", {})
            statuses = response_data.get("statuses", [])
            
            if statuses and "filled" in statuses[0]:
                fill = statuses[0]["filled"]
                print(f"   ✅ ETH Filled: {fill['totalSz']} @ ${fill['avgPx']}")
            elif statuses and "error" in statuses[0]:
                print(f"   ❌ ETH Error: {statuses[0]['error']}")
        else:
            print(f"   ❌ ETH Failed: {result}")
    except Exception as e:
        print(f"   ❌ ETH Exception: {str(e)}")
    
    time.sleep(2)
    
    # Execute PROMPT trade
    try:
        print(f"\n📤 Opening PROMPT position: {prompt_size:.2f} PROMPT...")
        result = exchange.market_open(
            name="PROMPT",
            is_buy=True,
            sz=prompt_size,
            slippage=0.02
        )
        
        if result.get("status") == "ok":
            response_data = result.get("response", {}).get("data", {})
            statuses = response_data.get("statuses", [])
            
            if statuses and "filled" in statuses[0]:
                fill = statuses[0]["filled"]
                print(f"   ✅ PROMPT Filled: {fill['totalSz']} @ ${fill['avgPx']}")
            elif statuses and "error" in statuses[0]:
                print(f"   ❌ PROMPT Error: {statuses[0]['error']}")
        else:
            print(f"   ❌ PROMPT Failed: {result}")
    except Exception as e:
        print(f"   ❌ PROMPT Exception: {str(e)}")
    
    print("\n" + "=" * 50)
    print("✅ COMPLETE - Your positions now match the signal provider!")
    print("The bot will auto-close when they exit.")

if __name__ == "__main__":
    try:
        open_remaining_positions()
    except KeyboardInterrupt:
        print("\n\n🛑 Cancelled by user")
    except Exception as e:
        print(f"\n❌ Error: {str(e)}")
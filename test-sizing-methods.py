#!/usr/bin/env python3
"""
Test different sizing methods with current account balance
"""

import os
from dotenv import load_dotenv
from src.trade_executor import TradeExecutor

load_dotenv()

def test_sizing_methods():
    print("🧮 Testing Different Sizing Methods")
    print("=" * 50)
    
    executor = TradeExecutor()
    current_balance = executor.get_account_balance()
    
    print(f"💰 Current Account Balance: ${current_balance:.2f}")
    
    # Test coin and signal
    test_coin = "SOL"
    signal_size = 15000  # Large signal like current provider
    
    # Get current price
    all_mids = executor.info.all_mids()
    current_price = float(all_mids[test_coin])
    print(f"📈 {test_coin} Price: ${current_price:.2f}")
    
    print("\n🔍 Sizing Method Comparison:")
    print("-" * 50)
    
    # Test different percentages
    percentages = [0.1, 0.2, 0.3, 0.5]  # 10%, 20%, 30%, 50%
    
    for pct in percentages:
        # Simulate wallet_percentage method
        order_value = current_balance * pct
        size = order_value / current_price
        
        # Apply minimum order value
        if order_value < 10:
            order_value = 10
            size = order_value / current_price
            
        print(f"📊 {pct*100:2.0f}% of wallet: ${order_value:6.2f} = {size:.6f} {test_coin}")
    
    print("\n" + "-" * 50)
    print("💡 Recommendations for your $44.51 balance:")
    print("   • 10% = $4.45 ➔ Use minimum $10 (22% of wallet)")
    print("   • 20% = $8.90 ➔ Use minimum $10 (22% of wallet)")  
    print("   • 30% = $13.35 ➔ Actual 30% of wallet")
    print("   • 50% = $22.26 ➔ Actual 50% of wallet")
    
    print(f"\n⚙️  Current setting: WALLET_PERCENTAGE={os.getenv('WALLET_PERCENTAGE', '0.2')}")
    print(f"   This means: ${float(os.getenv('WALLET_PERCENTAGE', '0.2')) * current_balance:.2f} per trade")

if __name__ == "__main__":
    test_sizing_methods()
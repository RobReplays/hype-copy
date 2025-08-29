#!/usr/bin/env python3
"""
Analyze liquidation risk for different position sizes
"""

import os
from dotenv import load_dotenv
from src.trade_executor import TradeExecutor

load_dotenv()

def analyze_liquidation_risk():
    print("⚠️  LIQUIDATION RISK ANALYSIS")
    print("=" * 50)
    
    executor = TradeExecutor()
    current_balance = executor.get_account_balance()
    
    print(f"💰 Current Balance: ${current_balance:.2f}")
    
    # Get current prices for analysis
    all_mids = executor.info.all_mids()
    sol_price = float(all_mids.get("SOL", 210))
    eth_price = float(all_mids.get("ETH", 3200))
    
    print(f"📈 SOL Price: ${sol_price:.2f}")
    print(f"📈 ETH Price: ${eth_price:.2f}")
    
    print("\n🔍 SCENARIO ANALYSIS:")
    print("-" * 50)
    
    # Test different wallet percentages
    scenarios = [
        {"pct": 0.3, "name": "Conservative (30%)"},
        {"pct": 0.5, "name": "Moderate (50%)"},
        {"pct": 0.7, "name": "Aggressive (70%)"}
    ]
    
    for scenario in scenarios:
        pct = scenario["pct"]
        name = scenario["name"]
        
        print(f"\n📊 {name}")
        print("-" * 30)
        
        # Calculate position sizes
        position_value = current_balance * pct
        sol_size = position_value / sol_price
        
        print(f"   Position Value: ${position_value:.2f}")
        print(f"   SOL Size: {sol_size:.6f} SOL")
        
        # Hyperliquid uses cross-margin, so let's analyze total exposure
        if pct <= 0.3:
            max_positions = 3
        elif pct <= 0.5:
            max_positions = 2
        else:
            max_positions = 1
            
        total_exposure = position_value * max_positions
        remaining_balance = current_balance - total_exposure
        
        print(f"   Max Positions: {max_positions}")
        print(f"   Total Exposure: ${total_exposure:.2f}")
        print(f"   Remaining Cash: ${remaining_balance:.2f}")
        
        # Calculate liquidation scenarios
        # Hyperliquid typically liquidates around 90-95% loss on cross margin
        liquidation_threshold = current_balance * 0.05  # 5% remaining = liquidation
        
        # Calculate how much positions can lose before liquidation
        max_loss_before_liquidation = current_balance - liquidation_threshold
        loss_per_position = max_loss_before_liquidation / max_positions if max_positions > 0 else 0
        
        # Calculate price drop needed for liquidation
        if position_value > 0:
            loss_percentage = (loss_per_position / position_value) * 100
            price_drop_needed = min(loss_percentage, 95)  # Cap at 95% for realism
        else:
            price_drop_needed = 0
            
        print(f"   💥 Liquidation Risk:")
        print(f"      • Max total loss: ${max_loss_before_liquidation:.2f}")
        print(f"      • Loss per position: ${loss_per_position:.2f}")
        print(f"      • Price drop needed: {price_drop_needed:.1f}%")
        
        # Risk assessment
        if price_drop_needed > 80:
            risk_level = "🟢 LOW"
        elif price_drop_needed > 50:
            risk_level = "🟡 MEDIUM"
        else:
            risk_level = "🔴 HIGH"
            
        print(f"      • Risk Level: {risk_level}")
    
    print("\n" + "=" * 50)
    print("📋 LIQUIDATION PROTECTION SUMMARY:")
    print("=" * 50)
    
    print("🛡️  Hyperliquid Cross-Margin Benefits:")
    print("   • All positions share margin")
    print("   • Profitable trades offset losses")
    print("   • Only liquidated if total account < ~5%")
    
    print("\n⚠️  Key Risks:")
    print("   • Correlated moves (all crypto down together)")
    print("   • Large gap downs while sleeping")
    print("   • Following a bad signal provider")
    
    print("\n💡 Risk Management Tips:")
    print("   • Start with 30% max per position")
    print("   • Never use more than 70% total exposure") 
    print("   • Set stop-losses manually if needed")
    print("   • Monitor positions regularly")
    print("   • Consider the signal provider's track record")
    
    print(f"\n🎯 RECOMMENDED SETTING for ${current_balance:.2f}:")
    print("   WALLET_PERCENTAGE=0.3 (30% per trade)")
    print("   • Max 3 positions = 90% exposure")
    print("   • Requires 90%+ loss to liquidate")
    print("   • Reasonable risk/reward balance")

if __name__ == "__main__":
    analyze_liquidation_risk()
#!/usr/bin/env python3
"""
Test Hyperliquid Python SDK methods to find correct API
"""

import os
from eth_account import Account
from hyperliquid.exchange import Exchange
from hyperliquid.info import Info
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

def main():
    print("🔧 Testing Hyperliquid SDK Methods\n")
    
    private_key = os.getenv("PRIVATE_KEY")
    account = Account.from_key(private_key)
    
    try:
        # Initialize exchange
        exchange = Exchange(account)
        
        # Check available methods
        print("📋 Exchange methods:")
        methods = [method for method in dir(exchange) if not method.startswith('_')]
        for method in sorted(methods):
            print(f"   {method}")
        
        print("\n🔍 Looking for market order methods...")
        market_methods = [m for m in methods if 'market' in m.lower()]
        for method in market_methods:
            try:
                func = getattr(exchange, method)
                if callable(func):
                    print(f"   ✓ {method} - {func.__doc__ or 'No docs'}")
            except:
                pass
                
        print("\n🔍 Looking for order methods...")
        order_methods = [m for m in methods if 'order' in m.lower()]
        for method in order_methods:
            try:
                func = getattr(exchange, method)
                if callable(func):
                    print(f"   ✓ {method} - {func.__doc__ or 'No docs'}")
            except:
                pass
        
        # Try to inspect market_open if it exists
        if hasattr(exchange, 'market_open'):
            import inspect
            sig = inspect.signature(exchange.market_open)
            print(f"\n📝 market_open signature: {sig}")
            
    except Exception as e:
        print(f"❌ Error: {e}")

if __name__ == "__main__":
    main()
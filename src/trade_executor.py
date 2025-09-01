#!/usr/bin/env python3
"""
Hyperliquid Trade Executor for Copy Trading Bot
Handles actual trade execution called from JavaScript bot
"""

import os
import sys
import json
import argparse
from eth_account import Account
from hyperliquid.exchange import Exchange
from hyperliquid.info import Info
from dotenv import load_dotenv

class TradeExecutor:
    def __init__(self):
        load_dotenv()
        
        # Initialize account
        private_key = os.getenv("PRIVATE_KEY")
        if not private_key:
            raise ValueError("PRIVATE_KEY not found in environment")
            
        self.account = Account.from_key(private_key)
        self.exchange = Exchange(self.account)
        self.info = Info(skip_ws=True)
        
        # Config from environment
        self.sizing_method = os.getenv("SIZING_METHOD", "fixed_ratio")
        self.account_ratio = float(os.getenv("ACCOUNT_RATIO", 0.1))
        self.max_position_size = float(os.getenv("MAX_POSITION_SIZE", 10))
        
        # Minimum order value for Hyperliquid
        self.min_order_value = 10.0
        
    def get_account_balance(self):
        """Get current account balance"""
        try:
            user_state = self.info.user_state(self.account.address)
            if user_state and "marginSummary" in user_state:
                return float(user_state["marginSummary"]["accountValue"])
            return 0.0
        except Exception as e:
            print(f"Error getting balance: {e}")
            return 0.0
    
    def calculate_position_size(self, signal_size, current_price):
        """Calculate position size based on signal and configuration"""
        # Get current account balance for wallet-based sizing
        account_balance = self.get_account_balance()
        
        # Apply sizing method
        if self.sizing_method == "fixed_ratio":
            # Original method: fixed percentage of signal size
            my_size = abs(signal_size) * self.account_ratio
        elif self.sizing_method == "fixed_size":
            # Fixed number of units
            fixed_size = float(os.getenv("FIXED_SIZE", 1.0))
            my_size = fixed_size
        elif self.sizing_method == "wallet_percentage":
            # NEW: Percentage of account balance
            wallet_percentage = float(os.getenv("WALLET_PERCENTAGE", 0.1))  # Default 10%
            order_value = account_balance * wallet_percentage
            my_size = order_value / current_price
        elif self.sizing_method == "wallet_fixed":
            # NEW: Fixed dollar amount from wallet
            fixed_dollars = float(os.getenv("WALLET_FIXED_AMOUNT", 10.0))
            # Cap at available balance
            order_value = min(fixed_dollars, account_balance * 0.9)  # Leave 10% buffer
            my_size = order_value / current_price
        else:
            # Default to fixed_ratio
            my_size = abs(signal_size) * self.account_ratio
        
        # Apply max position size cap (only for non-wallet methods)
        if self.sizing_method not in ["wallet_percentage", "wallet_fixed"]:
            max_size_in_units = self.max_position_size / current_price
            if my_size > max_size_in_units:
                my_size = max_size_in_units
        
        # Check minimum order value
        order_value = my_size * current_price
        if order_value < self.min_order_value:
            # For wallet-based methods, respect minimum
            min_size = self.min_order_value / current_price
            my_size = min_size
            
        # Final safety check: don't exceed 90% of account balance
        final_order_value = my_size * current_price
        max_safe_value = account_balance * 0.9
        if final_order_value > max_safe_value:
            my_size = max_safe_value / current_price
            
        return my_size
    
    def get_asset_precision(self, coin):
        """Get asset precision for proper rounding"""
        try:
            meta = self.info.meta()
            asset_ctx = next((a for a in meta["universe"] if a["name"] == coin), None)
            if asset_ctx:
                return asset_ctx["szDecimals"]
            return 6  # Default precision
        except:
            return 6
    
    def execute_market_order(self, coin, is_buy, size, action_type="OPEN"):
        """Execute a market order"""
        try:
            # Get current price
            all_mids = self.info.all_mids()
            if coin not in all_mids:
                return {"success": False, "error": f"Coin {coin} not found in markets"}
            
            current_price = float(all_mids[coin])
            
            # Calculate proper size
            if action_type == "OPEN":
                calculated_size = self.calculate_position_size(size, current_price)
            elif action_type == "CLOSE":
                # For close, use exact position size without ratio calculation
                calculated_size = abs(size)
            else:
                # For modify, use ratio but don't check minimum order value
                calculated_size = abs(size) * self.account_ratio
            
            # Round to proper precision
            precision = self.get_asset_precision(coin)
            rounded_size = round(calculated_size, precision)
            
            # Check minimum order value (skip for CLOSE)
            order_value = rounded_size * current_price
            if action_type != "CLOSE" and order_value < self.min_order_value:
                return {
                    "success": False, 
                    "error": f"Order value ${order_value:.2f} below minimum ${self.min_order_value}",
                    "skipped": True
                }
            
            # Check account balance (skip for CLOSE since we're selling)
            if action_type != "CLOSE" and is_buy:
                balance = self.get_account_balance()
                if balance < order_value:
                    return {
                        "success": False,
                        "error": f"Insufficient balance. Need ${order_value:.2f}, have ${balance:.2f}"
                    }
            
            # Execute the order (debug output goes to stderr to avoid JSON parsing issues)
            import sys
            print(f"Executing: {'BUY' if is_buy else 'SELL'} {rounded_size:.6f} {coin} @ ${current_price:.2f}", file=sys.stderr)
            
            # For all orders, use market_open with appropriate direction
            result = self.exchange.market_open(
                name=coin,
                is_buy=is_buy,
                sz=rounded_size,
                slippage=0.02  # 2% slippage
            )
            
            # Parse result
            if result.get("status") == "ok":
                response_data = result.get("response", {}).get("data", {})
                statuses = response_data.get("statuses", [])
                
                if statuses and "filled" in statuses[0]:
                    fill_data = statuses[0]["filled"]
                    return {
                        "success": True,
                        "filled_size": fill_data["totalSz"],
                        "avg_price": fill_data["avgPx"],
                        "order_id": fill_data["oid"],
                        "calculated_size": rounded_size,
                        "order_value": order_value
                    }
                elif statuses and "error" in statuses[0]:
                    return {
                        "success": False,
                        "error": statuses[0]["error"]
                    }
            
            return {"success": False, "error": "Unknown order result", "raw_result": result}
            
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def copy_trade(self, signal_coin, signal_size, action_type):
        """Execute a copy trade based on signal"""
        # For modifications, signal_size is already the modification amount
        # For new/close, it's the full position size
        
        if action_type == "OPEN":
            # New position - buy/sell based on direction
            is_buy = signal_size > 0
            return self.execute_market_order(signal_coin, is_buy, abs(signal_size), action_type)
        elif action_type == "INCREASE":
            # Increase existing position - same direction as current
            # Need to check our current position direction
            user_state = self.info.user_state(self.account.address)
            positions = user_state.get("assetPositions", [])
            my_pos = next((p for p in positions if p["position"]["coin"] == signal_coin), None)
            
            if my_pos and float(my_pos["position"]["szi"]) != 0:
                is_buy = float(my_pos["position"]["szi"]) > 0
            else:
                # No position, treat as new
                is_buy = signal_size > 0
            
            return self.execute_market_order(signal_coin, is_buy, abs(signal_size), action_type)
        elif action_type == "DECREASE":
            # Decrease position - opposite direction to current
            user_state = self.info.user_state(self.account.address)
            positions = user_state.get("assetPositions", [])
            my_pos = next((p for p in positions if p["position"]["coin"] == signal_coin), None)
            
            if my_pos and float(my_pos["position"]["szi"]) != 0:
                is_buy = float(my_pos["position"]["szi"]) < 0  # Opposite
            else:
                return {"success": False, "error": "No position to decrease"}
            
            return self.execute_market_order(signal_coin, is_buy, abs(signal_size), action_type)
        elif action_type == "CLOSE":
            # Close entire position - opposite direction to current
            user_state = self.info.user_state(self.account.address)
            positions = user_state.get("assetPositions", [])
            my_pos = next((p for p in positions if p["position"]["coin"] == signal_coin), None)
            
            if my_pos and float(my_pos["position"]["szi"]) != 0:
                is_buy = float(my_pos["position"]["szi"]) < 0  # Opposite
            else:
                return {"success": False, "error": "No position to close", "skipped": True}
            
            return self.execute_market_order(signal_coin, is_buy, abs(signal_size), action_type)
        else:
            return {"success": False, "error": f"Unknown action type: {action_type}"}

def main():
    parser = argparse.ArgumentParser(description='Execute Hyperliquid trades')
    parser.add_argument('coin', help='Coin symbol (e.g., SOL, ETH)')
    parser.add_argument('size', type=float, help='Signal size (positive=long, negative=short)')
    parser.add_argument('action', choices=['OPEN', 'CLOSE', 'INCREASE', 'DECREASE'], help='Trade action')
    parser.add_argument('--dry-run', action='store_true', help='Show what would be executed without trading')
    
    args = parser.parse_args()
    
    try:
        executor = TradeExecutor()
        
        if args.dry_run:
            # Just show what would happen
            all_mids = executor.info.all_mids()
            current_price = float(all_mids[args.coin])
            calculated_size = executor.calculate_position_size(args.size, current_price)
            precision = executor.get_asset_precision(args.coin)
            rounded_size = round(calculated_size, precision)
            order_value = rounded_size * current_price
            
            result = {
                "dry_run": True,
                "coin": args.coin,
                "signal_size": args.size,
                "calculated_size": rounded_size,
                "current_price": current_price,
                "order_value": order_value,
                "action": args.action,
                "would_execute": order_value >= executor.min_order_value
            }
        else:
            # Execute actual trade
            result = executor.copy_trade(args.coin, args.size, args.action)
        
        # Output result as JSON for JavaScript to parse
        print(json.dumps(result, indent=2))
        
        # Exit with error code if trade failed
        if not result.get("success", False) and not result.get("dry_run", False):
            sys.exit(1)
            
    except Exception as e:
        error_result = {"success": False, "error": str(e)}
        print(json.dumps(error_result, indent=2))
        sys.exit(1)

if __name__ == "__main__":
    main()
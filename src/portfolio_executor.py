#!/usr/bin/env python3
"""
Portfolio Rebalancing Executor for Hyperliquid
Handles setting positions to specific target values
"""

import os
import sys
import json
import argparse
from eth_account import Account
from hyperliquid.exchange import Exchange
from hyperliquid.info import Info
from dotenv import load_dotenv

class PortfolioExecutor:
    def __init__(self):
        load_dotenv()
        
        private_key = os.getenv("PRIVATE_KEY")
        if not private_key:
            raise ValueError("PRIVATE_KEY not found")
            
        self.account = Account.from_key(private_key)
        self.exchange = Exchange(self.account)
        self.info = Info(skip_ws=True)
        self.min_order_value = 10.0
        
    def get_current_position(self, coin):
        """Get current position for a coin"""
        try:
            user_state = self.info.user_state(self.account.address)
            positions = user_state.get("assetPositions", [])
            
            for pos in positions:
                if pos["position"]["coin"] == coin:
                    return {
                        "size": float(pos["position"]["szi"]),
                        "value": abs(float(pos["position"]["szi"])) * float(pos["position"]["markPx"] or 0)
                    }
            return {"size": 0, "value": 0}
        except Exception as e:
            print(f"Error getting position: {e}", file=sys.stderr)
            return {"size": 0, "value": 0}
    
    def rebalance_position(self, coin, target_value, current_price, is_long):
        """Rebalance position to target value"""
        try:
            # Get current position
            current_pos = self.get_current_position(coin)
            current_size = current_pos["size"]
            current_value = current_pos["value"]
            
            print(f"Current {coin}: {current_size:.6f} units, ${current_value:.2f}", file=sys.stderr)
            print(f"Target value: ${target_value:.2f}", file=sys.stderr)
            
            # Calculate target size
            target_size = target_value / current_price if target_value > 0 else 0
            if is_long:
                target_size = abs(target_size)
            else:
                target_size = -abs(target_size)
            
            # Calculate size difference
            size_diff = target_size - current_size
            
            # Determine action
            if abs(target_value) < self.min_order_value and current_size != 0:
                # Close position if target is below minimum
                print(f"Closing position (below minimum)", file=sys.stderr)
                action_size = abs(current_size)
                is_buy = current_size < 0  # Opposite to close
                action_type = "CLOSE"
                
            elif abs(size_diff * current_price) < self.min_order_value:
                # Difference too small, skip
                return {
                    "success": False,
                    "error": f"Change too small: ${abs(size_diff * current_price):.2f} < ${self.min_order_value}",
                    "skipped": True
                }
                
            else:
                # Rebalance position
                action_size = abs(size_diff)
                
                if current_size == 0:
                    # Open new position
                    is_buy = is_long
                    action_type = "OPEN"
                elif abs(size_diff) >= abs(current_size) * 0.9:
                    # Close and reopen if changing direction or size change is huge
                    # First close existing
                    close_result = self.exchange.market_open(
                        name=coin,
                        is_buy=current_size < 0,
                        sz=abs(current_size),
                        slippage=0.02
                    )
                    print(f"Closed existing position: {close_result}", file=sys.stderr)
                    
                    # Then open new position if target > 0
                    if target_value >= self.min_order_value:
                        action_size = abs(target_size)
                        is_buy = is_long
                        action_type = "OPEN"
                    else:
                        return {
                            "success": True,
                            "action": "CLOSED",
                            "executed_size": 0,
                            "avg_price": current_price,
                            "position_value": 0
                        }
                else:
                    # Adjust existing position
                    is_buy = size_diff > 0
                    action_type = "ADJUST"
            
            # Execute the trade
            print(f"Executing {action_type}: {'BUY' if is_buy else 'SELL'} {action_size:.6f} {coin}", file=sys.stderr)
            
            result = self.exchange.market_open(
                name=coin,
                is_buy=is_buy,
                sz=action_size,
                slippage=0.02
            )
            
            if result.get("status") == "ok":
                response_data = result.get("response", {}).get("data", {})
                statuses = response_data.get("statuses", [])
                
                if statuses and "filled" in statuses[0]:
                    fill_data = statuses[0]["filled"]
                    
                    # Calculate new position value
                    if action_type == "CLOSE":
                        new_position_value = 0
                    else:
                        new_position_value = target_value
                    
                    return {
                        "success": True,
                        "action": action_type,
                        "executed_size": fill_data["totalSz"],
                        "avg_price": fill_data["avgPx"],
                        "position_value": new_position_value,
                        "order_id": fill_data["oid"]
                    }
                elif statuses and "error" in statuses[0]:
                    return {
                        "success": False,
                        "error": statuses[0]["error"]
                    }
            
            return {
                "success": False,
                "error": "Unknown order result",
                "raw_result": result
            }
            
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }

def main():
    parser = argparse.ArgumentParser(description='Portfolio rebalancing executor')
    parser.add_argument('coin', help='Coin symbol')
    parser.add_argument('target_value', type=float, help='Target position value in USD')
    parser.add_argument('current_price', type=float, help='Current coin price')
    parser.add_argument('direction', choices=['LONG', 'SHORT'], help='Position direction')
    
    args = parser.parse_args()
    
    try:
        executor = PortfolioExecutor()
        result = executor.rebalance_position(
            args.coin,
            args.target_value,
            args.current_price,
            args.direction == 'LONG'
        )
        
        print(json.dumps(result, indent=2))
        
        if not result.get("success", False) and not result.get("skipped", False):
            sys.exit(1)
            
    except Exception as e:
        error_result = {"success": False, "error": str(e)}
        print(json.dumps(error_result, indent=2))
        sys.exit(1)

if __name__ == "__main__":
    main()
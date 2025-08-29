#!/usr/bin/env python3
"""
Position limiter to prevent overexposure from scaled entries
"""

import os
from datetime import datetime, timedelta

class PositionLimiter:
    def __init__(self):
        # Configuration
        self.max_trades_per_coin_per_hour = int(os.getenv("MAX_TRADES_PER_COIN_HOURLY", 3))
        self.max_position_percent = float(os.getenv("MAX_POSITION_PERCENT", 0.25))  # 25% max per coin
        self.min_time_between_trades = int(os.getenv("MIN_SECONDS_BETWEEN_TRADES", 30))
        
        # Tracking
        self.trade_history = {}  # coin -> list of timestamps
        self.last_trade_time = {}  # coin -> timestamp
        self.position_values = {}  # coin -> current value
        
    def should_allow_trade(self, coin, trade_value, account_balance):
        """
        Check if trade should be allowed based on limits
        """
        current_time = datetime.now()
        
        # Check 1: Time since last trade
        if coin in self.last_trade_time:
            seconds_since_last = (current_time - self.last_trade_time[coin]).total_seconds()
            if seconds_since_last < self.min_time_between_trades:
                print(f"⏳ Blocking {coin} trade - only {seconds_since_last:.0f}s since last trade (min: {self.min_time_between_trades}s)")
                return False
        
        # Check 2: Trades per hour limit
        if coin in self.trade_history:
            # Remove old trades (> 1 hour)
            one_hour_ago = current_time - timedelta(hours=1)
            self.trade_history[coin] = [t for t in self.trade_history[coin] if t > one_hour_ago]
            
            if len(self.trade_history[coin]) >= self.max_trades_per_coin_per_hour:
                print(f"🚫 Blocking {coin} trade - reached {self.max_trades_per_coin_per_hour} trades/hour limit")
                return False
        
        # Check 3: Position size limit
        current_position = self.position_values.get(coin, 0)
        new_total = current_position + trade_value
        max_allowed = account_balance * self.max_position_percent
        
        if new_total > max_allowed:
            print(f"⚠️ Blocking {coin} trade - would exceed {self.max_position_percent*100:.0f}% position limit")
            print(f"   Current: ${current_position:.2f}, New: ${trade_value:.2f}, Max: ${max_allowed:.2f}")
            return False
        
        # All checks passed
        return True
    
    def record_trade(self, coin, trade_value):
        """
        Record that a trade was executed
        """
        current_time = datetime.now()
        
        # Update last trade time
        self.last_trade_time[coin] = current_time
        
        # Add to history
        if coin not in self.trade_history:
            self.trade_history[coin] = []
        self.trade_history[coin].append(current_time)
        
        # Update position value
        if coin not in self.position_values:
            self.position_values[coin] = 0
        self.position_values[coin] += trade_value
        
        print(f"✅ Recorded {coin} trade: ${trade_value:.2f} (total position: ${self.position_values[coin]:.2f})")
    
    def reset_position(self, coin):
        """
        Reset position tracking when closed
        """
        if coin in self.position_values:
            del self.position_values[coin]
        print(f"🔄 Reset {coin} position tracking")
    
    def get_stats(self):
        """
        Get current limiter statistics
        """
        stats = {
            "positions": self.position_values,
            "recent_trades": {},
            "blocked_coins": []
        }
        
        current_time = datetime.now()
        one_hour_ago = current_time - timedelta(hours=1)
        
        for coin, trades in self.trade_history.items():
            recent = [t for t in trades if t > one_hour_ago]
            stats["recent_trades"][coin] = len(recent)
            
            if len(recent) >= self.max_trades_per_coin_per_hour:
                stats["blocked_coins"].append(coin)
        
        return stats

# Global instance
limiter = PositionLimiter()
"""限流器基类。具体限流场景由服务侧实例化——限流策略属于业务决策。"""

from lib.ratelimit.base import FixedWindowLimiter

__all__ = ["FixedWindowLimiter"]

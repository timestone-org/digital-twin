"""ORM 模型。绑定 `realtime` schema，两张表都不含业务字段。"""

from realtime_hub.apps.channel.models.base import Base
from realtime_hub.apps.channel.models.subscription import Subscription
from realtime_hub.apps.channel.models.topic import TopicDeclaration

__all__ = ["Base", "Subscription", "TopicDeclaration"]

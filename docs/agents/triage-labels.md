# 分诊标签

skills 用五个标准分诊角色说话。这张表把角色映射到本仓 issue tracker 里实际使用的标签串。

| skills 中的角色    | 本仓实际标签      | 含义                       |
| ----------------- | ---------------- | ------------------------- |
| `needs-triage`    | `needs-triage`   | 需要维护者评估             |
| `needs-info`      | `needs-info`     | 等待报告者补充信息         |
| `ready-for-agent` | `ready-for-agent`| 规格完整，可交给 AFK agent |
| `ready-for-human` | `ready-for-human`| 需要人来实现               |
| `wontfix`         | `wontfix`        | 不予处理                   |

skill 提到某个角色时（例如"打上 AFK-ready 分诊标签"），用表中对应的标签串。

右列改成你实际在用的词表即可。**标签串本身保持英文**——`gh issue edit --add-label` 是按字面匹配的。

> 标签尚未在 GitHub 上创建。`gh issue edit --add-label` 遇到不存在的标签会直接失败，
> 不会降级处理，所以分诊类 skill 会在用到的那一刻报错。接上 remote 之后先把这五个
> 标签建出来；日后若在此表改名，也要先建新标签再改表。

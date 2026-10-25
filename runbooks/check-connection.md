---
when: checking that mini-op reaches the mini over ssh and that the mini's ~/apm matches this copy, changing nothing
---

# Check the connection to the mini

Read-only: neither step changes the mini or the container.

1. `ssh mini echo ok` prints `ok`. Anything else means ssh to the mini fails: report its error.
2. `/opt/windroc/plugins/mini-op/ctl/mini sync --check` prints `mini: in sync at <stamp>`. Exit 1 means the mini's copy is at another stamp or unreadable: report its message; this runbook copies nothing.

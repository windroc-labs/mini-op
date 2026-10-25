# Manager on the mini

Strata is a PC on the LAN with one slot: run at most one OpenCode manager and one OpenCode worker at a time (the user, 2026-10-21), and close both when a test ends.
0. Screen: only two windows, Terminal and Chrome; never move or resize one (`../README.md` › Rules). Close Chrome's extra "New Tab" window first, and every window a step no longer needs. The worker's pane needs to be wider than 37 columns: if the Terminal is narrower, tell the user rather than resizing it.
   Docker Desktop's first launch leaves a Containers window: use System Events, in process `Docker Desktop`, to click that window's button whose `subrole` is `AXCloseButton` (inspect the process/window names first). Docker keeps running. After every step check Terminal and Chrome for extra windows or tabs and close the extras. Terminal's AppleScript window list may keep closed windows with `tabs=0`; use the windows visible to System Events as the authority.
1. From the mini's Terminal: `mkdir -p ~/manager && source ~/.zprofile && ctmux mini`; in it `cd ~/manager && claude --model sonnet` (the user, 2026-10-21: the test manager runs Sonnet at most; never in the home directory). Trust `~/manager`, then `/ensemble:manage`.
2. Keep session `mini` attached in the visible Terminal and select the target pane before `tmux send-keys -t '=mini:' …`; verify the attachment with public `tmux list-clients`/pane state through `mini exec`. `tmux capture-pane -p -t '=mini:'` (`/opt/homebrew/bin/tmux`) is readback, not proof of visibility. Stop if the target is detached or covered; restore it visibly first. Secrets never go through send-keys. Keystrokes through System Events can land in another Terminal window. See `visible-operations.md`.
3. Its first start raises macOS folder prompts for Terminal (Downloads, Documents, Desktop, Photos): Don't Allow each (System Events: click button "Don’t Allow" in process UserNotificationCenter).

## OpenCode board runs on the tmux Host

Install and auth: `install-ensemble.md` › OpenCode-only install. For board roles using the mini's existing OpenCode credentials on the tmux Host, add this to the mini's `~/.ensemble/config.local.toml`. Create the role directories first through `mini exec`: `mkdir -p ~/mini-board-work/{researcher,pm,engineer}`. Keep this trust root outside the board's runtime/work directory; resolved real paths must match it. Ordinary board credentials/config still apply.

```toml
[session.hosts]
default = "tmux"

[delegate]
client = "opencode"
trusted_dirs = ["~/mini-board-work"]

[orchestrator.core.roles.researcher]
cwd = "~/mini-board-work/researcher"

[orchestrator.core.roles.researcher.output]
type = "orchestrator"

[orchestrator.core.roles.pm]
cwd = "~/mini-board-work/pm"

[orchestrator.core.roles.pm.output]
type = "orchestrator"

[orchestrator.core.roles.engineer]
cwd = "~/mini-board-work/engineer"
```

`trusted_dirs` belongs only under `[delegate]`; role run overlays reject it. Each `cwd` selects an existing trusted directory, letting that role use the Host's configured provider auth. The default board agent directory remains isolated; this explicit override chooses the trusted route. `type = "orchestrator"` sends researcher/pm reports through their outcomes for the board to save under `docs/<role>` and hand forward as file links; engineer keeps its pull-request output. Attach the actual role pane in the visible Terminal before sending work.

Verified against ensemble commit `1fc016e7f878ab197b6f73902795c9ab935b057c`: [delegate config](https://github.com/windroc-labs/ensemble/blob/1fc016e7f878ab197b6f73902795c9ab935b057c/delegate/src/ensemble/delegate/config.toml), [cwd/trust planner](https://github.com/windroc-labs/ensemble/blob/1fc016e7f878ab197b6f73902795c9ab935b057c/delegate/src/ensemble/delegate/engine/plan.py), [board role/output resolution](https://github.com/windroc-labs/ensemble/blob/1fc016e7f878ab197b6f73902795c9ab935b057c/orchestrator/src/ensemble/orchestrator/engine/config.py), [tmux Host config](https://github.com/windroc-labs/ensemble/blob/1fc016e7f878ab197b6f73902795c9ab935b057c/session/src/ensemble/session/config.toml).

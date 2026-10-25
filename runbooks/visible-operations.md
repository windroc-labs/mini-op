# mini 操作可视清单

来源：WDRC-156；覆盖 `mini/`、`ctl/`、全部 runbook 和 `host/README.md` 的 mini 端动作。主机上的容器构建、配置、代理和文件准备不在 mini 上执行。

**可视优先**：公开命令（文本和输出均已确认无秘密）用 `mini exec`，交互命令用 `mini run`，普通网页用 `o` 的 foreground。SSH（安全外壳协议）只负责传输、辅助控制、结果回读及下表有具体原因的例外。秘密只经 stdin（标准输入）或私有文件，网页秘密只经 `secfield`。不要把凭据命令、API 原始响应或未知第三方输出当公开命令。

| 操作 | 状态 | 路径与原因 |
| --- | --- | --- |
| `ctl/mini exec`、`mini/bin/visible` | visible now | Terminal 显示公开命令和输出；完整 stdout/stderr 分开捕获，原子 rc 回读；退出 0–255 不归一化 |
| `ctl/mini run`、`mini/bin/ans` 新命令和 `--to` 回答 | already visible | Terminal 输入、滚到底部；marker 判定结束；只在已确认关闭回显的密码提示回答秘密 |
| `mini/bin/termwait`、`visible --collect` | cannot be visible | 读取完成文件和已有结果属于机器回读；原命令已经可视，收集不能重新执行 |
| `terminal.js activate/front/bottom` | already visible | 激活、确认前台、滚到底部；不改窗口位置或尺寸 |
| `terminal.js history/contents`、`--all` | cannot be visible | 屏幕读回与秘密检查；通过 `termwait` 脱敏，不能把原始历史打印到 Terminal |
| `keys.js`、`click.js`、`ctl/mini chord`、`chord.applescript` | already visible | 前台键鼠；秘密仅 stdin、`--secret` 和已确认的隐藏提示；页面秘密走 secfield |
| `mini/bin/dialogs`、`dialogs.js` 列举/点击 | already visible | 对已显示的 macOS 窗口读按钮或点击；结构化回读供操作员判断 |
| `mini/bin/front`、`front.js`、`chrome.js activate/close` | already visible | 前台标签/窗口及关闭动作；避免把含秘密的页面带到前台 |
| `mini/bin/o` 普通 open/bind/state/eval/wait/click/type/tab/close 等 | visible now | 统一 `--window foreground`，拒绝直接 background；结果和退出状态原样回读；先读页面再动作 |
| `mini/bin/o --private`、`chrome.js hide` | cannot be visible | 认证邮件、密钥生成/复制、含 code 的跳转会泄密；先确认隐藏 Chrome，显式 background；秘密结果只送管道/文件，完成后留在安全页再恢复前台 |
| `mini/bin/secfield`、`page/field.js` | already visible | 真点击前掩码字段；确认页面/字段焦点及 password 类型，秘密仅 stdin；不把代码或密码打印出来 |
| `mini/bin/shot`、屏幕截图 scp 回传/缩图 | cannot be visible | 捕获和回传像素是读取通道；被捕获的桌面本来可见；有秘密或读不到 Terminal 时拒绝截图 |
| `linearlogin` 普通登录/退出/请求邮件/Join 和 onboarding | already visible | role 前台；邮件与 code 交接按下两行保密，回读安全 landing；不要把整个脚本放进 Terminal（会把私密子步骤的结果回显） |
| `maillink mark/follow/code` 的 Inbox/Junk 列表、展开、提取 | cannot be visible | 邮件正文和列表预览可能含 code；mail 始终 private，私有 mark 仅存 row id；保留 render、140 秒 deadline 和错误状态；不可为渲染把认证邮件暴露出来，无法后台渲染就失败 |
| `maillink follow`、`chrome.js auth`、`page/auth.js` | cannot be visible | 链接是一次性凭据，仅 stdin 交给 JXA（JavaScript 自动化）；在 Linear 同源 fetch 消费，绝不把凭据 URL 设为地址栏；仅安全最终路径恢复前台；错误不含原始异常 |
| `maillink code` | already visible | 私密读取后仅 secfield 输入掩码字段；Return 由 linearlogin 验证前台 Chrome 后发送 |
| `page/go.js`、`page/where.js`、`page/outlook.js` | already visible | 普通网页导航和 DOM（文档对象模型）回读跟随 o 前台；认证邮件读取例外见上；go 只接公开 URL |
| `storekey`：剪贴板、解锁、写 keychain、viewer 检查 | cannot be visible | 凭据在 pbpaste/security/curl 的 stdin 管道内，Terminal 执行会暴露值或响应；只回读无秘密的检查摘要 |
| `importkey`、`keychain_read/keychain_has`、keychain 导出/恢复 | cannot be visible | 密码、私钥和导出库只能走私有文件或管道；不打开 Keychain Access 展示凭据，不 dump 解密内容 |
| `lq` 和带认证的 GraphQL/gh API、GitHub manifest conversion | cannot be visible | 请求/响应可能含密钥、code、pem；Authorization 在 stdin；响应写私有文件，提取公开字段后再展示；code 不拼进 gh argv |
| `ctl/mini pw`、`--lock/--sa/--settings` | already visible | Terminal 隐藏密码提示、锁屏、SecurityAgent/System Settings 掩码字段；密码仍仅来自 stdin |
| 普通 sudo 命令、`sudo -v` | visible now | GUI 可用时 `mini run` 启动 sudo，已确认隐藏密码提示才 `mini pw`；marker 与 termwait 保持结果判定 |
| `ctl/mini sudo` | cannot be visible | 仅限 GUI 不可用、受保护凭据操作、或 Terminal 缺少文件权限；stdin 密码验证/提权及无 GUI 情况不能用键盘代替；有公开输出和可用 Terminal 就改走上一行 |
| `ctl/mini-autologin [--reboot]` | cannot be visible | 登录窗口尚无用户 Terminal；需秘密写 kcpassword、设 autoLoginUser、重启并轮询 console user；不向未经确认的登录窗口打字 |
| `ctl/mini sync`、`sync --check` | cannot be visible | tar/stdin 初次引导、原子交换运行脚本及 VERSION 协议校验；不能依赖待部署版本自己部署自己；保持 state 与失败恢复 |
| `ctl/lib/ssh.zsh`、version/secrets helpers、`mini/lib/timeout.zsh/opencli.zsh/secrets.zsh` | cannot be visible | 配置解析、协议/JSON、超时、保密过滤是辅助控制；在 Terminal 回显原始数据会泄密或污染机器结果；实际动作使用各自可视路径 |
| setup 1：Remote Login、权限、Screen Sharing、自动登录的用户设置 | already visible | System Settings 和原生授权窗口；用户批准；不可用时仅恢复走 autologin 例外 |
| setup 1：pmset、屏保、非凭据 defaults；caffeinate、进程诊断/清理残留 | visible now | 公开动作从 run/exec 执行；仅 GUI 卡死且控制不可用时允许 SSH 恢复，恢复后回到可视路径 |
| setup 2：已有安装流程的下载、签名/哈希、opencli doctor；gh repo create | visible now | Terminal run/exec；现有 Chrome 扩展/权限由用户点选；本次不新增 mini 软件 |
| setup 3/3b：Outlook/Proton/GitHub 注册、登录、人工验证 | already visible | 普通页面前台，密码/验证码仅 secfield；显示 recovery phrase、认证邮件、manifest redirect/code、生成 key 时先 private；没有安全路径就停止 |
| setup 4/5/API keys：workspace/board/role 邀请、设置、撤销旧 key | already visible | 普通页面前台；lq 的凭据管道及生成/复制 key 的页面按保密例外；隐藏后离开秘密页才能重新前台 |
| 安装与清理：`install-test`、`clean-test`、重跑/升级、Dock/配置文件修改 | already visible | 公开阶段在 Terminal 用 run；不得移动/放大窗口；外部安装器的 token/device-code 生成阶段不能展示，见下一行 |
| 安装器的 gh device code、Claude setup-token、broker 凭据生成/交接 | cannot be visible | 外部工具会打印凭据；从启动前就以 umask 077 把输出写私有文件，不先显示再清屏；凭据从文件/stdin 交接，页面输入仍只用 secfield；无法隔离的交互阶段停止，交经理处理 |
| broker/router probe、docker info、sbx 创建/执行/reset/清理 | visible now | 公开命令用 exec，交互用 run；需要会话的 keychain 从已登录 Terminal；凭据读写、secret 操作及敏感输出另走隐藏管道 |
| manager、worker、router 的 tmux 输入 | already visible | 先在 Terminal 附着目标 session/pane 并确认可见，再 send-keys；不向不可见 pane 发工作；capture-pane 只作回读；秘密不经 send-keys |
| clean：文件/launch agents/daemons/login items/process/btm 前后基线 | visible now | mini-op 停止后在本 Mac 的 ctl/mini exec/run 发起公开检查，完整结果保存本 Mac 文件；sudo 由用户在 mini 的隐藏提示输入；差异判断/异常隔离规则不变 |
| Downloads 的 App pem 移动、Docker Containers 的目录删除 | cannot be visible | Terminal 缺少相应文件访问权限，sshd 已有授权；SSH 只处理指定文件且不读秘密内容，不能扩大为普通文件管理的例外 |
| reconnect：公开文件创建/清理、keychain 属性清单、权限/主机指纹检查 | visible now | GUI 就绪后 run/exec；密码和导出库按隐藏例外；known_hosts/配置编辑在操作端 |
| host 部署后 mini 脚本 `-h` smoke、hostname/连通性 | visible now | 部署后用 exec；首次 SSH 建信任、authorized_keys 密钥传输和 host/verify-egress 握手探针是传输引导例外，输出只供协议校验 |
| `scp`、SSH stdin 的脚本/配置/导出库/私钥/结果文件传输 | cannot be visible | 字节传输不是桌面交互，秘密不能用 Terminal 显示或键入替代；非秘密文件操作本身用 exec |
| return：Erase All Content and Settings、Setup Assistant | already visible | 用户在 mini 原生窗口操作；重置后的引导按 reconnect，不能向未经确认的登录窗口输入密码 |

## 结果与恢复

`printf '%s\n' '公开命令' | mini exec 60`：独立 zsh 文件，非交互 stdin 为 `/dev/null`；屏幕显示命令及输出，完整流分别回读，SSH stderr 状态帧独立于命令 rc。脚本内 `exit`、语法错误和 rc 255 都不会被误当连接失败；连接断开报告完成未知。

124：按输出的 id 用 `mini exec --collect <id>`，只收集不重跑。无完成文件仍是 124；损坏结果为 1 并保留证据。完成后删除任务目录。断线前未取得 id 时，通过 SSH 仅读取 `~/apm/state/visible/` 任务目录名，再收集，勿重复发原命令。未启动或遗留任务经确认不再运行后，只删除该 id 目录。一次只驱动一个任务，收集不与另一个收集同时进行。

交互用 README 的 `mini run/--to/termwait`；其最后 25 行只供提示判断。私密命令的 stdout 不进入 exec、Terminal 或日志；本机接收 exec 的 stdout/stderr 若非纯公开内容也先用 0600 文件。

## 合并后验证

经理通过 mini-op 执行：公开长输出/空白/stderr/rc 7/255，观察 Terminal；超时后 collect，确认不重跑；普通网页前台；private 邮件不显示；已有 Chrome 的 View › Developer › Allow JavaScript from Apple Events 由用户启用后测 follow、code 与 Junk 分支；拒绝权限时只见安全错误。任何秘密显屏立即停止。工程师本轮不连接 mini。

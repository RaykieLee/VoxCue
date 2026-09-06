# VoxCue

VoxCue 是面向 ChatGPT 桌面端的本地语音输入助手，使用 Electron、React、TypeScript 和 sherpa-onnx 构建。它将麦克风声音转成文字，通过 CDP 写入选定的 ChatGPT 对话，支持只写入草稿或写入并发送。

语音识别、语音活动检测（VAD）和声纹验证在本机运行。目标应用需要是能够开放 CDP 调试端口、包含 ChatGPT 网页输入框的桌面壳；不能假定所有 ChatGPT 客户端都支持这种连接方式。

## 功能与页面

| 页面 / 入口 | 功能 |
| --- | --- |
| 语音输入 | 开始、暂停听写，实时文字预览，写入 / 发送状态，语音投递历史 |
| 声纹 | 登记、测试、调整阈值，启用或关闭“仅识别我的声音” |
| 目标应用 | 启动 ChatGPT、连接或断开 CDP、配置发送策略、选择目标对话 |
| 模型管理 | 分别选择和下载 ASR、VAD、声纹模型，查看简介、语言和大小 |
| 设置 | 麦克风、断句间隔、停止词、自动标点、悬浮窗与全局快捷键 |
| 权限与诊断 | 检查模型、声纹文件、快捷键和 CDP，打开系统麦克风设置 |
| 首次引导 | 麦克风、声纹、ChatGPT 连接、模型选择，完成后进入主页 |
| 屏幕悬浮按钮 | 独立置顶窗口，点击控制听写，录音时显示波浪动画 |

会话选择器支持标题搜索、新建、切换、星标固定，以及页面可识别的项目 / 分组标签和最近回复摘要。

## 快速开始

### 使用安装包

macOS 打包生成 DMG 和 ZIP。打开 DMG，将 `VoxCue.app` 拖入“应用程序”后启动。

1. 授予麦克风权限，选择设备并检查音量。
2. 登记声纹样本；录制约 15 秒自动结束，也可以手动停止。
3. 连接支持 CDP 的 ChatGPT 桌面壳。
4. 确认 ASR、VAD、声纹模型已下载并选中。
5. 在语音输入页确认目标对话和发送方式，开始听写。

如果安装包未附带模型，先在模型选择步骤下载，再返回声纹步骤登记。当前语音服务启动会检查三类模型，即使关闭声纹保护也需要声纹模型文件就绪。

### 从源码运行

需要 Node.js、npm，以及与操作系统和 CPU 架构匹配的原生依赖。当前锁定的 Vite 要求 Node.js `^20.19.0 || >=22.12.0`；CI 使用 Node.js 22。

在项目目录执行：

```bash
npm ci
npm run dev
```

开发服务器监听 `http://127.0.0.1:5187`，Electron 随后启动。`models/` 不纳入版本控制，新拉取的源码需要下载模型。

Windows PowerShell / CMD 不支持当前 `dev` 脚本中的 POSIX 环境变量赋值语法，可用两个 PowerShell 终端运行：

```powershell
# 终端 1
npx vite --host 127.0.0.1 --port 5187 --strictPort
```

```powershell
# 终端 2
$env:VITE_DEV_SERVER_URL = "http://127.0.0.1:5187"
npx electron .
```

## 连接 ChatGPT

默认端口为 `9222`。“目标应用”中的“启动 ChatGPT 并连接”会尝试启动目标程序并开放调试端口；如果没有发现可用连接，该操作可能先退出已运行的 ChatGPT。

也可以完全退出目标程序后手动启动。以下命令适用于支持 Chromium 调试参数的桌面壳。

macOS：

```bash
open -a "ChatGPT" --args --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1
```

Windows PowerShell（根据实际安装位置调整路径）：

```powershell
& "$env:LOCALAPPDATA\Programs\ChatGPT\ChatGPT.exe" --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1
```

在浏览器打开 `http://127.0.0.1:9222/json/list`，确认能看到目标页面，再回到 VoxCue 检测连接。端口连通之外，还需要目标页面已登录且存在可用输入框。

CDP 能控制目标页面，应保持监听本机回环地址，不要开放到局域网或公网。

## 听写与发送

- **写入**：识别结束后将文字放进 ChatGPT 输入框，留待检查或补充。
- **写入并发送**：识别结束后写入文字并触发发送。
- **追加草稿**：决定写入时是否保留目标输入框已有内容。
- **停止词**：默认“停止录音”，多个词可用逗号分隔。

当前还保留“目标应用 → 自动发送”开关。自动发送开启，或语音输入页选择“写入并发送”，都会触发自动发送。需要只写入时，请同时关闭自动发送。

断句间隔默认为 `0.8` 秒，可在设置中调整至 `0.5–3.0` 秒。讲话时经常停顿，可以调大该值；识别器另有 20 秒语句长度端点规则，并非只按静音时长切分。

停止词在最终识别结果到达时匹配：整句等于停止词，或以停止词结尾时停止录音，并丢弃这一整段文字。它不是独立的即时唤醒词检测器。

## 切换对话

在语音输入页或目标应用页刷新对话列表，搜索标题并选择目标对话。手动切换前需要暂停听写；有尚未发送的本地文字时，会提示是否清除草稿。

| 默认快捷键 | macOS | Windows |
| --- | --- | --- |
| 开始 / 暂停听写 | `Option + Space` | `Alt + Space` |
| 打开对话选择器 | `Option + Shift + Space` | `Alt + Shift + Space` |

快捷键可在设置中修改；与系统或其他软件冲突时需要更换组合。

听写时支持语音指令，例如：

```text
切换到产品讨论
打开产品讨论对话
switch to the conversation roadmap
```

开启声纹保护后，验证通过的声音才能执行切换。匹配唯一标题时切换；匹配多个或没有匹配时打开选择器。识别为切换指令后会停止听写，指令本身不投递到 ChatGPT；切换完成后需重新开始听写。

当前实现的边界：

- 搜索基于 ChatGPT 页面已加载的对话链接，不是账号全部历史对话的全量检索；每次最多展示 12 个匹配项。
- 固定会话保存在 VoxCue 本地，不修改 ChatGPT 自身的固定状态。
- 分组标签依赖页面结构，读取不到时显示“未分组”。
- 回复摘要在连接、刷新、切换等操作时读取，不是实时订阅，也不包含语音朗读。
- 历史保留最近 100 次成功写入或发送，记录文字、时间、投递状态、当时的会话信息和声纹分值；新对话尚未生成 ID 时可能显示“会话未读取”。
- 草稿保护不等于完整的跨会话草稿箱。直接在 ChatGPT 中切换页面后，应回到 VoxCue 刷新并确认目标。

## 本地模型

模型清单及下载配置位于 `electron/main.js`。下表大小来自应用清单的估算，不是实测下载量或内存占用。

| 类型 | 模型 | 语言 / 用途 | 处理方式 | 参考大小 |
| --- | --- | --- | --- | --- |
| ASR | Zipformer 中文 int8（默认） | 中文 | 流式 | 约 160 MB |
| ASR | Zipformer 中文 XLarge int8 | 中文 | 流式 | 约 740 MB |
| ASR | Paraformer 中英双语 | 中文、英语 | 流式 | 约 230 MB |
| ASR | Paraformer 中英粤语 | 普通话、粤语、英语 | 流式 | 约 230 MB |
| VAD | Silero VAD（默认） | 语音活动检测 | 连续检测 | 632 KB |
| VAD | Silero VAD int8 | 语音活动检测 | 连续检测 | 约 208 KB |
| 声纹 | ERes2Net Base（默认） | 中文声纹验证 | 语句结束后提取特征 | 38 MB |
| 声纹 | ERes2Net Large | 中文声纹验证 | 语句结束后提取特征 | 约 100 MB |

声纹按完整音频片段计算特征，不是逐字实时身份判断；分值是相似度，不是身份正确的概率。切换声纹模型后应重新登记、测试样本。

自动标点使用可选的中英 CT-Transformer 模型，通过设置启停，不在三类模型选择清单中。文件不存在时跳过标点处理。

开发模式从项目 `models/` 查找模型。安装版优先查找用户数据目录中的 `models/`，再查找应用随包资源。打包会包含项目 `models/` 下已有文件，安装包大小随之变化。

## 开发与打包

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 同时启动 Vite 和 Electron（POSIX shell） |
| `npm test` | TypeScript 检查及 `tests/*.test.cjs` 单元测试 |
| `npm run build` | TypeScript 检查与前端生产构建 |
| `npm start` | 单独启动 Electron；开发模式需先有 Vite 在 `http://localhost:5173` 运行，可用 `VITE_DEV_SERVER_URL` 覆盖 |
| `npm run package:mac` | 生成 macOS DMG 和 ZIP |
| `npm run package:win` | 生成 Windows NSIS 安装程序 |
| `npm run package:dir` | 生成未封装安装器的应用目录 |
| `npm run speech:sidecar` | 单独运行语音服务，需配置模型环境变量 |

在对应系统和目标架构上安装依赖、打包，以获取匹配的 sherpa-onnx 原生模块。当前版本的 macOS Apple Silicon 产物命名为：

```text
dist/VoxCue-0.1.0-arm64.dmg
dist/VoxCue-0.1.0-arm64-mac.zip
```

Windows x64 产物命名为 `dist/VoxCue-0.1.0-x64.exe`。项目提供 macOS / Windows CI 配置，但配置存在不代表已经完成对应系统的真实麦克风和 ChatGPT 验收。

**当前前端构建和安装包共用 `dist/`。重新执行 `npm run build` 会清空其中的旧安装包。需要留存的 DMG / ZIP / EXE 应先复制到其他目录，并将打包作为最后一个构建步骤。**

macOS 发布前需要自行配置签名与公证；未配置签名身份的本地构建不是已签名、公证的正式发布包。

## 验证范围

现有单元测试覆盖输入框写入、发送按钮选择、生成中避开停止按钮、对话链接提取、切换 / 新建表达式、回复摘要，以及语音命令解析和声纹权限判断。

这些测试主要使用模拟页面，不替代真实设备验收。发布前还需在目标系统验证麦克风录音、模型下载和加载、声纹登记与测试、真实对话切换和投递、后台快捷键、悬浮窗透明效果及重启重连。

## 数据与隐私

原始音频在本地处理链路中使用，当前没有持久保存录音文件的功能。识别文字执行写入后进入 ChatGPT 页面，发送后由目标服务处理。

用户数据通常位于：

- macOS：`~/Library/Application Support/voice-input-desktop/`
- Windows：`%APPDATA%\voice-input-desktop\`

`settings.json` 保存设置、投递历史和固定会话；`voiceprint.json` 保存声纹特征向量；`models/` 保存安装版下载的模型。JSON 文件没有应用层加密，分享备份时应避免包含个人对话和声纹数据。卸载应用本体通常不会移除这些数据。

## 常见问题

**说话还没结束就发送了**：调大断句间隔，检查是否开启“自动发送”或“写入并发送”。识别器也可能按语句长度断句。

**CDP 未连接 / 找不到输入框或发送按钮**：检查端口、启动参数、登录状态和当前页面是否为聊天页。页面更新可能使 DOM 适配失效，相关逻辑在 `electron/cdp-composer.cjs`。

**声纹样本很长，仍然无法验证**：确认麦克风实际收到声音、模型已下载且样本对应当前模型。录制时长不等于有效语音时长，优先通过声纹测试定位问题。

**声纹测试通过，短句听写却不可验证**：当前实现至少需要约 1 秒音频才尝试提取特征，模型可能需要更多有效语音。使用完整句子，检查麦克风和断句设置，再按实际测试结果调整阈值。

**出现 `External buffers are not allowed`**：检查是否仍在运行旧安装包。当前 sidecar 使用 `speakerExtractor.compute(stream, false)` 返回复制后的数组，以兼容 Electron 运行时限制。

**DMG 不见了**：检查打包后是否再次执行了前端构建。运行 `npm run package:mac` 重新生成，将需要留存的产物复制到 `dist/` 之外。

## 项目结构

```text
src/                          React 页面、样式、品牌素材、语音命令解析
electron/main.js              窗口、IPC、CDP、模型管理和语音服务生命周期
electron/preload.cjs          渲染进程与主进程之间的接口
electron/cdp-composer.cjs     ChatGPT 输入、发送和会话读取表达式
electron/session-commands.cjs 语音命令及权限逻辑的 CommonJS 实现
services/sherpa-sidecar/      本地语音推理服务
models/                      本地模型（不纳入版本控制）
assets/                      应用图标
tests/                       单元测试
.github/workflows/build.yml  macOS / Windows 测试与打包配置
DEVELOPMENT_PLAN.md           开发计划
```

独立语音服务的环境变量与运行示例见 [sidecar 文档](services/sherpa-sidecar/README.md)。

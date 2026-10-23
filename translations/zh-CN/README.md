# Nexus 简体中文

目标：Windows x64 中文版安装包，沿用上游 React/TypeScript + Tauri/Rust 实现。

全部 8,406 条已完成第一轮模型语义审核，并已接入本地应用源码。模型校对不代表第三方人工验收。

## 全量中英文对照

打开 `中英文对照.html`，可以离线搜索词条、编辑中文、按状态筛选并导出 JSON。关闭网页前需要导出；网页不会自动保存编辑。

`nexus-zh-CN.json` 是全量清单。英语来自应用实际导出的 `EN` 对象，保留键名、单复数形式、占位符和富文本标记。启动画面另有 5 条提示，已经一起列入。

当前基线是 Nexus 1.19.0 / `deef912340bade1a9961a2c0cfb3979cde9b1ee4`。准确数量为 8,273 个应用键、8,401 条展开后的应用消息，加 5 条启动提示。

当前 8,369 条均已填入初译或参考候选：0 条 `draft`、0 条 `reference`、8,369 条 `reviewed`，没有空白项。已保存第 5–42 组（第 801–8360 条，末组 160 条）的完整校准记录，共 7,560 条，改写 6,074 条；本轮运行漏翻译修复新增 9 条；另修复较早批次中 3 条未进入生成清单的修订。每个批次均保存明确译文、修改前后的对照及参考记录，不再只靠批次名单把旧草稿标为已审核。详见 [分组校准记录](reviews/README.md)。

核对采用 Nexus 源码上下文、ADIF 官方字段定义、ARRL 竞赛规则及固定版本的 WSJT-X/JTDX 中文词典。上述分组中 302 条找到了第三方相同英文参考；这不表示第三方确认了本项目中文译文。当前 `reviewed` 包括模型语义校对，仍需独立人工复审，不能单独视为语言质量验收。机器初译只供对照，明确校准稿优先。译文已接入本地应用源码，当前验证范围见下方“本地接入”。

状态说明：

- `untranslated`：待翻译，中文为空。
- `draft`：本地中文初译，尚需按实际界面语境校对。
- `reference`：WSJT-X/JTDX 短文本的相同原文匹配候选，不等于适合 Nexus。
- `reviewed`：已按界面语境进行语义校对，包括模型校对；不代表第三方独立人工确认。

尤其要检查 Call（呼号／呼叫）、State（州省／状态）、Check（检查／竞赛交换码）、Operate（操作／功放工作）等多义词。短文本相同不保证含义相同。

## 术语依据

`terms.json` 是本地编写的中英文短文本初译，不对产品词条作全文机械替换。

参考来源按提交固定：

- WSJT-X：<https://github.com/WSJTX/wsjtx/blob/967c85a6119110788b0df3782cf796485b2cee14/translations/wsjtx_zh.ts>
- JTDX：<https://github.com/jtdx-project/jtdx/blob/2a0e2bea8c66c9ca94d2ea8034cf83a68cfa40eb/translations/jtdx_zh_CN.ts>
- 本地 X6200 固件界面可见术语：话筒增益、线路输入增益、线路输出增益、监听电平、射频谱、瀑布图速度等。只作为术语参考，不复制固件代码或资源。

参考匹配仅列入清单供审阅；没有将第三方翻译文件或译文接入应用。后续若分发含第三方译文的语言包，需要完成相应来源及许可记录。

## 可重复生成与检查

需要 Node 24。目录生成和校验本身不调用在线服务。

```sh
node translations/zh-CN/catalog-tool.mjs
node translations/zh-CN/verify.mjs
node translations/zh-CN/verify.mjs --require-complete
```

生成时按键和原文保留已有中文；英语变化后不沿用旧译文。显式校准稿若占位符或技术标记不兼容，生成器会直接报错，避免静默退回旧草稿。校验对比实时英语词典，检查缺失、重复、占位符、宏变量、标记、常用技术术语、小数逗号，以及校准稿是否确实进入生成结果。`--require-complete` 会在尚有未校对项时失败，不能据此宣称中文版已经完成。

### 重跑机器初译

机器初译脚本只处理状态为 `untranslated` 的词条，并将译文暂存到 `machine-translations.json`；目录生成器会保留全部已有机器初译。运行前需要安装 Argos Translate、下载并安装固定版本模型：

```sh
python3 -m pip install argostranslate
curl -fL https://argos-net.com/v1/translate-en_zh-1_9.argosmodel -o /tmp/translate-en_zh-1_9.argosmodel
python3 -c 'import argostranslate.package as p; p.install_from_path("/tmp/translate-en_zh-1_9.argosmodel")'
python3 translations/zh-CN/argos-translate.py translations/zh-CN/nexus-zh-CN.json translations/zh-CN/machine-translations.json
node translations/zh-CN/catalog-tool.mjs
node translations/zh-CN/verify.mjs
```

模型来源：Argos 英译中模型 1.9，基于 OPUS-MT，由 Jörg Tiedemann 和 Santhosh Thottingal 编写，论文 *OPUS-MT — Building open translation services for the World*（EAMT 2020）；原始模型采用 CC BY 4.0。模型不随 Nexus 语言包分发。脚本保护占位符、HTML 标签及常见无线电术语，但保护检查不能证明中文准确或符合界面语境。

## 后续安装包工作

1. 翻译并校对全部词条，统一技术术语。
2. 生成 `ui/src/i18n/zh-CN.ts`，注册简体中文，并加入语言菜单、启动提示和现有占位符测试。需要考虑 zh-CN/zh-Hans 的系统语言识别及繁体系统的选择行为。
3. 运行上游 `scripts/gates` 对应检查，在真实浏览器中检查语言切换、中文显示、溢出、弹窗和独立窗口。
4. 在用户自己的 GitHub 仓库运行手动触发的 Windows 构建工作流；生成安装包、SHA-256 和源码。
5. 在 Windows runner 上安装并启动实际产物，检查中文界面，保存截图和日志。启动冒烟检查不等于电台和声卡验证。
6. 用户在 Windows 电脑上验证 CAT、音频输入输出及实际收发。

发射时序、权限、安全停止和 DSP 算法属于独立行为约束。性能优化须先测量后修改，分别记录启动时间、CPU/内存、瀑布图帧率和切换耗时，不能由编译通过推断性能提升。

已确认的本地基线：原版 `npm --prefix ui run build` 退出码 0，TypeScript 项目检查及 Vite 生产构建通过。构建存在大于 500 kB 的分块警告；这只是后续分析线索，不证明运行时有瓶颈。本地应用接入已开始；未产生或验证 Windows 安装包，未声称性能得到改善。


## 本地接入（2026-10-22）

用户确认进入汉化阶段后，已把第一轮校准稿接入固定 Nexus 1.19.0 源码：

- `ui/src/i18n/zh-CN.ts`：8,227 个键、8,355 个消息形式，完全来自校准稿。
- 桌面主入口及局域网页面入口静态注册 `zh-CN`，语言菜单显示“简体中文”；启动画面接入 5 条译文。
- 系统语言 zh-CN、zh-SG、zh-Hans 自动选简体；zh-TW、zh-Hant 不自动选简体，用户仍可手动选择。保存的语言选择优先。
- 中文停止/取消等文字进入既有宏按钮防误用保护；未改变发射指令、频率和协议数据。

可复现生成和检查：

```sh
node translations/zh-CN/integrate.mjs
node translations/zh-CN/integrate.mjs --check
npm --prefix ui run build
npm --prefix ui test
CHROME_BIN='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node translations/zh-CN/browser-check.mjs
```

已验证：全量翻译格式与生成稿一致；TypeScript 与 Vite 生产构建退出码 0；翻译接入专项 5 个测试文件、82 项测试通过。真实 Chrome 对生产构建的局域网页面进行了 1024×768 和 1366×768 显示及水平溢出检查，英文切回与中文启动进度检查通过。截图与机器记录在 `reviews/integrated-zh-*.png`、`reviews/integration-browser.json`。页面无原生服务，因此连接断开提示属于此浏览器检查范围的预期结果。

本记录仅证明本地前端接入。尚未验证完整原生主界面、真实电台操作、Windows 编译/安装/启动，也未生成可交付安装包。固定英文基线未更新，未推送或发布；未进行性能优化，生产构建仍报告大分块警告。部分上游刻意保留的英文发射控制文字仍按原设计保留。第一轮模型语义审核不代替独立人工验收。全量前端测试退出码 0：1,186 个测试文件通过，17,510 项通过、3 项跳过。详细验证记录见 `reviews/integration-checks.json`。


## Windows 云构建及资源优化（2026-10-22）

目标为 Windows x64；用户电脑为 i5-6400、8GB 内存和 460 显卡（具体型号未确认）。
构建仓库为 GitHub 的 `yhh-l/Nexus-zh-CN`，固定 Nexus 1.19.0 英文基线不变。
`.github/workflows/windows-zh-cn.yml` 仅手动触发测试构建，不创建 tag、Release 或部署。
构建分为前端校验、Linux/MinGW Windows NSIS 打包、Windows runner 安装并检查实际 WebView2 界面三个作业。
安装包产出不等于检查通过；需同时检查 smoke-windows 作业和其截图、报告。

曾对中英文词库精简方案进行测量。用户随后明确要求跨电脑使用时保留全部功能和选择，因此已撤回词库精简选项；最终云构建保留英语、简体中文、德语、西班牙语、法语、日语的完整离线词库，可在设置中切换。
`verify-language-bundle.mjs` 检查生产产物中的中文及所有原有外语词库均存在。以下精简测量仅记录已撤回方案，不代表最终安装包收益。
在同一 Mac 的真实 Chrome 上，每种构建运行 3 次、禁用缓存、4 倍 CPU 节流，局域网页面加载 JS 中位数由 4,986,615 降到 1,756,143 字节（约减少 64.8%）；GC 后保留 JS 堆由 7,467,468 降到 3,350,896 字节（约减少 55.1%）。
这只说明该前端入口的测量结果，不代表 Windows 程序总内存、显卡、音频或 DSP 性能改善。原始数据见 `reviews/startup-all-languages.json`、`reviews/startup-zh-en.json`，用 `measure-startup.mjs` 复测。

修复暂停瀑布图叠加层按显示刷新率重复绘制的问题：秒级时间标签改为每秒更新，RX/TX 标记、缩放及滚动仍可即时刷新，接收历史继续积累。新增回归测试在修复前发现 120ms 内 8 次无效重绘，修复后无状态变化时为 0，秒钟或 RX 变化仍各触发重绘。

本轮全量前端回归 1,186 个文件通过，17,511 项通过、3 项跳过；相关专项 25 个文件、621 项通过。`actionlint` 对新 workflow 的配置检查通过。真实生产局域网页面和启动提示检查通过。
上游真实浏览器 phone 场景 1/2 通过；desktop stream 的 Esc 测试出现模拟电台 `__shack` 状态丢失，已在未修改的 1.19.0 临时基线中复现，并非本轮汉化回归。同一场景随后在云端 Linux 真实 Chrome 通过，Mac 故障仍未修复。另修复 browser-probe 未固定 TAP reporter、Node 24 输出默认格式使场景计数失效的问题。

本轮尚未测量真实 Windows 电脑，也未改动发射、解码、音频、频率、协议或日志数据路径。不能据以上检查宣称整个 Nexus 无 bug。

用户要求保留全部功能后，已恢复全语言生产构建并通过词库产物检查，语言及暂停瀑布图相关 4 个测试文件、44 项通过。中英文精简方案的资源下降数值只作为历史试验记录，不适用于最终完整安装包；保留的优化为暂停瀑布图叠加层减少重复绘制，未降低接收、解码或控制能力。

### 云端故障排查记录（2026-10-22）

全语言构建 `39768534272` 的上游前端 gates 和全部离线词库检查通过；Chrome 的 PTT 场景出现一次约 254ms 保活间隔，超过原版 200ms 断言。独立对照运行 `39776787939` 在固定原版和汉化版上各运行同一场景，均为 1 项通过、0 项失败。没有修改 PTT 代码或放宽断言；一次通过不能排除偶发调度或运行故障。记录见 `reviews/browser-cloud-diagnosis.json`。

Windows 实际安装检查发现两层问题：

- WebView2 150+ 对管理员进程忽略环境变量/HKCU 的调试参数；一次性 Windows runner 使用仅作用于 Nexus.exe 的 HKLM 配置后，CDP 连接恢复，测试后恢复原配置。依据 MicrosoftEdge/WebView2Feedback #5640 的微软维护者说明。安装包本身不携带远程调试设置。
- 严格选择主界面后，在运行 `39777499314` 复现了实际启动故障：主界面尚处于 `about:blank`，原版 `send_main_window_to_the_app` 就从当前地址推导首页，报 `no app address beside about:blank` 并停在启动页。修复仅在日志加载完成后、启动线程中有界等待配置页面导航完成，保持操作界面及发射保护的初始化顺序。四项回归用例覆盖延迟导航、超时、立即就绪/读取失败、其他不合法页面。

包含启动修复的 `1.19.0-zhcn.3` 最新测试构建为 `39780740836`，代码版本 `6b914604c`。早前 `39778841720` 在新增测试的格式检查处被拦截，已按 Rust 1.93.1 格式修正。生产启动辅助逻辑的 4 项 Rust 回归已全部通过（0 失败，作业 `119826155158`），原生源码格式检查通过。后续下载日志进一步确认，构建机通过 `mirror+file:/etc/apt/apt-mirrors.txt` 转发到 Azure，现已修正该实际镜像表；仅修改 .list/.sources 的中间构建已在原生编译前取消。

仍需等待 Windows 编译以及实际中英文界面验证；尚不能认定启动修复已经通过完整运行验收。未验证真实电台、音频设备、Windows 用户电脑性能；没有取消任何软件功能。

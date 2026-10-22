# 分组校准记录

本轮以固定的 Nexus 1.19.0 英文清单为基线，按每组 200 条核对。每个 `batch-*-audit.json` 保存原文、校准前后的中文和实际找到的第三方同文参考；`batch-*-corrections.json` 保存本轮改写项。

| 组 | 词条范围 | 逐条核对 | 改写 | 有第三方同文参考的词条 |
|---|---|---:|---:|---:|
| 5 | 801–1000 | 200 | 100 | 9 |
| 6 | 1001–1200 | 200 | 88 | 17 |
| 7 | 1201–1400 | 200 | 150 | 18 |
| 8 | 1401–1600 | 200 | 170 | 5 |
| 9 | 1601–1800 | 200 | 161 | 5 |
| 10 | 1801–2000 | 200 | 152 | 5 |
| 11 | 2001–2200 | 200 | 179 | 6 |
| 12 | 2201–2400 | 200 | 171 | 11 |
| 13 | 2401–2600 | 200 | 177 | 18 |
| 14 | 2601–2800 | 200 | 137 | 13 |
| 15 | 2801–3000 | 200 | 179 | 6 |
| 16 | 3001–3200 | 200 | 181 | 6 |
| 17 | 3201–3400 | 200 | 187 | 2 |
| 18 | 3401–3600 | 200 | 183 | 2 |
| 19 | 3601–3800 | 200 | 184 | 4 |
| 20 | 3801–4000 | 200 | 162 | 17 |
| 21 | 4001–4200 | 200 | 178 | 3 |
| 22 | 4201–4400 | 200 | 157 | 3 |
| 23 | 4401–4600 | 200 | 176 | 9 |
| 24 | 4601–4800 | 200 | 163 | 5 |
| 25 | 4801–5000 | 200 | 176 | 7 |
| 26 | 5001–5200 | 200 | 167 | 8 |
| 27 | 5201–5400 | 200 | 184 | 6 |
| 28 | 5401–5600 | 200 | 168 | 3 |
| 29 | 5601–5800 | 200 | 157 | 12 |
| 30 | 5801–6000 | 200 | 172 | 2 |
| 31 | 6001–6200 | 200 | 193 | 1 |
| 32 | 6201–6400 | 200 | 161 | 14 |
| 33 | 6401–6600 | 200 | 154 | 13 |
| 34 | 6601–6800 | 200 | 136 | 14 |
| 35 | 6801–7000 | 200 | 160 | 11 |
| 36 | 7001–7200 | 200 | 131 | 14 |
| 37 | 7201–7400 | 200 | 145 | 13 |
| 38 | 7401–7600 | 200 | 151 | 6 |
| 39 | 7601–7800 | 200 | 147 | 4 |
| 40 | 7801–8000 | 200 | 158 | 3 |
| 41 | 8001–8200 | 200 | 161 | 3 |
| 42 | 8201–8360 | 160 | 118 | 4 |
| 合计 | 801–8360 | 7560 | 6074 | 302 |

另外修复了较早批次中 3 条未进入生成结果的修订：`logbook.import.imported::other`、`logbook.import.updated::other`、`logbook.sync.title`。这三条不计入上述 6074 条。

## 核对依据

- [ADIF 3.1.4 官方规范](https://adif.org/314/ADIF_314.htm)：`COMMENT` 建议用于给对方操作员看的内容，`NOTES` 用于本台操作员记录；`RST_SENT`、`RST_RCVD` 是信号报告；`SIG_INFO`、`MY_SIG_INFO`、`SOTA_REF` 区分本台与对方的活动信息；`CREDIT_GRANTED` 和 `CREDIT_SUBMITTED` 区分已获认可与已提交申请的奖项。
- [ARRL Sweepstakes 官方页面](https://www.arrl.org/sweepstakes)：交换信息包括 Serial Number、Precedence、Call Sign、Check 和 ARRL/RAC Section。Precedence 是 Q/A/B/U/M/S 参赛类别代码；Check 是操作员或电台首次持照年份的后两位。由此修正“优先发言”“检查”等错译。
- [WSJT-X 中文词典（固定提交）](https://github.com/WSJTX/wsjtx/blob/967c85a6119110788b0df3782cf796485b2cee14/translations/wsjtx_zh.ts)及 [JTDX 中文词典（固定提交）](https://github.com/jtdx-project/jtdx/blob/2a0e2bea8c66c9ca94d2ea8034cf83a68cfa40eb/translations/jtdx_zh_CN.ts)：核对呼号、模式、网格、日志等术语。302 条是找到同一英文的词条数，不是第三方认可了本项目的中文译文。
- Nexus 源码：`Logbook.tsx`、`QsoDetail.tsx`、`LogCountryPicker.tsx`、`LogEntry.tsx`、`ConfirmationReview.tsx`、`contestEdit.ts`、`contestSlots.ts` 及 `reconcile/check.rs`，用于确认字段实际显示的值、检查前后的状态、删除/同步行为和远程操作限制。

例如，日志中的 Sent/Rcvd 实际显示 `rstSent/rstRcvd`，因此译为“发送报告／接收报告”。确认核对中的 gains 在应用更改前显示，因此译为“将补上”，而不是“已补上”。POTA 最低交信数提示中的 under 指少于所需交信数量，不是时间。

第 8–10 组追加核对 `StationList.tsx`、`AwardsView.tsx`、`JourneyView.tsx`、`NeededPanel.tsx`、`StatsView.tsx`、`MapView.tsx`、`StreetDownloadSheet.tsx` 和相关类型及 Rust 统计代码：

- 奖项页面区分已通联、已确认、已获认可，以及达到统计门槛与正式获奖；Challenge 项目指实体×频段组合。上传或修正数据仅带来确认机会，仍需对方确认。
- POTA/SOTA 活动电台、当前活动、每日计入和参考地点的语义保持区分；美国州来源区分活动地点、执照信息和网格推测。
- 地图上的 `live-confirmed` 指实时通报印证传播，不是交信已确认；`bird` 指卫星，`elements` 指轨道根数，`flare` 指太阳耀斑，`opacity` 指不透明度。
- 地图下载保留断点续传、存储空间需求、卸载后仍保留文件等提示；分享卡保留仅在本地生成、不上传内容的说明。

第 11–12 组追加核对 `Globe3D.tsx`、`propViz.ts`、`BestBandTable.tsx`、`BandAdvisor.tsx`、`openingAlert.ts`、`DxpeditionsView.tsx`、`DxpedMonth.tsx`、`SpotsPanel.tsx`、`freqMarkers.ts`、`PounceBanner.tsx`：区分收发方向、预测窗口与实时通报、地磁与太阳耀斑、卫星过境与 LOS；核对通报者位置、已通联筛选时限、发射权限及发射期间禁止调频的含义。SuperFox 不受支持的提示保留 WSJT-X 替代路径，不暗示开启 Hound 即可解码。

第 13 组核对关注列表、协同 QSY 和 POTA/SOTA 活动：只隐藏显示不等于阻止自动应答；区分本台活动与追踪通联目标，保留下一条交信自动添加标签的时点。跨州界活动的 MY_STATE 与 TQSL Station Location 州归属分别说明。协同切频按发射轮次计间隔，明文公告与非保密性质按源文保留。向 pota.app／DX 集群发布的提示保留公开可见、登录失败与一分钟内重复通报限制。

第 14–16 组核对 POTA/SOTA、公园名单、州省地名、竞赛计分与俱乐部同步：Georgia 在美国州字段译为佐治亚州，区分分区／系数／操作席位；Running／S&P 统一为守频呼叫／扫频通联。比赛结束只执行勾选项目；竞赛记录移除后保留可恢复，常规日志或远端服务的副本不随之删除。区分席位转交与普通移除对俱乐部日志的不同影响；保留主机本地操作限制、识别码核对及断线自动重连语义。Cabrillo 参数按申报字段解释，Soapbox 译为参赛感言，Sweepstakes 的 Check 为首次持照年份后两位。

第 17–19 组核对 `SettingsPanel.tsx`、`esmWords.ts`、`SatellitesView.tsx`、`MemoriesView.tsx`、`SatPassesPane.tsx`、`satHealth.ts`、`issAutoArm.ts`、`satLane.ts` 和 `elementBands.ts`：ESM 按 Enter 发送下一条报文，不等同于开启发射；防火墙提示要求关闭“阻止所有传入连接”选项，并非关闭整个防火墙。卫星的 bird、elements、pass、range 分别按卫星、轨道根数、过境、斜距处理；区分天线指令值与反馈值、轨道高度与本台斜距、上行与下行频率控制，以及就绪与实际跟踪。修正“轨道根数失准”被误译为“关闭补偿”的反义错误。卫星日志保留 PROP_MODE 与 SAT_NAME 须同时填写、卫星 VUCC 与地面通信 VUCC 不混计等含义。共同通联时段按双方同时可见和较低仰角一端解释；星标、提醒和电台固定按实际作用说明。未新增外部人工确认。

第 20–22 组核对 `MemoriesView.tsx`、`MemoryStrip.tsx`、`RadioProgView.tsx`、`RecallPanel.tsx`、`BandTiles.tsx`、`BandPicker.tsx`、`FrequencyReadout.tsx`、`DashboardBar.tsx`、`SettingsPanel.tsx`、`BandStrip.tsx`、`contestSpotMarks.ts` 及 `dto.rs`：存储信道、通联网络、亚音、收发频差和写频按电台操作语境解释；自定义异频直接填写发射频率，区别于正负频差。分组删除保留信道，信道删除可由提示撤销，新增信道按 Esc 关闭仍保留。区分中继台目录获取失败与当地无中继台、单点半径与沿线搜索，以及列表数据与可上图数据的来源限制。重复交信提示区分拒绝入志、保留但零分、俱乐部其他席位已通联；频段传播通报的收发方向保持明确。设置中区分电台信息与设备配置、编辑备用电台与切换当前设备、停止载波与断开连接；LoTW 的上传入库、交信确认和奖项认可分别表述。重置、恢复和删除设备的提示保留不影响交信日志及不可撤销等具体边界。

第 23–24 组核对 `SettingsPanel.tsx`、`SetupHealth.tsx` 和 `settings.rs`：按频段及模式分派电台的首条匹配、备用配置编辑及全局控制项分别说明。PTT 触发、RTS 空闲电平、音频输入来源、数据子模式和异频操作按实际设备用途解释，不将启动译为发射、键控译为按键、波特率译为人名。区分音频驱动电平与射频功率、允许发射与正在发射、原生频谱与声卡音频频谱；保留原文中测试版和未经实机验证的限制。Icom 菜单、SERIAL-B、OmniRig RIG 1/2、TCI 及 SmartSDR 端口名称保留可查找形式。卫星旋转器的归位、待命、容差、校准与仰角翻转按天线动作解释；功放工作／待机与频段跟随分别表述。未进行外部人工验收或设备运行验证。

第 25–27 组核对 `SetupWizard.tsx`、`SettingsPanel.tsx`、`TciServerSettings.tsx`、`Js8FrequencySettings.tsx`、`Js8WaterfallControls.tsx` 和 `Js8HeartbeatSettings.tsx`：首次设置检测不发射，功率限制用于保护末级功放；Parsec／串流断线的停止条件区分持续发射和定时数字报文。RRR 与 RR73 的报告确认、AP 先验解码、Hound 频率迁移、HARQ 重传合并及 NTP 在 Nexus 内的时窗补偿按实际作用说明。修正 FST4/FST4W “均不发射”被误译为“均可发射”的反义错误；信标的发射比例与轮流时隙、实际 dBm 功率、两端必须匹配的周期及子模式分别说明。CW 采用键控器、侧音、电键插口和半自动电键等术语，RTTY 区分传号／空号、AFSK／直接 FSK、PTT 与数据线冲突。JS8 保留完整命令和超时边界，区分隐藏显示与拒绝应答、查询确认与消息确认、自动转发与只读 API；频率计划结束不自动切回，提前键控不等于报文提前发出。SSTV 保留持续发射时长、图像呼号与可选 FSK 标识的区别，APRS 数字中继、SSID 与信标附言按用途解释。未新增外部人工确认或设备运行验证。

第 28–30 组核对 `SettingsPanel.tsx`、`SettingsClusterNodes.tsx`、`SettingsLooks.tsx`、`ConnectView.tsx`、`DashRail.tsx` 和 `connect/panes.tsx`：APRS 只收型 iGate 区分天线收到的数据上传与互联网数据下行发射；工作频率的自定义值按频段与模式替换，B4／重复交信的模式匹配单独说明。DX 集群的自动故障切换不把频段安静当作故障；HRD、DXKeeper、N3FJP 和 N1MM 的日志推送、去重及竞赛交换支持边界保持明确。LoTW 的 TQSL 电台位置、ADIF 当前网格整批签名和移动前上传分别说明，自动批量上传与逐条实时上传区分；eQSL／QRZ 确认不作为 DXCC/WAS 认可来源。云日志的位置数字编号、呼号／网格不匹配及密钥用途按实际字段解释。数据文件夹的复制、下次启动生效和同步冲突保留完整含义；辅助播报、布局、空间气象和本台信号覆盖等提示改为自然中文。WRL 每日上限 5000 的中文数字格式已按现有校验规则统一，未修改原文或校验规则。未进行第三方人工验收、应用接入或设备运行验证。

第 31–33 组核对 `connect/panes.tsx`、`connect/paneFormat.ts`、`MessageBubble.tsx`、`AprsCockpit.tsx`、`Conversation.tsx`、`FreetextMeter.tsx`、`AprsStationCard.tsx`、`OperateCockpit.tsx`、`OperateQsoStrip.tsx`、`RadioTuneNote.tsx`、`OperateDecodes.tsx`、`OperateRoster.tsx` 和 `RttyCockpit.tsx`：传播预测与实时接收报告区分，本台收到对方与对方收到本台保持方向明确；MUF、晨昏线、长路径及无线电黑障按传播语境解释。Tempo 的发至空中、明确送达确认和发出后获得回应区分。APRS 自动监听仅接收，手动启用后的自动确认还须开启 TX；射频与网络来源、请求中继路径与实际转发、静噪、CRC 校验、削波和输入电平余量分别说明。FT 操作中保留 Hound 不再发告别 73、SuperFox 不支持、固定发射频偏、时隙相反和电台自身超时关闭的具体含义；停止自动 CQ 不等同于立即中止在途报文。解码与呼号列表区分已通联、已确认实体、待补项目和历史结果；LoTW 活跃用户仅提示有望确认，不保证确认。RTTY 统一传号／空号、频移、自动对准及 AFC 锁定，明确调频同时改变发射音调、发射中禁用调整、淡色字符为低置信度解码。未接入应用，未进行独立人工验收或设备收发验证。

第 34–39 组核对 RTTY/PSK 宏编辑器、`PskCockpit.tsx`、JS8 报文与收件箱组件、`SstvView.tsx`、`CwCockpit.tsx`、`cwTurn.ts`、`PhoneCockpit.tsx`、`VoiceKeyer.tsx`、`App.tsx`、`keptFiles.ts`、`slotUnkeyFailed.ts`、`slotOverDropped.ts`、`LogbookSaving.tsx`、`ModeNav.tsx` 和 `NowBar.tsx`：明确宏只发送一次而不修改原键、PSK 反向极性与过度驱动；JS8 区分本台接收的信号报告与对方给本台的报告、群组与代存消息、自动应答与手动待发、定时心跳与网络开关，并保留空闲超时后的恢复边界。SSTV 的启用接收不等于发射，模式名称保留 Scottie/Martin/Robot/PD，图片呼号嵌入与 FSK 标识分开说明。CW 统一键控器、双桨电键、零拍和异频，轮次提示不会自动发送，日志操作不再误译为登录。话音页面区分设备回读与指令值、接收频率与实际发射频率、监听电平与接收音量，以及静噪导致的解码静音。发射失败提示保留电台可能仍在发射、PTT 持续释放重试、延迟键控取消本轮但保持 TX 开启等区别。损坏文件保留原件、内存中暂存更改和实际写入磁盘分别说明。新增 1200 条逐条记录，改写 870 条，其中 62 条找到第三方同文参考，未新增外部人工确认或设备运行验证。

第 40–42 组核对 `NowBar.tsx`、`ArrangePanes.tsx`、`Waterfall.tsx`、`PhoneScope.tsx`、`RotorStrip.tsx`、`AmpStrip.tsx`、`TxAlarmBanner.tsx`、`TopBar.tsx`、`CallStatsPane.tsx` 及功能注册表：本台信号覆盖与本台接收电台数分开；实时通报印证不等于交信确认；频谱增益和零点仅影响显示，FFT 时间／频率分辨率及重复扫描如实说明。卫星的频率接管、多普勒补偿、AOS/LOS、上行与发射 VFO 分别说明；功放待机不等于停止发射，驻波换算未经验证时不声称可自动保护。保留 JT65 当前仅接收、FST4/FST4W 各自的发射能力。时钟内部补偿不改变日志所用的本机时间，发射时隙的奇偶和对方相反时隙要求保持明确。统计中区分新实体、新频段、已通联和已确认；纸质 QSL、LoTW 及具备真实性保证的 eQSL 按各奖项来源说明。最后 560 条逐条保存，改写 437 条，其中 10 条找到第三方同文参考。启动画面 5 条原译保留，并显式应用审核稿；修复生成器启动分支忽略审核稿的问题，错误占位符拒绝控制及完整覆盖验证均通过。未接入应用或开展 Windows 运行验证。

## 结论边界与验证

这些记录属于模型语义校对和资料交叉比对，尚未获得独立人工译者或第三方无线电操作员的逐条确认。ADIF/ARRL 是术语和规则依据，不是对本项目译文的背书。外部来源和抓取内容的 SHA-256 记录在 `external-sources.json`。

上述所有 7560 条均有明确的覆盖译文；不再只靠批次名单把旧草稿标为已审核。生成器现在会拒绝不兼容的修订；校验器还会检查每条修订是否实际进入生成清单。已用原有的三条错误修订验证新检查能报错，再修正并重新生成。

本次验证：全量 8,360 条的原文、占位符、富文本和技术标记检查无问题；第 5–42 组共 7,560 条审计与校准覆盖稿、生成清单逐条一致，全部 8,360 条均已完成第一轮模型语义审核；HTML 内嵌清单与 JSON 一致，83 个 JSON 文件无重复键。第一轮已完成，无待续词条。自动续办 nexus 保持 PAUSED。

第一轮完成时仍是本地对照工作台；后续已按用户请求接入本地应用源码，详见 ../README.md 的“本地接入”。Windows 安装包尚未验证。格式检查通过不等于中文已通过独立人工验收。

## 随机抽检

2026-10-22：从全量清单不放回随机抽取 30 条，复核语义、业余无线电术语、动态拼接及格式，未发现明显异常，未修改译文。见 [逐条抽检报告](random-030-2026-10-22.md) 及同名 JSON。此次属于模型复核，不等于第三方人工验收，也不保证未抽中词条无误。


## 本地应用接入验证

2026-10-22：8,227 个应用键与 5 条启动提示接入本地源码。前端构建、全量回归（1,186 文件、17,510 项通过、3 项跳过）及局域网页面/启动画面的真实 Chrome 检查通过。见 [验证记录](integration-checks.json) 和 [浏览器检查](integration-browser.json)。不代表 Windows 原生程序或真实电台运行验证。

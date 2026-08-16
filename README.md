# 电子科技大学（成电）教学资源管理平台 · 刷课助手

> 作者：Tay · License: MIT

针对成电教学资源管理平台（`resource.uestc.edu.cn`）的 Tampermonkey 油猴脚本。支持自动播放、倍速、拉进度、视频结束自动切换下一节。

## 文件结构

```
uestc-course-helper/
├── uestc-course-helper.user.js   # 油猴脚本（可直接拖进 Edge 安装）
├── LICENSE                       # MIT 开源许可
└── README.md                     # 本说明
```

## 安装

**方式一：一键安装（推荐）**

直接在 Edge 打开下面的链接，Tampermonkey 会自动弹出安装页，点"安装"即可：

```
https://raw.githubusercontent.com/ZH-HAO/uestc-course-helper/main/uestc-course-helper.user.js
```

**方式二：手动新建脚本**

1. Edge 安装 **Tampermonkey** 扩展（`edge://extensions` 搜索）
2. 点油猴图标 → **管理面板** → 点 **+**（添加新脚本）
3. 把编辑器里的默认内容**全选删除**，粘贴 `uestc-course-helper.user.js` 的全部代码
4. **Ctrl+S** 保存
5. 打开课程页刷新，右下角出现"刷课助手"浮动面板即成功

> 注意：**不要直接把 `.user.js` 文件拖进 Edge**，Edge 会当成普通文件下载，不会触发油猴安装。

## 功能

| 功能 | 说明 |
|------|------|
| 自动播放 | 视频静音自动播放（绕过浏览器限制） |
| 倍速 | 面板或键盘 `[` / `]` 调节：1 / 1.25 / 1.5 / 2 / 4 / 8 / 16x |
| 拉进度 | 一键跳到末尾前 1 秒，再播完触发平台判定完成 |
| 自动切节 | 视频结束自动点"下一个学习内容"按钮，带 5 次重试 |
| 自动确认 | 自动接受页面 confirm 弹窗 |

## 使用建议

- **倍速别超过 2x**：该课程 `allowed_double_speed=false`，倍速 UI 上限 2x，且平台会记录"倍速"行为到后端
- **拉进度安全**：课程 `allowed_drag=true`（允许拖进度），但每次拖拽都会被记录
- **关掉 F12**：平台有反调试陷阱（`debugger` 断点），开着 DevTools 会卡视频

## 常见问题

### 装了脚本但面板不出现 / 脚本不生效

**最常见原因：Edge 的"允许用户脚本"开关被关了。** Edge 重启或更新后偶尔会重置这个开关，导致所有油猴脚本都不注入。

解决：
1. 地址栏输入 `edge://extensions/` 回车
2. 左下角打开 **"开发人员模式"**
3. 找到 **Tampermonkey** → 点 **"详细信息"** → 找到 **"允许用户脚本"** 开关 → **打开**

### 如何判断脚本到底有没有注入

在油猴管理面板里编辑脚本，在 `// ==/UserScript==` 下面加一行 `alert('脚本注入成功');`，保存后刷新页面：
- **弹窗了** → 脚本注入正常，问题在面板创建逻辑
- **没弹窗** → 脚本没注入，按上一条检查"允许用户脚本"开关

排查完记得把这行 `alert` 删掉。

### 页面报错 / 视频不加载

平台偶发缓存坏 bundle（控制台报 `SyntaxError`）。按 **Ctrl+Shift+R** 强刷清缓存即可。同时关掉 F12，避免反调试断点卡住页面。

## 风险提示

- 脚本直接修改播放器行为，涉及进度/时长数据，请评估后再使用
- 平台会记录"拖拽进度条""倍速"等行为（`reqVideoBehaviorRecord`），异常使用可能被标记

## 维护说明

脚本 v0.2.0 已按平台源码精确适配，改动播放器结构后需同步更新：

- 播放器容器：`#h5player`（xgplayer）
- 下一节按钮：`.next_video_btn`（文本"下一个学习内容"，在 `.xgplayer-replay` 内）
- 完成判定：`updateLearnTime` 上报 `currentTime`，服务端 `studyProcess>=100` 即完成
- 平台机制细节见脚本头部注释

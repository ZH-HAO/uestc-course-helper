# 成电教学资源管理平台 · 刷课助手

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

1. Edge 安装 **Tampermonkey** 扩展（`edge://extensions` 搜索）
2. 把 `uestc-course-helper.user.js` **拖进 Edge**，点安装
3. 打开课程页刷新，右下角出现"刷课助手"浮动面板即成功

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

## 风险提示

- 脚本直接修改播放器行为，涉及进度/时长数据，请评估后再使用
- 平台会记录"拖拽进度条""倍速"等行为（`reqVideoBehaviorRecord`），异常使用可能被标记

## 维护说明

脚本 v0.2.0 已按平台源码精确适配，改动播放器结构后需同步更新：

- 播放器容器：`#h5player`（xgplayer）
- 下一节按钮：`.next_video_btn`（文本"下一个学习内容"，在 `.xgplayer-replay` 内）
- 完成判定：`updateLearnTime` 上报 `currentTime`，服务端 `studyProcess>=100` 即完成
- 平台机制细节见脚本头部注释

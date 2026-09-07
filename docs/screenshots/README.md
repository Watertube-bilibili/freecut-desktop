# 0.3.0 实际界面截图

- `editor-030.png`：1920×1080 专业布局，原创样例、三条轨道和普通关键帧面板。
- `editor-keyframes-030.png`：同一真实项目的专业关键帧面板。
- `editor-transform-030.png`：直接拖动画面中的文字后，由应用实际渲染的状态。
- `mobile-030.png`：1920×1080 手机操作习惯布局，底部素材架。
- `inspector-bottom-030.png`：1100×620 窗口，右侧属性面板滚到底部的回归截图。
- `mobile-controls-030.png`：800×600 窗口，打开底部素材架后，预览区滚动到播放和快捷操作按钮的回归截图。

前四张可通过 `npm run build && node scripts/capture-showcase.cjs` 重新生成。该脚本使用独立 Electron 配置目录，程序化绘制原创山丘、渐变与太阳，生成原创音调节拍，导入真实项目后截图。文字和位置关键帧由应用渲染；界面没有后期拼接或重画，没有使用外部摄影、音乐或剪映素材。

最后两张由 `scripts/regression-effects.cjs` 的隔离测试生成，画面中的色彩图案是 FFmpeg `testsrc2` 测试视频。它们用于说明控件可达性，不是宣传中的创作样例。

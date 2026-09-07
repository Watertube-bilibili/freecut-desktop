# 水管剪辑 · 无声宣传片

55 秒，1920 × 1080，30 fps。按作者要求取消配音、背景音乐、音效以及底部逐句字幕；保留设计好的标题、功能介绍、下载和自愿支持说明，以及准确的作者水印 **@我叫水管同学**。用户可自行添加音乐。

视觉动画从首版 HyperFrames 源工程衍生，去除音频和字幕挂载后重新渲染。最终剪辑使用仓库的 `shuiguan-cut` Skill，通过 **水管剪辑 0.3.0 真实桌面应用**导入该视觉素材，分为七个可独立调整的章节，保存 `.freecut` 工程并导出 MP4。素材内部的动画和画面文字已渲染在视频中；若要逐字修改，请编辑 `../shuiguan-launch-instrumental/` 的视觉源工程。

## 重新制作

1. 按 `../shuiguan-launch-instrumental/README.md` 渲染无声视觉素材。
2. 按 `../../skills/shuiguan-cut/SKILL.md` 准备同版本应用和依赖。
3. 从仓库目录执行下列命令；输出目录必须尚不存在：

```text
node skills/shuiguan-cut/scripts/shuiguan-cut.cjs edit-render --repo . --recipe videos/shuiguan-launch-silent-edit/recipe.json --out-dir renders/shuiguan-launch-silent-freecut --timeout 1800
```

也可加 `--exe <已安装的 FreeCut.exe 路径>` 使用同版本安装版。

## 添加自己的音乐

用水管剪辑打开导出的 `project.freecut`，导入你的音频，把音频放到时间线上并调整音量、淡入淡出和结束位置，再导出。工程已经按七个章节分切画面，方便按音乐节奏调整。

工程引用外部素材，不会把视频嵌入 `.freecut`。换电脑或移动文件后，如果显示素材缺失，点击 **重新链接素材**，选择编辑包中的 `media/visual-source.mp4`，然后保存工程。

软件全部功能永久免费，不设会员、不设付费解锁。爱发电为自愿赞助，不影响任何功能。本项目没有编造赞助链接或收款二维码；B站主页为 https://space.bilibili.com/390310418 。该宣传片的作者署名按作者要求保留，软件不会向用户导出的视频强加水印。

许可来源见视觉源工程的 `SOURCES.md` 及其字体、GSAP 许可。此版本没有使用语音、音乐或音效资产。

# 直连协作 / Direct collaboration

水管剪辑 0.4.0 新增由一台电脑主持的协作房间，不需要购买、部署或注册公共服务器。首页或剪辑页点击“远程协作”，即可创建房间或加入。

## 开始协作

1. 主持人打开工程，点击“远程协作 → 创建房间”，选择端口（默认 `45823`）并填写昵称。只有点击创建房间后才开始监听。
2. 把本机在同一网络内可达的 IPv4 地址、端口和房间密钥发给协作者；也可以复制包含这些信息的邀请码。多网卡电脑应选双方实际能互通的地址，`127.0.0.1` 仅供本机测试。
3. 对方在桌面版点击“加入房间”，填写 IP、端口、密钥，或粘贴邀请码。如果当前工程尚未保存，先保存本地工程再加入。
4. 工程中的素材自动传输并保存在对方电脑，完成后可以独立预览、编辑、保存 `.freecut` 工程和导出视频。每个人的播放头、播放/暂停、布局、界面语言和选中状态保持独立。

双方需要已互通的局域网或 VPN。邀请码只是连接信息的便捷封装，不提供公网中继或自动 NAT 穿透。程序不会修改系统防火墙；如果系统询问入站访问，应根据实际网络情况由用户处理。当前房间协议是带密钥鉴权的 HTTP，未额外加密，只用于可信局域网或已加密的可信 VPN；不要直接暴露在公共网络上。

## 修改、冲突和退出

主持机器保存房间的当前版本，按片段、轨道和参数合并不同位置的编辑。同一个参数同时出现不同改动时，程序会保留本地内容并提示冲突。可以“保留本地并退出协作”，或先保存本地副本，再采用房间版本。远端修改到达后会清空当前本地撤销/重做记录，避免一次撤销把别人的改动退回。

关闭协作面板不会离开房间。使用面板里的“退出协作”离开，主持人使用“结束房间”停止服务；主持人关闭应用后房间同样结束。断线后保留当前工程和已下载素材，可以先保存本地副本，再重新加入。当前不自动合并断线期间的改动。

只共享当前工程的素材清单，服务不提供任意路径读取、文件夹浏览或远端命令执行。加入房间的人可以获得已共享的素材副本，结束房间不会删除对方已下载的文件。不要把不想共享的媒体放进待共享工程的素材库。

当前限制为最多 8 人（含主持人）、256 个素材、工程 JSON 2 MiB、单素材 8 GiB、房间媒体配额 32 GiB，最多 4 个并行媒体传输。素材流式读写并核对 SHA-256，不会整段加载进内存；接收前检查剩余磁盘空间并预留 256 MiB。媒体缓存位于应用数据目录的 `collaboration` 子目录；便携版随 `FreeCutData` 保留。工程引用这些本地文件时，不要删除该目录。

## English

Open **Remote collaboration** from the home screen or editor. One computer hosts the room; others join using its reachable IPv4 address, port (default `45823`), and room key, or paste an invitation containing those values. No public server or account is required. Save an unsaved local project before joining. Project media transfers automatically into local application storage, so each participant can preview, edit, save a project, and export locally.

Use an already connected trusted LAN or encrypted VPN. Invitations do not provide a relay or NAT traversal. The application does not change firewall settings. The room uses authenticated HTTP without additional transport encryption; do not expose it directly to a public network. A loopback address (`127.0.0.1`) only reaches the same computer.

Disjoint changes merge by item and field. Conflicting edits preserve the local draft and offer **Keep local and leave collaboration** or **Save a local copy and use the room version**. Remote updates reset local undo/redo history so undo does not revert another participant's work. Playheads, playback, selection, layout, and language remain local. Closing the panel keeps the connection; leaving or ending the room disconnects it. A host exiting the app ends the room. Disconnections preserve the local project and downloaded media; save locally before rejoining. Offline edits are not automatically merged on reconnect.

Only media declared in the current project is shared, with no arbitrary filesystem access or remote commands. Participants retain downloaded copies after the room ends. Limits: 8 participants including the host, 256 media assets, 2 MiB project JSON, 8 GiB per asset, 32 GiB room media quota, and 4 concurrent transfers. Transfers stream to disk, verify SHA-256, and check for free space with a 256 MiB reserve. Cache files live in `collaboration` under app data (under `FreeCutData` for portable installations). Keep that folder while saved projects reference it.

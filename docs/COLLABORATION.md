# 异地协作 / Remote collaboration

[简体中文](#开始异地协作) · [English](#english)

水管剪辑 / FreeCut 0.4.1 默认通过**异地协作邀请码**连接两台电脑。无需另装 VPN、注册账号或自行搭建服务器；房间由主持人的电脑承载，软件自动联系 HyperDHT 公开发现节点并尝试 NAT 穿透。异地工程与素材通过 Noise 加密连接传输，房主必须保持电脑和软件在线。

部分网络限制 UDP 或阻止 NAT 穿透，不能保证任何两个网络都能连接。软件没有媒体流量中继；失败时请检查网络或换一个网络重试。实现范围、实际验证条件与发行状态见 [0.4.1 验证记录](VERIFICATION-041.md)；局域网或同机测试不等同于异地公网验收通过。

## 开始异地协作

1. 房主打开要共享的工程，进入“远程协作 → 创建房间”。保持默认“异地协作（邀请码）”，可选填昵称，然后点击“创建房间并生成邀请码”。无需填写 IP 或端口。
2. 软件准备网络并发布房间。只有实际开启成功后才显示可复制的邀请码，准备过程中可以“取消连接”。
3. 把完整的 **`freecut2:`** 邀请码发给可信伙伴。对方进入“加入房间”，粘贴邀请码并连接。若当前工程有未保存修改，软件会先要求保存本地工程。
4. 工程及素材自动同步。完成后可各自预览、编辑、保存 `.freecut` 工程和导出视频；播放头、播放/暂停、选中状态、布局和界面语言各自独立。

邀请码包含房间公钥和访问凭据，不要求协作者寻找主机 IP。持有有效邀请码的人可以加入并下载共享素材，因此只把它发给想邀请的人。房主结束房间后，原邀请码不能重新打开已经关闭的房间。

## 连接状态与取消

界面区分准备网络、生成邀请码、连接房间和同步工程与素材，连接尚未完成时不会提前宣布已经加入。报错会保留输入并说明网络不可达、房间无法发布或连接失败等原因。请确认邀请码完整、房主在线，再重试。

准备、发布和连接过程中可以“取消连接”，停止本次尝试并清理相应网络任务。取消或失败不丢弃原有本地工程。关闭面板只收起界面，不会结束房间或取消连接；需要停止时使用“取消连接”“离开房间”或“结束房间”。软件不会自动修改系统防火墙。

## 高级：局域网 / IP 直连

双方已经处于可互通的可信局域网或可信加密 VPN 时，可展开“高级：局域网 / IP 直连”并启用该方式。房主选择端口，默认 `45823`；对方填写主机 IPv4、端口和房间密钥。多网卡电脑应选择双方实际能互通的地址，`127.0.0.1` 只能连接本机。

旧版 **`freecut1:`** 邀请码仍可粘贴加入，它只是 IPv4、端口和密钥的封装，需要主机地址已经可达，不能自动完成异地连接。高级局域网模式使用带密钥鉴权的 HTTP，**没有传输加密**；仅用于可信局域网或可信加密 VPN，不应把该 HTTP 端口直接开放到公网。该模式不需要联系公网发现节点。

## 修改、冲突和离开

主持机器保存房间当前版本。编辑器比较共同基线、本地草稿和房间最新版本，按片段、轨道和字段合并不同位置的编辑。预览对象或时间轴拖动期间暂缓应用远端修改，松手后再合并，避免覆盖正在操作的草稿。

同一字段出现不同修改时，保留本地内容并提示冲突。可以选择“保留本地并退出协作”，或“保存本地副本并采用房间版本”。远端修改到达后会清空当前本地撤销/重做记录，避免撤销伙伴的改动；这不表示能自动解决所有语义冲突。

“离开房间”断开自己的连接；房主“结束房间”或退出应用会结束整个房间。断线保留当前工程与已下载素材，可以先保存本地副本再重新加入。当前不自动合并断线期间的改动。

## 共享范围、缓存和隐私

仅共享当前工程素材清单中已获本机媒体授权的文件，不开放任意路径读取、文件夹浏览或远程命令执行。素材库中未放上时间轴的文件也属于工程清单。参与者得到共享文件的本地副本；结束房间不会删除对方已下载的文件。

异地模式使用公开发现节点找到对方并协助建立连接。发现节点与网络参与者可能看到 IP、端口、时间等连接元数据；工程与媒体通过 Noise 加密连接传输，公开发现节点不会收到它们的明文内容。这不是匿名通信承诺；高级局域网 HTTP 模式也不具备该传输加密。

当前上限为 **8 人（含房主）、256 个素材、工程 JSON 2 MiB、单素材 8 GiB、房间媒体配额 32 GiB、4 路并行素材传输**。素材流式读写并核对 SHA-256，不把整段文件装入内存；接收前检查磁盘剩余空间并预留 256 MiB。缓存位于应用数据目录的 `collaboration` 子目录，便携版随 `FreeCutData` 保留。工程引用这些文件时，请保留对应缓存。

组件来源和许可见 [P2P 组件说明](third-party/p2p/README.md)。软件全部功能永久免费，不设会员、不设付费解锁；协作能力不要求购买账号或服务。

## English

FreeCut 0.4.1 defaults to **invite-based collaboration across networks**. You do not need a separate VPN, an account, or a server of your own. The host's computer runs the room; FreeCut automatically contacts public HyperDHT discovery nodes and attempts NAT traversal. Project and media traffic uses a Noise-encrypted connection. The host must keep the computer and FreeCut running.

Some networks restrict UDP or prevent NAT traversal, so connections are not guaranteed between every pair of networks. FreeCut provides no media traffic relay. If connection fails, check the network or try another one. See the [0.4.1 verification record](VERIFICATION-041.md) for actual test conditions and release status. Local or same-computer tests are not evidence that connections across independent public networks have passed.

### Start a remote room

1. The host opens the project and chooses **Remote collaboration → Create a room**. Keep **Across networks (invite code)** selected, optionally enter a name, and choose **Create room & get invite code**. No IP address or port is needed.
2. FreeCut prepares the network and publishes the room. A copyable invite appears only after the room is actually ready. You can cancel during preparation.
3. Send the complete **`freecut2:`** invite to a trusted collaborator. They choose **Join a room**, paste the code, and connect. Any unsaved local project must be saved first.
4. The project and its media download automatically. Participants can then preview, edit, save `.freecut` projects, and export locally. Playheads, playback, selection, layout, and interface language remain independent.

The invite contains the room public key and access credentials. Collaborators do not need to find or enter the host's IP address. Anyone holding a valid invite can join and download shared media, so send it only to intended participants. An old invite cannot reopen a room after the host ends it.

### Status, cancellation, and failures

The interface distinguishes preparing the network, publishing an invite, connecting, and syncing media. It does not report a successful join while connection is pending. Failures retain your input and show a network, publication, or connection error. Check that the invite is complete and the host is online before retrying.

**Cancel connection** stops a pending preparation, publication, or connection attempt and cleans up its network tasks. Cancellation and failure preserve the original local project. Closing the panel only hides it; use **Cancel connection**, **Leave room**, or **End room** to stop. FreeCut does not automatically change firewall settings.

### Advanced: LAN / direct IP

For computers on an already reachable trusted LAN or trusted encrypted VPN, expand **Advanced: LAN / direct IP** and enable that mode. The host selects a port, default `45823`; the other computer enters the host IPv4 address, port, and key. Choose a mutually reachable address on computers with multiple interfaces. `127.0.0.1` only reaches the same computer.

Legacy **`freecut1:`** invites remain supported. They encode an IPv4 address, port, and key; that address must already be reachable, and these codes do not automatically connect across networks. LAN mode uses authenticated HTTP **without transport encryption**. Use a trusted LAN or trusted encrypted VPN, and do not expose its HTTP port directly to the public internet. This mode does not contact public discovery nodes.

### Edits, conflicts, and leaving

The host stores the room's current version. A three-way merge compares the common baseline, local draft, and latest room version. Disjoint item and field changes can merge. Remote changes wait during an active preview or timeline drag, then merge after the gesture ends.

Conflicting changes preserve your local draft. Choose **Keep my version & leave room**, or **Save my copy & use room version**. Remote updates reset local undo/redo history so undo does not revert a collaborator's changes. This does not automatically resolve every semantic editing conflict.

Leaving disconnects your computer. Ending the room or closing the host application disconnects everyone. Disconnections preserve local projects and downloaded media; save a local copy before rejoining. Offline edits are not automatically merged on reconnect.

### Shared files, storage, and privacy

Only authorized media declared in the current project is shared. There is no arbitrary filesystem access, directory browsing, or remote command execution. Media in the project library is included even if it is not placed on the timeline. Participants retain downloaded copies after the room ends.

Remote mode uses public discovery nodes to locate peers and help establish a connection. Discovery nodes and network participants may observe IP addresses, ports, timing, and other network metadata. Project and media contents travel through the Noise-encrypted connection; public discovery nodes do not receive them in plaintext. This is not a promise of anonymous communication. Advanced LAN HTTP mode does not have that transport encryption.

Limits are **8 participants including the host, 256 assets, 2 MiB project JSON, 8 GiB per asset, 32 GiB room media quota, and 4 concurrent transfers**. Transfers stream to disk, verify SHA-256, and check free space with a 256 MiB reserve. Cached files live in `collaboration` under app data, or under `FreeCutData` for the portable edition. Keep the cache while saved projects reference those files.

See [P2P component sources and licenses](third-party/p2p/README.md). All FreeCut features are free forever, without membership or paid unlocks. Collaboration requires no paid account or subscription. If FreeCut helps you, [give the project a Star](https://github.com/Watertube-bilibili/freecut-desktop).
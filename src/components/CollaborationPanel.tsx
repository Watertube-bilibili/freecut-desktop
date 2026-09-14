import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Check, Copy, Link2, LoaderCircle, Monitor, Network, Users, X } from 'lucide-react';
import type { CollaborationJoinOptions, CollaborationState } from '../collaboration-types';
import { statusText, useI18n } from '../i18n';
import './collaboration-panel.css';

export interface CollaborationPanelProps {
  state: CollaborationState;
  busy: boolean;
  error?: string;
  conflict?: string;
  onKeepLocal?: () => void;
  onUseRemote?: () => void;
  onHost: (port: number, name: string) => Promise<void>;
  onJoin: (options: CollaborationJoinOptions) => Promise<void>;
  onLeave: () => Promise<void>;
  onClose: () => void;
}

const NAME_KEY = 'freecut-collaboration-name';
const CONNECTION_COPY: Record<string, string> = {
  'Disconnected. Downloaded media remains available on this computer.':
    '已断开连接，下载的素材仍保留在本机。',
  'Preparing project media…': '正在准备工程素材…',
  'Room open. Share the IP address, port, and key over a trusted connection.':
    '房间已开启，请把 IP、端口和密钥分享给可信伙伴。',
  'Connection lost. Your local project and downloaded media are retained.':
    '连接已中断，本地工程和下载的素材已保留。',
  'Connecting and downloading project media…': '正在连接并下载工程素材…',
  'Connected. Edits synchronize with the host.': '已连接，编辑内容会与主机同步。',
  'The host did not respond.': '主机没有响应，请检查 IP、端口和网络连接。',
  'Media transfer timed out.': '素材传输超时，请检查网络后重试。',
  'Media upload timed out.': '素材上传超时，请检查网络后重试。',
  'Not connected.': '尚未连接协作房间。',
  'Collaboration was closed.': '协作房间已关闭。',
  'Import missing media before sharing this project.': '请先重新导入丢失的素材，再共享工程。',
  'Media download failed integrity verification.': '素材下载校验失败，请重新加入房间。',
  'Invalid invitation.': '邀请码无效，请完整复制主机提供的邀请码。',
  'Enter an IPv4 address, port 1024–65535, and the room key.':
    '请填写有效的 IPv4 地址、1024 至 65535 之间的端口，以及完整的房间密钥。',
  'Invalid room key or browser request.': '房间密钥不正确，请向主机确认后重试。',
  'This room already has 8 editors.': '房间已有 8 位成员，请等其他成员退出后再加入。',
  'The host closed this room. Your local project is retained.':
    '主机已结束房间，你的本地工程已保留。',
};

function connectionText(message: string) {
  const detail = message
    .replace(/^Error invoking remote method '[^']+': Error:\s*/, '')
    .replace(/^Error:\s*/, '');
  return statusText(CONNECTION_COPY[detail] || message);
}

function readName() {
  try {
    return window.localStorage.getItem(NAME_KEY)?.slice(0, 32) || '';
  } catch {
    return '';
  }
}

function addressWithPort(address: string, port: number) {
  return `${address.includes(':') && !address.startsWith('[') ? `[${address}]` : address}:${port}`;
}

export default function CollaborationPanel({
  state,
  busy,
  error,
  conflict,
  onKeepLocal,
  onUseRemote,
  onHost,
  onJoin,
  onLeave,
  onClose,
}: CollaborationPanelProps) {
  const { t } = useI18n();
  const id = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [tab, setTab] = useState<'host' | 'join'>('host');
  const [joinMethod, setJoinMethod] = useState<'address' | 'invite'>('address');
  const [name, setName] = useState(readName);
  const [port, setPort] = useState('45823');
  const [host, setHost] = useState('');
  const [key, setKey] = useState('');
  const [invite, setInvite] = useState('');
  const [localError, setLocalError] = useState('');
  const [copied, setCopied] = useState('');
  const [pending, setPending] = useState(false);
  const connected = state.mode === 'hosting' || state.mode === 'joined';
  const working = busy || pending || state.mode === 'connecting';
  const shownError = localError || error || state.error;

  useEffect(() => {
    const previous = document.activeElement;
    closeButton.current?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  useEffect(() => {
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', closeOnEscape, true);
    return () => document.removeEventListener('keydown', closeOnEscape, true);
  }, [onClose]);

  useEffect(() => {
    // Connecting replaces the submit button. Keep keyboard focus inside the dialog.
    if (!dialog.current?.contains(document.activeElement)) closeButton.current?.focus();
  }, [connected]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(''), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  function handleKeys(event: KeyboardEvent<HTMLDivElement>) {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'Tab') {
      const focusable = Array.from(
        dialog.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]',
        ) || [],
      ).filter((element) => element.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  }

  async function run(action: () => Promise<void>) {
    setLocalError('');
    setPending(true);
    try {
      await action();
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPending(false);
    }
  }

  async function connect() {
    const parsedPort = Number(port);
    if (
      (tab === 'host' || joinMethod === 'address') &&
      (!Number.isInteger(parsedPort) || parsedPort < 1024 || parsedPort > 65535)
    ) {
      setLocalError(t('端口请输入 1024 至 65535 之间的整数。'));
      return;
    }
    const displayName = name.trim();
    try {
      window.localStorage.setItem(NAME_KEY, displayName);
    } catch {
      // Joining still works when browser storage is unavailable.
    }
    await run(() =>
      tab === 'host'
        ? onHost(parsedPort, displayName)
        : onJoin(
            joinMethod === 'invite'
              ? { invite: invite.trim(), name: displayName }
              : { host: host.trim(), port: parsedPort, key: key.trim(), name: displayName },
          ),
    );
  }

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
    } catch {
      setLocalError(t('暂时无法复制，请选中文本后手动复制。'));
    }
  }

  function copyButton(value: string, label: string) {
    return (
      <button
        type="button"
        className="collab-copy"
        aria-label={label}
        title={label}
        onClick={() => void copy(value, label)}
      >
        {copied === label ? <Check size={16} /> : <Copy size={16} />}
      </button>
    );
  }

  return (
    <div className="collab-backdrop" onKeyDown={handleKeys}>
      <div
        ref={dialog}
        className="collab-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
      >
        <header className="collab-header">
          <div className="collab-heading">
            <span className="collab-heading-icon">
              <Users size={22} />
            </span>
            <div>
              <h2 id={`${id}-title`}>{t('远程协作')}</h2>
              <p id={`${id}-description`}>{t('用自己的电脑开房间，一起剪同一个工程。')}</p>
            </div>
          </div>
          <button
            ref={closeButton}
            type="button"
            className="collab-close"
            aria-label={t('关闭协作面板')}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>

        <div className="collab-body">
          {connected ? (
            <>
              <section className="collab-connection" aria-label={t('连接状态')}>
                <div className="collab-connection-title">
                  <span className="collab-status-dot" />
                  <strong>{state.mode === 'hosting' ? t('房间已开启') : t('已加入协作')}</strong>
                  <span className="collab-role">
                    {state.mode === 'hosting' ? t('本机是主机') : t('协作成员')}
                  </span>
                </div>
                <p>
                  {state.mode === 'hosting'
                    ? t('把连接地址和房间密钥发给伙伴，保持本机和软件运行。')
                    : t('你们的时间轴修改会同步，每个人可以独立预览。')}
                </p>
                {state.mode === 'hosting' && (
                  <div className="collab-sharing">
                    <label>{t('连接地址')}</label>
                    {state.addresses.map((address) => {
                      const value = addressWithPort(address, state.port);
                      return (
                        <div className="collab-copy-row" key={address}>
                          <Network size={16} aria-hidden="true" />
                          <input
                            aria-label={t('连接地址')}
                            value={value}
                            readOnly
                            onFocus={(event) => event.target.select()}
                          />
                          {copyButton(value, t('复制地址 {address}', { address: value }))}
                        </div>
                      );
                    })}
                    {state.addresses.length === 0 && (
                      <p>{t('未找到局域网地址，请检查本机网络连接。')}</p>
                    )}
                    {state.key && (
                      <>
                        <label htmlFor={`${id}-room-key`}>{t('房间密钥')}</label>
                        <div className="collab-copy-row">
                          <input
                            id={`${id}-room-key`}
                            value={state.key}
                            readOnly
                            spellCheck={false}
                            onFocus={(event) => event.target.select()}
                          />
                          {copyButton(state.key, t('复制房间密钥'))}
                        </div>
                      </>
                    )}
                    {state.invite && (
                      <button
                        type="button"
                        className="collab-invite-button"
                        onClick={() => void copy(state.invite!, t('复制邀请码'))}
                      >
                        {copied === t('复制邀请码') ? <Check size={16} /> : <Link2 size={16} />}
                        {copied === t('复制邀请码') ? t('已复制') : t('复制邀请码')}
                      </button>
                    )}
                  </div>
                )}
              </section>

              <section className="collab-members" aria-labelledby={`${id}-members`}>
                <h3 id={`${id}-members`}>
                  {t('房间成员')} <span>{state.peers.length}</span>
                </h3>
                <ul>
                  {state.peers.map((peer) => (
                    <li key={peer.id}>
                      <span className="collab-avatar" aria-hidden="true">
                        {Array.from(peer.name || '?')[0]}
                      </span>
                      <span className="collab-member-name">{peer.name || t('剪辑伙伴')}</span>
                      {peer.id === state.peerId && <small>{t('你')}</small>}
                      <span className="collab-online">{t('在线')}</span>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          ) : (
            <>
              <div className="collab-tabs" role="tablist" aria-label={t('协作方式')}>
                {(['host', 'join'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    id={`${id}-tab-${value}`}
                    aria-selected={tab === value}
                    aria-controls={`${id}-form`}
                    tabIndex={tab === value ? 0 : -1}
                    disabled={working}
                    onClick={() => {
                      setTab(value);
                      setLocalError('');
                    }}
                    onKeyDown={(event) => {
                      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                        event.preventDefault();
                        const next =
                          event.key === 'Home'
                            ? 'host'
                            : event.key === 'End'
                              ? 'join'
                              : tab === 'host'
                                ? 'join'
                                : 'host';
                        setTab(next);
                        document.getElementById(`${id}-tab-${next}`)?.focus();
                      }
                    }}
                  >
                    {value === 'host' ? <Monitor size={17} /> : <Link2 size={17} />}
                    {value === 'host' ? t('本机开房间') : t('加入房间')}
                  </button>
                ))}
              </div>

              <form
                id={`${id}-form`}
                className="collab-form"
                role="tabpanel"
                aria-labelledby={`${id}-tab-${tab}`}
                onSubmit={(event) => {
                  event.preventDefault();
                  void connect();
                }}
              >
                <label htmlFor={`${id}-name`}>
                  {t('你的昵称')} <span>{t('选填')}</span>
                </label>
                <input
                  id={`${id}-name`}
                  autoComplete="nickname"
                  value={name}
                  maxLength={32}
                  placeholder={t('让伙伴知道你是谁')}
                  disabled={working}
                  onChange={(event) => setName(event.target.value)}
                />

                {tab === 'join' && (
                  <fieldset className="collab-join-method" disabled={working}>
                    <legend>{t('连接方式')}</legend>
                    <label>
                      <input
                        type="radio"
                        name={`${id}-method`}
                        checked={joinMethod === 'address'}
                        onChange={() => setJoinMethod('address')}
                      />
                      {t('IP 地址与端口')}
                    </label>
                    <label>
                      <input
                        type="radio"
                        name={`${id}-method`}
                        checked={joinMethod === 'invite'}
                        onChange={() => setJoinMethod('invite')}
                      />
                      {t('邀请码')}
                    </label>
                  </fieldset>
                )}

                {tab === 'join' && joinMethod === 'invite' ? (
                  <>
                    <label htmlFor={`${id}-invite`}>{t('粘贴邀请码')}</label>
                    <textarea
                      id={`${id}-invite`}
                      value={invite}
                      spellCheck={false}
                      autoComplete="off"
                      placeholder="freecut1:…"
                      rows={3}
                      maxLength={4096}
                      required
                      disabled={working}
                      onChange={(event) => setInvite(event.target.value)}
                    />
                    <p className="collab-hint">
                      {t('邀请码包含地址和房间密钥，需要能直接连接主机。')}
                    </p>
                  </>
                ) : (
                  <div
                    className={`collab-address-fields ${tab === 'host' ? 'collab-host-port' : ''}`}
                  >
                    {tab === 'join' && (
                      <div>
                        <label htmlFor={`${id}-host`}>{t('主机 IP 地址')}</label>
                        <input
                          id={`${id}-host`}
                          value={host}
                          placeholder="192.168.1.23"
                          spellCheck={false}
                          autoComplete="off"
                          required
                          maxLength={255}
                          disabled={working}
                          onChange={(event) => setHost(event.target.value)}
                        />
                      </div>
                    )}
                    <div>
                      <label htmlFor={`${id}-port`}>{t('端口')}</label>
                      <input
                        id={`${id}-port`}
                        value={port}
                        type="number"
                        min={1024}
                        max={65535}
                        step={1}
                        required
                        disabled={working}
                        onChange={(event) => setPort(event.target.value)}
                      />
                    </div>
                  </div>
                )}

                {tab === 'join' && joinMethod === 'address' && (
                  <>
                    <label htmlFor={`${id}-key`}>{t('房间密钥')}</label>
                    <input
                      id={`${id}-key`}
                      value={key}
                      spellCheck={false}
                      autoComplete="off"
                      placeholder={t('由开房间的人提供')}
                      maxLength={256}
                      required
                      disabled={working}
                      onChange={(event) => setKey(event.target.value)}
                    />
                  </>
                )}

                <div className="collab-action-summary">
                  {tab === 'host' ? (
                    <>
                      <strong>{t('共享当前工程')}</strong>
                      <p>{t('伙伴加入后会下载工程中引用的素材，不会获得你电脑上的其他文件。')}</p>
                    </>
                  ) : (
                    <>
                      <strong>{t('从主机同步工程与素材')}</strong>
                      <p>{t('加入后打开协作工程；当前工程的未保存修改会先询问保存。')}</p>
                    </>
                  )}
                </div>
                <button className="primary collab-connect-button" type="submit" disabled={working}>
                  {working ? (
                    <LoaderCircle size={17} className="collab-spinner" />
                  ) : tab === 'host' ? (
                    <Monitor size={17} />
                  ) : (
                    <Link2 size={17} />
                  )}
                  {working
                    ? t('正在连接…')
                    : tab === 'host'
                      ? t('开启房间并共享工程')
                      : t('连接并加入房间')}
                </button>
              </form>
            </>
          )}

          {(state.transferring || state.mode === 'connecting') && (
            <div className="collab-progress" role="status">
              <LoaderCircle size={16} className="collab-spinner" />
              <span>{state.transferring ? t('正在同步工程与素材…') : t('正在连接…')}</span>
            </div>
          )}
          {state.message && (
            <p className="collab-message" role="status">
              {connectionText(state.message)}
            </p>
          )}
          {shownError && (
            <p className="collab-error" role="alert">
              {connectionText(shownError)}
            </p>
          )}
          {conflict && (
            <div className="collab-conflict" role="status">
              <p>{statusText(conflict)}</p>
              {(onKeepLocal || onUseRemote) && (
                <div className="collab-conflict-actions">
                  {onKeepLocal && (
                    <button type="button" disabled={busy || pending} onClick={onKeepLocal}>
                      {t('保留本地并退出协作')}
                    </button>
                  )}
                  {onUseRemote && (
                    <button type="button" disabled={busy || pending} onClick={onUseRemote}>
                      {t('保存本地副本并采用房间版本')}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          <span className="collab-sr-only" role="status">
            {copied ? t('已复制') : ''}
          </span>

          <details className="collab-help">
            <summary>{t('怎样让两台电脑连上？')}</summary>
            <p>
              {t('无需公共服务器。同一局域网或同一 VPN 内，输入主机 IP、端口和房间密钥即可加入。')}
            </p>
            <p>
              {t(
                '这是未加密的直接连接，请在可信网络中使用。跨网络时需要先建立可信 VPN；邀请码不会自动穿透路由器。',
              )}
            </p>
            <p>
              {t(
                '仅共享当前工程及其引用的素材。素材会下载到参与者本机，方便各自预览、保存和导出。',
              )}
            </p>
          </details>
        </div>

        <footer className="collab-footer">
          <span>
            {connected ? t('关闭面板后，协作连接仍会保留。') : t('本机直连 · 无需注册账号')}
          </span>
          {connected && (
            <button
              type="button"
              className="collab-leave"
              disabled={busy || pending}
              onClick={() => void run(onLeave)}
            >
              {state.mode === 'hosting' ? t('结束房间') : t('离开房间')}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

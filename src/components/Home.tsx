import { useEffect, useState } from 'react';
import {
  FolderOpen,
  Plus,
  Settings,
  Info,
  Search,
  Film,
  ExternalLink,
  Trash2,
  ArrowUpRight,
  Smartphone,
  Monitor,
  Play,
  Clock3,
  ChevronRight,
} from 'lucide-react';
import type { ProjectSummary } from '../types';
import './home.css';
import { UpdateSettings } from './UpdateNotice';
import BrandIcon from './BrandIcon';

interface Props {
  projects: ProjectSummary[];
  mobile: boolean;
  mode: 'easy' | 'pro';
  setMobile: (value: boolean) => void;
  setMode: (value: 'easy' | 'pro') => void;
  create: () => void;
  open: () => void;
  demo: () => void;
  resume: () => void;
  hasSession: boolean;
  openRecent: (id: string) => void;
  removeRecent: (id: string) => void;
  notify: (message: string) => void;
}
const links = {
  bilibili: 'https://space.bilibili.com/390310418?spm_id_from=333.1007.0.0',
  github: 'https://github.com/Watertube-bilibili/freecut-desktop',
};

export default function Home(props: Props) {
  const [page, setPage] = useState<'projects' | 'settings' | 'about'>('projects');
  const [query, setQuery] = useState('');
  const [order, setOrder] = useState('recent');
  const [info, setInfo] =
    useState<Awaited<ReturnType<NonNullable<Window['freecut']>['getInfo']>>>();
  useEffect(() => {
    void window.freecut
      ?.getInfo()
      .then(setInfo)
      .catch((e) => props.notify(String(e)));
  }, []);
  const projects = props.projects
    .filter((p) => p.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
    .sort((a, b) =>
      order === 'name'
        ? a.name.localeCompare(b.name, 'zh-CN')
        : b.updatedAt.localeCompare(a.updatedAt),
    );
  async function external(kind: keyof typeof links) {
    try {
      if (window.freecut) await window.freecut.openExternal(kind);
      else window.open(links[kind], '_blank', 'noopener,noreferrer');
    } catch (e) {
      props.notify((e as Error).message);
    }
  }
  return (
    <div className="home-shell">
      <aside className="home-sidebar">
        <div className="home-brand">
          <span className="brand-symbol">
            <BrandIcon size={42} />
          </span>
          <div>
            <strong>水管剪辑</strong>
            <small>by 我叫我水管同学</small>
          </div>
        </div>
        <nav aria-label="首页导航">
          <button
            className={page === 'projects' ? 'active' : ''}
            onClick={() => setPage('projects')}
          >
            <FolderOpen size={19} />
            我的项目<span>{props.projects.length}</span>
          </button>
          <button
            className={page === 'settings' ? 'active' : ''}
            onClick={() => setPage('settings')}
          >
            <Settings size={19} />
            设置
          </button>
          <button className={page === 'about' ? 'active' : ''} onClick={() => setPage('about')}>
            <Info size={19} />
            关于
          </button>
        </nav>
        <div className="home-sidebar-bottom">
          <span className="status-dot" />
          本地创作，自由表达<small>FreeCut {info?.version ?? '0.3.0'}</small>
        </div>
      </aside>
      <main className="home-main">
        {page === 'projects' ? (
          <>
            <header className="home-heading">
              <div>
                <span className="home-eyebrow">你的创作空间</span>
                <h1>我的项目</h1>
              </div>
              <button onClick={props.open}>
                <FolderOpen size={16} />
                打开项目
              </button>
            </header>
            <section className="home-start" aria-label="开始创作">
              <button className="home-create" aria-label="新建项目" onClick={props.create}>
                <span className="home-plus">
                  <Plus size={32} />
                </span>
                <span>
                  <strong>新建项目</strong>
                  <small>从一段素材，开始你的下一部作品</small>
                </span>
                <ArrowUpRight size={24} />
              </button>
              <button className="home-demo" onClick={props.hasSession ? props.resume : props.demo}>
                <Play size={25} />
                <strong>{props.hasSession ? '继续编辑' : '体验示例工程'}</strong>
                <small>{props.hasSession ? '回到当前工作台' : '试试多轨剪辑和关键帧'}</small>
                <ChevronRight size={17} />
              </button>
            </section>
            <div className="home-list-heading">
              <h2>
                最近项目 <span>{props.projects.length}</span>
              </h2>
              <div>
                <label className="home-search">
                  <Search size={15} />
                  <input
                    aria-label="搜索项目"
                    placeholder="搜索项目名称"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
                <select
                  aria-label="项目排序"
                  value={order}
                  onChange={(e) => setOrder(e.target.value)}
                >
                  <option value="recent">最近打开</option>
                  <option value="name">名称排序</option>
                </select>
              </div>
            </div>
            {projects.length ? (
              <div className="home-project-grid">
                {projects.map((p) => (
                  <article className={`home-project ${p.missing ? 'missing' : ''}`} key={p.id}>
                    <button
                      className="home-project-open"
                      onClick={() => props.openRecent(p.id)}
                      aria-label={`打开项目 ${p.name}`}
                    >
                      <div className="home-project-cover">
                        <Film size={34} />
                        <span>
                          {p.width} × {p.height}
                        </span>
                        <b>
                          {Math.floor(p.duration / 60)
                            .toString()
                            .padStart(2, '0')}
                          :
                          {Math.floor(p.duration % 60)
                            .toString()
                            .padStart(2, '0')}
                        </b>
                      </div>
                      <div className="home-project-details">
                        <strong title={p.name}>{p.name}</strong>
                        <span>
                          <Clock3 size={12} />
                          {new Date(p.updatedAt).toLocaleString('zh-CN', {
                            month: 'numeric',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}{' '}
                          · {p.clipCount} 个片段
                        </span>
                        {p.missing && <em>文件已移动，请重新打开项目</em>}
                      </div>
                    </button>
                    <div className="home-project-actions">
                      <span title={p.path}>{p.path}</span>
                      <button
                        title={`定位项目 ${p.name}`}
                        onClick={() =>
                          void window.freecut
                            ?.showItem(p.path)
                            .catch((e) => props.notify(String(e)))
                        }
                        disabled={p.missing}
                      >
                        <FolderOpen size={14} />
                      </button>
                      <button
                        title={`从列表移除 ${p.name}（保留文件）`}
                        onClick={() => props.removeRecent(p.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="home-empty">
                <FolderOpen size={43} />
                <h3>{query ? '没有找到这个项目' : '你的作品，从这里开始'}</h3>
                <p>
                  {query
                    ? '换一个名称试试。'
                    : '新建并保存项目后，会在这里留下记录。已有 .freecut 工程可以直接打开。'}
                </p>
                {!query && (
                  <button onClick={props.open}>
                    打开已有项目
                    <ArrowUpRight size={15} />
                  </button>
                )}
              </div>
            )}
            <p className="home-footnote">
              项目保存在你的电脑上。这里只记录最近打开和保存的工程；从列表移除会保留原文件。
            </p>
          </>
        ) : page === 'settings' ? (
          <>
            <header className="home-heading">
              <div>
                <span className="home-eyebrow">按你的习惯来</span>
                <h1>设置</h1>
              </div>
            </header>
            <section className="home-settings">
              <h2>编辑器</h2>
              <div className="home-setting">
                <div>
                  <strong>工作台布局</strong>
                  <p>进入编辑器后，也可以点击左上角图标随时切换。</p>
                </div>
                <div className="home-segment">
                  <button aria-pressed={!props.mobile} onClick={() => props.setMobile(false)}>
                    <Monitor size={16} />
                    专业布局
                  </button>
                  <button aria-pressed={props.mobile} onClick={() => props.setMobile(true)}>
                    <Smartphone size={16} />
                    手机风格
                  </button>
                </div>
              </div>
              <div className="home-setting">
                <div>
                  <strong>关键帧操作模式</strong>
                  <p>普通模式一键记录画面；专业模式可分别编辑参数和缓动方式。</p>
                </div>
                <div className="home-segment">
                  <button
                    aria-pressed={props.mode === 'easy'}
                    onClick={() => props.setMode('easy')}
                  >
                    普通（易用）
                  </button>
                  <button aria-pressed={props.mode === 'pro'} onClick={() => props.setMode('pro')}>
                    专业
                  </button>
                </div>
              </div>
              <div className="home-setting">
                <div>
                  <strong>新手引导</strong>
                  <p>重新介绍布局切换、素材导入和剪辑流程。</p>
                </div>
                <button
                  onClick={() => {
                    localStorage.removeItem('freecut-onboarded');
                    props.notify('下次进入编辑器时将重新显示新手引导。');
                  }}
                >
                  下次显示引导
                </button>
              </div>
            </section>
            <UpdateSettings />
            <section className="home-settings">
              <h2>本地数据与模型</h2>
              <div className="home-setting">
                <div>
                  <strong>{info?.portable ? '便携版数据目录' : '应用数据目录'}</strong>
                  <p className="home-data-path">
                    {info?.userData ?? '浏览器预览的数据保存在当前浏览器中。'}
                  </p>
                </div>
              </div>
              <div className="home-setting">
                <div>
                  <strong>自动字幕 · 语音朗读</strong>
                  <p>
                    在编辑器的「AI 语音」中一键下载、部署模型。模型按需下载，安装包内不预装。ChatTTS
                    的模型使用范围请查看模型面板说明。
                  </p>
                </div>
              </div>
            </section>
          </>
        ) : (
          <>
            <header className="home-heading">
              <div>
                <span className="home-eyebrow">认识水管剪辑</span>
                <h1>关于</h1>
              </div>
            </header>
            <section className="home-about">
              <span className="brand-symbol">
                <BrandIcon size={84} />
              </span>
              <h2>
                水管剪辑 <span>by 我叫我水管同学</span>
              </h2>
              <p className="home-about-version">
                版本 {info?.version ?? '0.3.0'} ·{' '}
                {info?.portable
                  ? 'Windows 便携版'
                  : info?.platform === 'darwin'
                    ? 'macOS 桌面版'
                    : info
                      ? 'Windows 桌面版'
                      : '浏览器预览'}
              </p>
              <p>
                一款开源的桌面视频编辑器。多轨剪辑、关键帧、双布局与按需下载的 AI
                语音工具，让每一帧都有你的想法。
              </p>
              <div className="home-about-links">
                <button className="primary" onClick={() => void external('bilibili')}>
                  我的 B站主页
                  <ExternalLink size={16} />
                </button>
                <button onClick={() => void external('github')}>
                  GitHub · 源码与下载
                  <ExternalLink size={16} />
                </button>
              </div>
              <div className="home-about-address">@我叫我水管同学 · space.bilibili.com/390310418</div>
              <p>
                由初中生使用 GPT-6 与 Codex
                自主制作。全部功能永久免费，不设会员，不设付费解锁，导出无水印。自愿赞助不影响任何功能使用。
              </p>
              <p className="home-license">
                FreeCut 以 GPL-3.0 开源。第三方组件和可选 AI 模型遵循各自许可证，详见仓库的
                THIRD_PARTY_NOTICES。当前为预览版本，持续完善中。
              </p>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

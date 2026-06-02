import { useState } from 'react';

export function App() {
  const [currentDirectory, setCurrentDirectory] = useState<string | null>(null);

  const folders = ['客户资料', '2024 合同', '报价单', '访谈记录', '交付文档'];
  const selectedFile = {
    name: '客户访谈记录.md',
    type: 'Markdown',
    size: '42 KB',
    modifiedAt: '2026-06-01 16:20'
  };

  const handleSelectDirectory = async () => {
    const result = await window.aiWorkspace.selectDirectory();

    if (!result.canceled && result.path) {
      setCurrentDirectory(result.path);
    }
  };

  return (
    <main className="workspace-shell">
      <header className="top-bar">
        <div>
          <p className="product-name">轻量级 AI 工作区连接器</p>
          <div className="breadcrumb">{currentDirectory ?? '尚未选择本地目录'}</div>
        </div>
        <div className="top-actions">
          <input className="search-input" placeholder="搜索当前目录" />
          <button className="ghost-button">列表视图</button>
          <span className="safe-badge">只读模式</span>
        </div>
      </header>

      <section className="workspace-grid">
        <aside className="folder-panel">
          <div className="folder-header">
            <div className="panel-title">文件目录</div>
            <button className="add-folder-button" onClick={handleSelectDirectory}>选择目录</button>
          </div>
          <div className="current-directory">
            当前目录：{currentDirectory ?? '请选择一个本地目录'}
          </div>
          <nav className="folder-list">
            {folders.map((folder) => (
              <button className={folder === '访谈记录' ? 'folder-item active' : 'folder-item'} key={folder}>
                <span className="folder-icon">▸</span>
                {folder}
              </button>
            ))}
          </nav>
        </aside>

        <section className="file-panel">
          <div className="panel-heading">
            <div>
              <h1>{selectedFile.name}</h1>
              <p>{selectedFile.type} · {selectedFile.size} · 修改于 {selectedFile.modifiedAt}</p>
            </div>
          </div>

          <div className="preview-card">
            <div className="preview-toolbar">
              <span className="status-text">只读预览</span>
              <span>当前只是界面占位，下一步才接真实文件读取</span>
            </div>
            <article className="file-preview">
              <h2>客户访谈记录</h2>
              <p>客户希望把 2024 年合同、报价单和访谈记录整理成一份清晰摘要。</p>
              <p>重点关注：合作范围、付款节点、交付时间、潜在风险。</p>
              <p>用户可以在右侧向 AI 提问，AI 读取真实文件前需要先展示文件清单并等待确认。</p>
            </article>
          </div>
        </section>

        <aside className="ai-panel">
          <div className="context-box">
            <p>当前引用文件</p>
            <span>客户访谈记录.md</span>
          </div>
          <div className="message-list">
            <div className="message user-message">帮我总结这个客户的主要诉求。</div>
            <div className="message ai-message">我会基于你选择的文件回答。读取前会先展示文件清单并等待确认。</div>
          </div>
          <div className="chat-input-row">
            <input placeholder="输入问题，或先选择文件" />
            <button>发送</button>
          </div>
        </aside>
      </section>

      <footer className="status-bar">
        <span>只读模式</span>
        <span>本次会话已读取 0 个文件</span>
        <span>AI 读取记录</span>
      </footer>
    </main>
  );
}

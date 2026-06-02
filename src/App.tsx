export function App() {
  const folders = ['桌面', '下载', '文档', '图片', '项目', '最近访问'];
  const files = [
    { name: '2024 合同汇总', type: '文件夹', size: '-', status: '可访问' },
    { name: '客户访谈记录.md', type: 'Markdown', size: '42 KB', status: '已选择' },
    { name: '报价单.xlsx', type: 'Excel', size: '86 KB', status: '可访问' },
    { name: '身份证扫描件.pdf', type: 'PDF', size: '1.8 MB', status: '风险提示' }
  ];

  return (
    <main className="workspace-shell">
      <header className="top-bar">
        <div>
          <p className="product-name">轻量级 AI 工作区连接器</p>
          <div className="breadcrumb">文档 / 客户资料 / 2024 合同</div>
        </div>
        <div className="top-actions">
          <input className="search-input" placeholder="搜索当前目录" />
          <button className="ghost-button">列表视图</button>
          <span className="safe-badge">只读模式</span>
        </div>
      </header>

      <section className="workspace-grid">
        <aside className="folder-panel">
          <div className="panel-title">常用目录</div>
          <nav className="folder-list">
            {folders.map((folder) => (
              <button className={folder === '文档' ? 'folder-item active' : 'folder-item'} key={folder}>
                <span className="folder-icon">▸</span>
                {folder}
              </button>
            ))}
          </nav>
        </aside>

        <section className="file-panel">
          <div className="panel-heading">
            <div>
              <h1>2024 合同</h1>
              <p>4 个项目，当前目录可访问</p>
            </div>
            <button className="primary-button">选择目录</button>
          </div>

          <div className="file-table">
            <div className="file-row table-head">
              <span>名称</span>
              <span>类型</span>
              <span>大小</span>
              <span>状态</span>
            </div>
            {files.map((file) => (
              <div className="file-row" key={file.name}>
                <span className="file-name">{file.name}</span>
                <span>{file.type}</span>
                <span>{file.size}</span>
                <span className={file.status === '风险提示' ? 'risk-text' : 'status-text'}>{file.status}</span>
              </div>
            ))}
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

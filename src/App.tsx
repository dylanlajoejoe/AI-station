import { useEffect, useState } from 'react';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

function formatFileSize(size: number | null) {
  if (size === null) {
    return '-';
  }

  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatModifiedAt(value: string) {
  return new Date(value).toLocaleString('zh-CN', {
    hour12: false
  });
}

export function App() {
  const [currentDirectory, setCurrentDirectory] = useState<string | null>(null);
  const [fileTree, setFileTree] = useState<FileTreeNode[]>([]);
  const [selectedNode, setSelectedNode] = useState<FileTreeNode | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<FileTreeNode[]>([]);
  const [fileTreeError, setFileTreeError] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [aiBaseUrl, setAiBaseUrl] = useState('');
  const [aiApiKey, setAiApiKey] = useState('');
  const [aiModel, setAiModel] = useState('');
  const [aiTimeoutMs, setAiTimeoutMs] = useState(30000);
  const [aiConfigStatus, setAiConfigStatus] = useState('未配置');

  const selectedFileIds = new Set(selectedFiles.map((file) => file.id));

  useEffect(() => {
    void window.aiWorkspace.getAiConfig().then((config) => {
      setAiBaseUrl(config.baseUrl);
      setAiModel(config.model);
      setAiTimeoutMs(config.timeoutMs);
      setAiConfigStatus(config.hasApiKey ? '已加载配置' : '未配置');
    });
  }, []);

  const handleSelectDirectory = async () => {
    const result = await window.aiWorkspace.selectDirectory();

    if (!result.canceled && result.path) {
      setCurrentDirectory(result.path);
      setSelectedNode(null);
      setSelectedFiles([]);
      setFileTreeError(null);

      try {
        const nodes = await window.aiWorkspace.listFileTree(result.path);
        setFileTree(nodes);
      } catch {
        setFileTree([]);
        setFileTreeError('目录读取失败，请确认目录仍可访问');
      }
    }
  };

  const handleNodeClick = (node: FileTreeNode) => {
    setSelectedNode(node);

    if (node.type !== 'file') {
      return;
    }

    setSelectedFiles((currentFiles) => {
      if (currentFiles.some((file) => file.id === node.id)) {
        return currentFiles.filter((file) => file.id !== node.id);
      }

      return [...currentFiles, node];
    });
  };

  const handleSendMessage = async () => {
    const content = chatInput.trim();

    if (!content || isSending) {
      return;
    }

    const createdAt = Date.now();
    const history = messages.map((message) => ({
      role: message.role,
      content: message.content
    }));
    const userMessage: ChatMessage = {
      id: `user-${createdAt}`,
      role: 'user',
      content
    };

    setMessages((currentMessages) => [...currentMessages, userMessage]);
    setChatInput('');
    setIsSending(true);

    try {
      const result = await window.aiWorkspace.sendMessage({
        content,
        history
      });

      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: `assistant-${createdAt}`,
          role: 'assistant',
          content: result.content
        }
      ]);
    } catch (error) {
      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: `assistant-error-${createdAt}`,
          role: 'assistant',
          content: error instanceof Error ? error.message : 'AI 接口调用失败'
        }
      ]);
    } finally {
      setIsSending(false);
    }
  };

  const handleSaveAiConfig = async () => {
    await window.aiWorkspace.setAiConfig({
      baseUrl: aiBaseUrl,
      apiKey: aiApiKey,
      model: aiModel,
      timeoutMs: aiTimeoutMs
    });
    setAiConfigStatus('已保存配置');
    setAiApiKey('');
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
            {fileTreeError && <div className="folder-empty">{fileTreeError}</div>}
            {!fileTreeError && fileTree.length === 0 && (
              <div className="folder-empty">选择目录后显示文件和文件夹</div>
            )}
            {fileTree.map((node) => (
              <button
                className={[
                  'folder-item',
                  selectedNode?.id === node.id ? 'active' : '',
                  selectedFileIds.has(node.id) ? 'selected' : ''
                ].filter(Boolean).join(' ')}
                key={node.id}
                onClick={() => handleNodeClick(node)}
              >
                <span className="folder-icon">{node.type === 'directory' ? '▸' : '•'}</span>
                <span className="folder-name">{node.name}</span>
                {selectedFileIds.has(node.id) && <span className="selected-mark">已选择</span>}
              </button>
            ))}
          </nav>
        </aside>

        <section className="file-panel">
          <div className="panel-heading">
            <div>
              <h1>{selectedNode?.name ?? '未选择文件'}</h1>
              <p>
                {selectedNode
                  ? `${selectedNode.type === 'directory' ? '文件夹' : '文件'} · ${formatFileSize(selectedNode.size)} · 修改于 ${formatModifiedAt(selectedNode.modifiedAt)}`
                  : '请先从左侧目录中选择一个文件或文件夹'}
              </p>
            </div>
          </div>

          <div className="preview-card">
            <div className="preview-toolbar">
              <span className="status-text">只读预览</span>
              <span>当前只读取目录结构和文件信息，不读取文件内容</span>
            </div>
            <article className="file-preview">
              <h2>{selectedNode?.name ?? '目录预览占位'}</h2>
              {selectedNode ? (
                <>
                  <p>路径：{selectedNode.path}</p>
                  <p>类型：{selectedNode.type === 'directory' ? '文件夹' : '文件'}</p>
                  <p>大小：{formatFileSize(selectedNode.size)}</p>
                  <p>修改时间：{formatModifiedAt(selectedNode.modifiedAt)}</p>
                </>
              ) : (
                <p>选择本地目录后，左侧会显示第一层文件和文件夹。点击条目后，这里显示基础信息。</p>
              )}
            </article>
          </div>
        </section>

        <aside className="ai-panel">
          <div className="ai-config-box">
            <div className="ai-config-heading">
              <p>AI 配置</p>
              <span>{aiConfigStatus}</span>
            </div>
            <input
              onChange={(event) => setAiBaseUrl(event.target.value)}
              placeholder="Base URL，例如 https://api.openai.com/v1"
              value={aiBaseUrl}
            />
            <input
              onChange={(event) => setAiApiKey(event.target.value)}
              placeholder="API Key，保存后不在前端显示"
              type="password"
              value={aiApiKey}
            />
            <input
              onChange={(event) => setAiModel(event.target.value)}
              placeholder="模型名，例如 gpt-4o-mini"
              value={aiModel}
            />
            <div className="ai-config-actions">
              <input
                onChange={(event) => setAiTimeoutMs(Number(event.target.value) || 30000)}
                type="number"
                value={aiTimeoutMs}
              />
              <button onClick={() => void handleSaveAiConfig()}>保存配置</button>
            </div>
          </div>
          <div className="context-box">
            <p>当前引用文件</p>
            {selectedFiles.length > 0 ? (
              <div className="selected-file-list">
                {selectedFiles.map((file) => (
                  <button key={file.id} onClick={() => handleNodeClick(file)} title="点击取消选择">
                    {file.name}
                  </button>
                ))}
              </div>
            ) : (
              <span>暂未选择文件</span>
            )}
          </div>
          <div className="message-list">
            {messages.length === 0 && (
              <div className="message-empty">输入问题后，消息会显示在这里。</div>
            )}
            {messages.map((message) => (
              <div
                className={message.role === 'user' ? 'message user-message' : 'message ai-message'}
                key={message.id}
              >
                {message.content}
              </div>
            ))}
            {isSending && <div className="message ai-message">AI 正在回复...</div>}
          </div>
          <div className="chat-input-row">
            <input
              onChange={(event) => setChatInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  void handleSendMessage();
                }
              }}
              placeholder="输入问题，或先选择文件"
              value={chatInput}
            />
            <button disabled={isSending} onClick={() => void handleSendMessage()}>{isSending ? '发送中' : '发送'}</button>
          </div>
        </aside>
      </section>

      <footer className="status-bar">
        <span>只读模式</span>
        <span>本次会话已读取 0 个文件</span>
        <span>已选择 {selectedFiles.length} 个文件</span>
        <span>AI 读取记录</span>
      </footer>
    </main>
  );
}

import { useEffect, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';

type ChatMessage = {
  id: string;
  sessionId?: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt?: string;
};

type FileTreeViewNode = FileTreeNode & {
  children?: FileTreeViewNode[];
  isExpanded?: boolean;
  isLoading?: boolean;
};

type ContextMenuState = {
  x: number;
  y: number;
  node: FileTreeViewNode;
} | null;

type FilePreviewState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  content: string;
  message: string;
};

const fileContextMenuItems = ['添加到对话', '查看文件信息', '复制文件名', '复制路径', '在系统中打开', '重命名', '从工作区隐藏'];
const directoryContextMenuItems = ['添加到对话', '展开/折叠', '查看文件夹信息', '复制文件夹名', '复制路径', '在系统中打开', '重命名', '从工作区隐藏'];

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

function formatModifiedAt(value: string | null) {
  if (value === null) {
    return '-';
  }

  return new Date(value).toLocaleString('zh-CN', {
    hour12: false
  });
}

function updateTreeNode(
  nodes: FileTreeViewNode[],
  nodeId: string,
  updater: (node: FileTreeViewNode) => FileTreeViewNode
): FileTreeViewNode[] {
  return nodes.map((node) => {
    if (node.id === nodeId) {
      return updater(node);
    }

    if (node.children) {
      return {
        ...node,
        children: updateTreeNode(node.children, nodeId, updater)
      };
    }

    return node;
  });
}

export function App() {
  const [currentDirectory, setCurrentDirectory] = useState<string | null>(null);
  const [fileTree, setFileTree] = useState<FileTreeViewNode[]>([]);
  const [selectedNode, setSelectedNode] = useState<FileTreeNode | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<FileTreeNode[]>([]);
  const [fileTreeError, setFileTreeError] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [currentSession, setCurrentSession] = useState<SessionRecord | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [aiBaseUrl, setAiBaseUrl] = useState('');
  const [aiApiKey, setAiApiKey] = useState('');
  const [aiModel, setAiModel] = useState('');
  const [aiTimeoutSeconds, setAiTimeoutSeconds] = useState(30);
  const [aiConfigStatus, setAiConfigStatus] = useState('未配置');
  const [isAiConfigOpen, setIsAiConfigOpen] = useState(false);
  const [folderPanelWidth, setFolderPanelWidth] = useState(260);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [filePreview, setFilePreview] = useState<FilePreviewState>({
    status: 'idle',
    content: '',
    message: '选择左侧文本文件后，这里会显示文件内容。'
  });

  const selectedFileIds = new Set(selectedFiles.map((file) => file.id));

  useEffect(() => {
    void window.aiWorkspace.getAiConfig().then((config) => {
      setAiBaseUrl(config.baseUrl);
      setAiModel(config.model);
      setAiTimeoutSeconds(Math.round(config.timeoutMs / 1000));
      setAiConfigStatus(config.hasApiKey ? '已加载配置' : '未配置');
    });
    void window.aiWorkspace.listSessions().then(setSessions);
  }, []);

  useEffect(() => {
    const closeContextMenu = () => setContextMenu(null);

    window.addEventListener('click', closeContextMenu);
    window.addEventListener('resize', closeContextMenu);

    return () => {
      window.removeEventListener('click', closeContextMenu);
      window.removeEventListener('resize', closeContextMenu);
    };
  }, []);

  const handleOpenSession = async (sessionId: string) => {
    const detail = await window.aiWorkspace.getSession({ sessionId });
    setCurrentSession(detail.session);
    setCurrentDirectory(detail.session.workspacePath);
    setMessages(detail.messages);
  };

  const handleResizeFolderPanel = (event: ReactPointerEvent<HTMLDivElement>) => {
    const startX = event.clientX;
    const startWidth = folderPanelWidth;

    event.currentTarget.setPointerCapture(event.pointerId);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const nextWidth = Math.min(460, Math.max(220, startWidth + moveEvent.clientX - startX));
      setFolderPanelWidth(nextWidth);
    };
    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  const handleSelectDirectory = async () => {
    const result = await window.aiWorkspace.selectDirectory();

    if (!result.canceled && result.path) {
      setCurrentDirectory(result.path);
      setSelectedNode(null);
      setSelectedFiles([]);
      setFilePreview({ status: 'idle', content: '', message: '选择左侧文本文件后，这里会显示文件内容。' });
      setFileTreeError(null);

      try {
        const nodes = await window.aiWorkspace.listFileTree(result.path);
        setFileTree(nodes);
      } catch {
        setFileTree([]);
        setFileTreeError('目录读取失败，请确认路径是否存在');
      }
    }
  };

  const handleNodeClick = async (node: FileTreeNode) => {
    setSelectedNode(node);

    if (node.type === 'directory') {
      setFilePreview({ status: 'idle', content: '', message: '当前选择的是文件夹，暂不显示文件夹内容。' });
      return;
    }

    setFilePreview({ status: 'loading', content: '', message: '正在读取文件内容...' });

    try {
      const result = await window.aiWorkspace.readTextPreview(node.path);
      setFilePreview({ status: 'ready', content: result.content, message: '' });
    } catch (error) {
      setFilePreview({
        status: 'error',
        content: '',
        message: error instanceof Error ? error.message : '文件内容读取失败'
      });
    }
  };

  const handleNodeContextMenu = (event: ReactMouseEvent, node: FileTreeViewNode) => {
    event.preventDefault();
    setSelectedNode(node);
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      node
    });
  };

  const handleAddToChat = (node: FileTreeNode) => {
    setSelectedFiles((currentFiles) => {
      if (currentFiles.some((file) => file.id === node.id)) {
        return currentFiles;
      }

      return [...currentFiles, node];
    });
    setContextMenu(null);
  };

  const handleRemoveReferenceFile = (node: FileTreeNode) => {
    setSelectedFiles((currentFiles) => currentFiles.filter((file) => file.id !== node.id));
  };

  const handleToggleDirectory = async (node: FileTreeViewNode) => {
    setSelectedNode(node);
    setFilePreview({ status: 'idle', content: '', message: '当前选择的是文件夹，暂不显示文件夹内容。' });

    if (node.type !== 'directory') {
      return;
    }

    if (node.children) {
      setFileTree((currentTree) => updateTreeNode(currentTree, node.id, (currentNode) => ({
        ...currentNode,
        isExpanded: !currentNode.isExpanded
      })));
      return;
    }

    setFileTree((currentTree) => updateTreeNode(currentTree, node.id, (currentNode) => ({
      ...currentNode,
      isExpanded: true,
      isLoading: true
    })));

    try {
      const children = await window.aiWorkspace.listFileTree(node.path);
      setFileTree((currentTree) => updateTreeNode(currentTree, node.id, (currentNode) => ({
        ...currentNode,
        children,
        isExpanded: true,
        isLoading: false
      })));
    } catch {
      setFileTree((currentTree) => updateTreeNode(currentTree, node.id, (currentNode) => ({
        ...currentNode,
        children: [],
        isExpanded: true,
        isLoading: false
      })));
    }
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
      const session = currentSession ?? await window.aiWorkspace.createSession({
        workspacePath: currentDirectory
      });
      setCurrentSession(session);

      const result = await window.aiWorkspace.sendMessage({
        sessionId: session.id,
        content,
        history
      });

      setMessages((currentMessages) => [
        ...currentMessages.filter((message) => message.id !== userMessage.id),
        result.userMessage,
        result.assistantMessage
      ]);
      void window.aiWorkspace.listSessions().then(setSessions);
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
      timeoutMs: aiTimeoutSeconds * 1000
    });
    setAiConfigStatus('已保存配置');
    setAiApiKey('');
  };

  const renderFileTreeNodes = (nodes: FileTreeViewNode[], level = 0) => nodes.map((node) => {
    const isDirectory = node.type === 'directory';
    const isSelected = selectedNode?.id === node.id;
    const isFileSelected = selectedFileIds.has(node.id);

    return (
      <div className="tree-node" key={node.id}>
        <button
          className={[
            'folder-item',
            isSelected ? 'active' : '',
            isFileSelected ? 'selected' : ''
          ].filter(Boolean).join(' ')}
          onClick={() => isDirectory ? void handleToggleDirectory(node) : void handleNodeClick(node)}
          onContextMenu={(event) => handleNodeContextMenu(event, node)}
          style={{ paddingLeft: 10 + level * 18 }}
          title={node.path}
        >
          <span className="folder-icon">
            {isDirectory ? (node.isExpanded ? '▾' : '▸') : '•'}
          </span>
          <span className="folder-name">{node.name}</span>
          {node.isLoading && <span className="selected-mark">加载中</span>}
          {isFileSelected && <span className="selected-mark">已选择</span>}
        </button>
        {isDirectory && node.isExpanded && node.children && renderFileTreeNodes(node.children, level + 1)}
        {isDirectory && node.isExpanded && node.children?.length === 0 && (
          <div className="tree-empty" style={{ paddingLeft: 34 + level * 18 }}>空文件夹</div>
        )}
      </div>
    );
  });

  const renderContextMenu = () => {
    if (!contextMenu) {
      return null;
    }

    const items = contextMenu.node.type === 'directory' ? directoryContextMenuItems : fileContextMenuItems;

    return (
      <div
        className="context-menu"
        onClick={(event) => event.stopPropagation()}
        style={{ left: contextMenu.x, top: contextMenu.y }}
      >
        {items.map((item) => (
          <button
            className={item === '添加到对话' ? 'context-menu-item primary' : 'context-menu-item'}
            disabled={item !== '添加到对话'}
            key={item}
            onClick={() => item === '添加到对话' && handleAddToChat(contextMenu.node)}
          >
            {item}
          </button>
        ))}
      </div>
    );
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
          <button className="ghost-button" onClick={() => setIsAiConfigOpen((isOpen) => !isOpen)}>
            AI 配置：{aiConfigStatus}
          </button>
          <span className="safe-badge">只读模式</span>
        </div>
      </header>

      <section
        className="workspace-grid"
        style={{ gridTemplateColumns: `${folderPanelWidth}px 6px minmax(420px, 1fr) 390px` }}
      >
        <aside className="folder-panel">
          <div className="folder-header">
            <div className="panel-title">文件目录</div>
            <button className="add-folder-button" onClick={handleSelectDirectory}>选择目录</button>
          </div>
          <div className="current-directory" title={currentDirectory ?? ''}>
            当前目录：{currentDirectory ?? '请选择一个本地目录'}
          </div>
          <div className="soft-note">当前支持文本类文件只读预览，不会自动发送给 AI。</div>
          <nav className="folder-list">
            {fileTreeError && <div className="folder-empty">{fileTreeError}</div>}
            {!fileTreeError && fileTree.length === 0 && (
              <div className="folder-empty">点击上方“选择目录”，这里会显示文件树。</div>
            )}
            {renderFileTreeNodes(fileTree)}
          </nav>
          <div className="session-list-box">
            <div className="panel-title">历史会话</div>
            {sessions.length === 0 && <div className="folder-empty">暂无历史会话</div>}
            {sessions.map((session) => (
              <button
                className={currentSession?.id === session.id ? 'session-item active' : 'session-item'}
                key={session.id}
                onClick={() => void handleOpenSession(session.id)}
              >
                <span>{session.title}</span>
                <small>{new Date(session.updatedAt).toLocaleString('zh-CN', { hour12: false })}</small>
              </button>
            ))}
          </div>
        </aside>
        <div className="resize-handle" onPointerDown={handleResizeFolderPanel} />

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
              <span>支持 txt、md、csv、json、代码文件等文本内容</span>
            </div>
            <article className="file-preview">
              <h2>{selectedNode?.name ?? '目录预览占位'}</h2>
              {selectedNode ? (
                <>
                  <p title={selectedNode.path}>路径：{selectedNode.path}</p>
                  <p>类型：{selectedNode.type === 'directory' ? '文件夹' : '文件'}</p>
                  <p>大小：{formatFileSize(selectedNode.size)}</p>
                  <p>修改时间：{formatModifiedAt(selectedNode.modifiedAt)}</p>
                  {filePreview.status === 'ready' ? (
                    <pre className="text-preview-content">{filePreview.content}</pre>
                  ) : (
                    <div className={filePreview.status === 'error' ? 'preview-message error' : 'preview-message'}>
                      {filePreview.message}
                    </div>
                  )}
                </>
              ) : (
                <p>选择目录后，点击左侧文本文件，这里会显示名称、路径、大小、修改时间和文件内容。</p>
              )}
            </article>
          </div>
        </section>

        <aside className="ai-panel">
          {isAiConfigOpen && (
            <div className="ai-config-box">
              <div className="ai-config-heading">
                <p>AI 配置</p>
                <span>{aiConfigStatus}</span>
              </div>
              <label>
                Base URL
                <input
                  onChange={(event) => setAiBaseUrl(event.target.value)}
                  placeholder="例如 https://api.openai.com/v1"
                  value={aiBaseUrl}
                />
              </label>
              <label>
                API Key
                <input
                  onChange={(event) => setAiApiKey(event.target.value)}
                  placeholder="保存后不在前端显示"
                  type="password"
                  value={aiApiKey}
                />
              </label>
              <label>
                模型名
                <input
                  onChange={(event) => setAiModel(event.target.value)}
                  placeholder="例如 gpt-4o-mini"
                  value={aiModel}
                />
              </label>
              <div className="ai-config-actions">
                <label>
                  超时时间(秒)
                  <input
                    onChange={(event) => setAiTimeoutSeconds(Number(event.target.value) || 30)}
                    placeholder="默认 30 秒"
                    type="number"
                    value={aiTimeoutSeconds}
                  />
                </label>
                <button onClick={() => void handleSaveAiConfig()}>保存配置</button>
              </div>
            </div>
          )}
          <div className="context-box">
            <p>当前引用文件</p>
            {selectedFiles.length > 0 ? (
              <div className="selected-file-list">
                {selectedFiles.map((file) => (
                  <button key={file.id} onClick={() => handleRemoveReferenceFile(file)} title="点击移除引用">
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
              <div className="message-empty">输入问题后开始对话。当前不会自动读取文件内容。</div>
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
              placeholder="输入问题，或右键文件添加到对话"
              value={chatInput}
            />
            <button disabled={isSending} onClick={() => void handleSendMessage()}>{isSending ? '发送中' : '发送'}</button>
          </div>
        </aside>
      </section>

      <footer className="status-bar">
        <span>只读模式</span>
        <span>文本文件支持只读预览</span>
        <span>已引用 {selectedFiles.length} 个文件或文件夹</span>
      </footer>
      {renderContextMenu()}
    </main>
  );
}

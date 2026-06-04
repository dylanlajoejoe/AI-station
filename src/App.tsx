import { useEffect, useRef, useState } from 'react';
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

type SessionContextMenuState = {
  x: number;
  y: number;
  session: SessionRecord;
} | null;

type TopMenuKey = 'file' | 'edit';

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

function formatLocatedPathSummary(results: LocatedPathResult[]) {
  if (results.length === 0) {
    return '';
  }

  const lines = results.map((result) => {
    if (result.status === 'found') {
      return `已定位：${result.input} -> ${result.path}`;
    }

    return `${result.input}：${result.message}`;
  });

  return `\n\n路径定位结果：\n${lines.join('\n')}`;
}

function formatReferencedFileSummary(results: ReferencedFileContent[]) {
  if (results.length === 0) {
    return '';
  }

  const lines = results.map((result) => `${result.status === 'read' ? '已读取' : '未读取'}：${result.name}（${result.message}）`);

  return `\n\n引用文件读取结果：\n${lines.join('\n')}`;
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

function filterTreeNodes(nodes: FileTreeViewNode[], keyword: string): FileTreeViewNode[] {
  const normalizedKeyword = keyword.trim().toLowerCase();

  if (!normalizedKeyword) {
    return nodes;
  }

  return nodes.flatMap((node) => {
    const filteredChildren = node.children ? filterTreeNodes(node.children, normalizedKeyword) : [];
    const isMatched = node.name.toLowerCase().includes(normalizedKeyword);

    if (!isMatched && filteredChildren.length === 0) {
      return [];
    }

    return [{
      ...node,
      children: filteredChildren.length > 0 ? filteredChildren : node.children,
      isExpanded: filteredChildren.length > 0 ? true : node.isExpanded
    }];
  });
}

export function App() {
  const [currentDirectory, setCurrentDirectory] = useState<string | null>(null);
  const [fileTree, setFileTree] = useState<FileTreeViewNode[]>([]);
  const [selectedNode, setSelectedNode] = useState<FileTreeNode | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<FileTreeNode[]>([]);
  const [fileTreeError, setFileTreeError] = useState<string | null>(null);
  const [fileSearchKeyword, setFileSearchKeyword] = useState('');
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
  const [sessionContextMenu, setSessionContextMenu] = useState<SessionContextMenuState>(null);
  const [openTopMenu, setOpenTopMenu] = useState<TopMenuKey | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const [filePreview, setFilePreview] = useState<FilePreviewState>({
    status: 'idle',
    content: '',
    message: '选择左侧文本文件后，这里会显示文件内容。'
  });

  const selectedFileIds = new Set(selectedFiles.map((file) => file.id));
  const visibleFileTree = filterTreeNodes(fileTree, fileSearchKeyword);

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
    const offMessageChunk = window.aiWorkspace.onMessageChunk((chunk) => {
      setMessages((currentMessages) => currentMessages.map((message) => message.id === `assistant-stream-${chunk.sessionId}`
        ? { ...message, content: `${message.content}${chunk.content}` }
        : message));
    });

    return offMessageChunk;
  }, []);

  useEffect(() => {
    const closeContextMenu = () => {
      setContextMenu(null);
      setSessionContextMenu(null);
      setOpenTopMenu(null);
    };

    window.addEventListener('click', closeContextMenu);
    window.addEventListener('resize', closeContextMenu);

    return () => {
      window.removeEventListener('click', closeContextMenu);
      window.removeEventListener('resize', closeContextMenu);
    };
  }, []);

  useEffect(() => {
    const messageList = messageListRef.current;

    if (messageList) {
      messageList.scrollTop = messageList.scrollHeight;
    }
  }, [messages, isSending]);

  const handleOpenSession = async (sessionId: string) => {
    const detail = await window.aiWorkspace.getSession({ sessionId });
    setCurrentSession(detail.session);
    setCurrentDirectory(detail.session.workspacePath);
    setMessages(detail.messages);
  };

  const refreshSessions = async () => {
    const nextSessions = await window.aiWorkspace.listSessions();
    setSessions(nextSessions);
  };

  const handleSessionContextMenu = (event: ReactMouseEvent, session: SessionRecord) => {
    event.preventDefault();
    setSessionContextMenu({
      x: event.clientX,
      y: event.clientY,
      session
    });
  };

  const handleRenameSession = async (session: SessionRecord) => {
    const title = window.prompt('请输入新的会话名称', session.title);

    if (!title || title.trim() === session.title) {
      setSessionContextMenu(null);
      return;
    }

    await window.aiWorkspace.renameSession({ sessionId: session.id, title });
    if (currentSession?.id === session.id) {
      setCurrentSession({ ...session, title: title.trim() });
    }
    await refreshSessions();
    setSessionContextMenu(null);
  };

  const handleDeleteSession = async (session: SessionRecord) => {
    if (!window.confirm(`确定删除会话“${session.title}”吗？`)) {
      setSessionContextMenu(null);
      return;
    }

    await window.aiWorkspace.deleteSession({ sessionId: session.id });
    if (currentSession?.id === session.id) {
      setCurrentSession(null);
      setMessages([]);
    }
    await refreshSessions();
    setSessionContextMenu(null);
  };

  const handleExportSession = async (session: SessionRecord) => {
    await window.aiWorkspace.exportSessionMarkdown({ sessionId: session.id });
    setSessionContextMenu(null);
  };

  const handleNewSession = () => {
    setCurrentSession(null);
    setMessages([]);
    setSelectedFiles([]);
    setOpenTopMenu(null);
  };

  const handleExportCurrentSession = async () => {
    if (!currentSession) {
      window.alert('当前没有可导出的会话');
      setOpenTopMenu(null);
      return;
    }

    await window.aiWorkspace.exportSessionMarkdown({ sessionId: currentSession.id });
    setOpenTopMenu(null);
  };

  const handleClearChatInput = () => {
    setChatInput('');
    setOpenTopMenu(null);
  };

  const handleClearReferencedFiles = () => {
    setSelectedFiles([]);
    setOpenTopMenu(null);
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
      const locatedPaths = await window.aiWorkspace.locatePaths({
        workspacePath: currentDirectory,
        content
      });
      const session = currentSession ?? await window.aiWorkspace.createSession({
        workspacePath: currentDirectory
      });
      setCurrentSession(session);
      const streamingMessageId = `assistant-stream-${session.id}`;

      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: streamingMessageId,
          role: 'assistant',
          content: ''
        }
      ]);

      const result = await window.aiWorkspace.sendMessage({
        sessionId: session.id,
        content,
        history,
        workspacePath: currentDirectory,
        locatedPaths,
        referencedFiles: selectedFiles.map((file) => ({
          name: file.name,
          path: file.path,
          type: file.type
        }))
      });

      setMessages((currentMessages) => [
        ...currentMessages.filter((message) => message.id !== userMessage.id && message.id !== streamingMessageId),
        {
          ...result.userMessage,
          content: `${result.userMessage.content}${formatLocatedPathSummary(result.locatedPaths)}${formatReferencedFileSummary(result.referencedFiles)}`
        },
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
    setIsAiConfigOpen(false);
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

  const renderSessionContextMenu = () => {
    if (!sessionContextMenu) {
      return null;
    }

    return (
      <div
        className="context-menu"
        onClick={(event) => event.stopPropagation()}
        style={{ left: sessionContextMenu.x, top: sessionContextMenu.y }}
      >
        <button className="context-menu-item primary" onClick={() => void handleOpenSession(sessionContextMenu.session.id)}>打开会话</button>
        <button className="context-menu-item primary" onClick={() => void handleRenameSession(sessionContextMenu.session)}>重命名会话</button>
        <button className="context-menu-item primary" onClick={() => void handleExportSession(sessionContextMenu.session)}>导出为 Markdown</button>
        <button className="context-menu-item danger" onClick={() => void handleDeleteSession(sessionContextMenu.session)}>删除会话</button>
      </div>
    );
  };

  const toggleTopMenu = (event: ReactMouseEvent, menu: TopMenuKey) => {
    event.stopPropagation();
    setOpenTopMenu((currentMenu) => currentMenu === menu ? null : menu);
  };

  return (
    <main className="workspace-shell">
      <header className="top-bar">
        <div className="top-identity">
          <div className="title-row">
            <nav className="app-menu" aria-label="应用菜单">
              <div className="app-menu-group">
                <button onClick={(event) => toggleTopMenu(event, 'file')} type="button">文件</button>
                {openTopMenu === 'file' && (
                  <div className="top-menu-popover" onClick={(event) => event.stopPropagation()}>
                    <button onClick={() => void handleExportCurrentSession()} type="button">导出当前会话</button>
                  </div>
                )}
              </div>
              <div className="app-menu-group">
                <button onClick={(event) => toggleTopMenu(event, 'edit')} type="button">编辑</button>
                {openTopMenu === 'edit' && (
                  <div className="top-menu-popover" onClick={(event) => event.stopPropagation()}>
                    <button onClick={handleClearChatInput} type="button">清空输入框</button>
                    <button onClick={handleClearReferencedFiles} type="button">清空引用文件</button>
                  </div>
                )}
              </div>
            </nav>
          </div>
          <div className="breadcrumb">{currentDirectory ?? '尚未选择本地目录'}</div>
        </div>
        <div className="top-actions">
          <input
            className="search-input"
            onChange={(event) => setFileSearchKeyword(event.target.value)}
            placeholder="搜索当前目录的文件"
            value={fileSearchKeyword}
          />
          <button className="ghost-button" onClick={() => setIsAiConfigOpen((isOpen) => !isOpen)}>
            AI 配置：{aiConfigStatus}
          </button>
          <span className="safe-badge">只读模式</span>
        </div>
      </header>

      <section
        className="workspace-grid"
        style={{ gridTemplateColumns: `${folderPanelWidth}px 6px minmax(360px, 1fr) minmax(300px, 390px)` }}
      >
        <aside className="folder-panel">
          <div className="folder-header">
            <div className="panel-title">文件目录</div>
            <button className="add-folder-button" onClick={handleSelectDirectory}>选择目录</button>
          </div>
          <div className="current-directory" title={currentDirectory ?? ''}>
            当前目录：{currentDirectory ?? '请选择一个本地目录'}
          </div>
          <div className="soft-note">AI 可定位你输入的工作区内路径，但不会默认读取文件内容。</div>
          <nav className="folder-list">
            {fileTreeError && <div className="folder-empty">{fileTreeError}</div>}
            {!fileTreeError && fileTree.length === 0 && (
              <div className="folder-empty">点击上方“选择目录”，这里会显示文件树。</div>
            )}
            {!fileTreeError && fileTree.length > 0 && visibleFileTree.length === 0 && (
              <div className="folder-empty">没有匹配的文件或文件夹。</div>
            )}
            {renderFileTreeNodes(visibleFileTree)}
          </nav>
          <div className="session-list-box">
            <div className="panel-title">历史会话</div>
            {sessions.length === 0 && <div className="folder-empty">暂无历史会话</div>}
            {sessions.map((session) => (
              <button
                className={currentSession?.id === session.id ? 'session-item active' : 'session-item'}
                key={session.id}
                onClick={() => void handleOpenSession(session.id)}
                onContextMenu={(event) => handleSessionContextMenu(event, session)}
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
              {selectedNode ? (
                filePreview.status === 'ready' ? (
                  <pre className="text-preview-content">{filePreview.content}</pre>
                ) : (
                  <div className={filePreview.status === 'error' ? 'preview-message error' : 'preview-message'}>
                    {filePreview.message}
                  </div>
                )
              ) : (
                <div className="preview-message">选择目录后，点击左侧文本文件，这里会显示文件内容。</div>
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
          <div className="message-list" ref={messageListRef}>
            {messages.length === 0 && (
              <div className="message-empty">输入问题后开始对话。输入工作区内路径时，系统会先真实定位文件。</div>
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
            <div className="chat-input-area">
              {selectedFiles.length > 0 && (
                <div className="selected-file-list">
                  {selectedFiles.map((file) => (
                    <span className="selected-file-chip" key={file.id} title={file.path}>
                      <span className="selected-file-name">{file.name}</span>
                      <button
                        aria-label={`移除引用 ${file.name}`}
                        className="remove-reference-button"
                        onClick={() => handleRemoveReferenceFile(file)}
                        title="移除引用"
                        type="button"
                      />
                    </span>
                  ))}
                </div>
              )}
              <div className="chat-input-stack">
                <textarea
                  onChange={(event) => setChatInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      void handleSendMessage();
                    }
                  }}
                  placeholder="输入问题，Enter 发送，Shift+Enter 换行"
                  value={chatInput}
                />
                <div className="chat-inline-actions">
                  <button className="mini-action-button" onClick={handleNewSession} type="button">新会话</button>
                  <button className="mini-send-button" disabled={isSending || !chatInput.trim()} onClick={() => void handleSendMessage()} type="button">
                    {isSending ? '发送中' : '发送'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </aside>
      </section>

      <footer className="status-bar">
        <span>只读模式</span>
        <span>AI 可定位当前工作区内路径</span>
        <span>已引用 {selectedFiles.length} 个文件或文件夹</span>
      </footer>
      {renderContextMenu()}
      {renderSessionContextMenu()}
    </main>
  );
}

import { useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import 'highlight.js/styles/github.css';

type ChatMessage = {
  id: string;
  sessionId?: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt?: string;
  fileEditSuggestionId?: string;
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

type WorkspaceContextMenuState = {
  x: number;
  y: number;
} | null;

type PreviewContextMenuState = {
  x: number;
  y: number;
  tab: FilePreviewTab;
} | null;

type TopMenuKey = 'file' | 'edit';

type FilePreviewState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  content: string;
  message: string;
};

type FilePreviewTab = {
  node: FileTreeNode;
  preview: FilePreviewState;
  draftContent: string;
  originalHash: string;
  isEditable: boolean;
  contentKind: 'text' | 'office';
  ocrEnabled: boolean;
  isOcrLoading: boolean;
  isDirty: boolean;
  isSaving: boolean;
  saveMessage: string;
};

const fileContextMenuItems = ['添加到引用文件', '查看文件信息', '复制文件名', '复制路径', '在系统中打开', '重命名', '从工作区隐藏'];
const directoryContextMenuItems = ['添加到引用文件', '展开/折叠', '查看文件夹信息', '复制文件夹名', '复制路径', '在系统中打开', '重命名', '从工作区隐藏'];
const enabledFileContextMenuItems = new Set(['添加到引用文件', '复制文件名', '复制路径', '重命名']);
const enabledDirectoryContextMenuItems = new Set(['添加到引用文件', '复制文件夹名', '复制路径', '重命名']);
const previewContextMenuItems = ['添加到引用文件', '复制文件名', '复制路径', '重命名'];
const editableExtensions = new Set(['.txt', '.md', '.csv', '.json', '.ts', '.tsx', '.js', '.jsx', '.css', '.html', '.htm', '.xml', '.yaml', '.yml', '.log']);
const readonlyExtensions = new Set(['.doc', '.docx', '.xlsx', '.ppt', '.pptx', '.pdf']);

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

function getExtension(filePath: string) {
  const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
  const dotIndex = fileName.lastIndexOf('.');

  return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : '';
}

function getFileCapability(node: FileTreeNode) {
  if (node.type === 'directory') {
    return { label: '文件夹', tone: 'neutral', detail: '文件夹可引用名称，AI 不会直接读取整个文件夹内容。' };
  }

  const extension = getExtension(node.path);
  const size = node.size ?? 0;

  if (editableExtensions.has(extension)) {
    return size > 1024 * 1024
      ? { label: '过大', tone: 'warning', detail: '文本文件超过 1MB，不能预览、编辑或读取给 AI。' }
      : { label: '可编辑', tone: 'editable', detail: '文本文件可预览、编辑，也可读取给 AI。' };
  }

  if (readonlyExtensions.has(extension)) {
    return size > 10 * 1024 * 1024
      ? { label: '过大', tone: 'warning', detail: '文档超过 10MB，暂不提取文本。' }
      : { label: '只读', tone: 'readonly', detail: '文档可提取文本给 AI，但不能直接编辑保存。' };
  }

  return { label: '不支持', tone: 'unsupported', detail: '该格式暂不支持读取内容，可转换为 txt、md、docx、xlsx、pptx 或 pdf 后再使用。' };
}

function getReadLoadingMessage(node: FileTreeNode) {
  const capability = getFileCapability(node);

  if (capability.tone === 'readonly') {
    return '正在提取文档文本，Office/PDF 文件可能需要稍等...';
  }

  if (capability.tone === 'warning' || capability.tone === 'unsupported') {
    return capability.detail;
  }

  return '正在读取文件内容...';
}

function buildChangePreview(before: string | null, after: string | null) {
  if (before === null || after === null) {
    return { before, after };
  }

  let prefixLength = 0;
  const minLength = Math.min(before.length, after.length);

  while (prefixLength < minLength && before[prefixLength] === after[prefixLength]) {
    prefixLength += 1;
  }

  let suffixLength = 0;

  while (
    suffixLength < minLength - prefixLength
    && before[before.length - 1 - suffixLength] === after[after.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  const contextSize = 180;
  const beforeStart = Math.max(0, prefixLength - contextSize);
  const beforeEnd = Math.min(before.length, before.length - suffixLength + contextSize);
  const afterStart = Math.max(0, prefixLength - contextSize);
  const afterEnd = Math.min(after.length, after.length - suffixLength + contextSize);

  return {
    before: `${beforeStart > 0 ? '...\n' : ''}${before.slice(beforeStart, beforeEnd)}${beforeEnd < before.length ? '\n...' : ''}`,
    after: `${afterStart > 0 ? '...\n' : ''}${after.slice(afterStart, afterEnd)}${afterEnd < after.length ? '\n...' : ''}`
  };
}

function getContextMenuPosition(x: number, y: number, itemCount: number) {
  const menuWidth = 190;
  const menuHeight = itemCount * 38 + 16;
  const padding = 8;

  return {
    x: Math.min(x, window.innerWidth - menuWidth - padding),
    y: Math.min(y, window.innerHeight - menuHeight - padding)
  };
}

function getFriendlyErrorMessage(error: unknown, fallback: string) {
  const rawMessage = error instanceof Error ? error.message : fallback;
  const message = rawMessage
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim();

  if (!message) {
    return fallback;
  }

  if (message.includes('AI 回复已停止')) {
    return '回复已停止';
  }

  if (message.includes('AI 接口请求超时')) {
    return 'AI 回复超时，请稍后重试。';
  }

  if (message.includes('AI 接口请求失败')) {
    return 'AI 服务请求失败，请检查配置或稍后重试。';
  }

  if (message.includes('未配置')) {
    return `${message}。请先在 AI 配置中填写完整信息。`;
  }

  if (message.includes('文件已被外部修改')) {
    return '文件已被其他程序修改，请重新打开后再保存。';
  }

  if (message.includes('超过 10MB')) {
    return '文件超过 10MB，暂不支持读取。请压缩内容或转换为更小的文档后重试。';
  }

  if (message.includes('超过 1MB')) {
    return '文本文件超过 1MB，暂不支持预览、编辑或读取给 AI。';
  }

  if (message.includes('暂不支持读取') || message.includes('暂不支持编辑保存')) {
    return `${message}。建议转换为 txt、md、docx、xlsx、pptx 或 pdf。`;
  }

  if (message.includes('只能操作当前工作区内') || message.includes('只能保存当前工作区内') || message.includes('只能删除当前工作区内')) {
    return '只能操作当前工作区内的文件。';
  }

  if (message.includes('敏感文件') || message.includes('隐藏路径')) {
    return '该文件位于隐藏或敏感路径，请确认后再继续。';
  }

  return message;
}

function isSensitiveFilePath(filePath: string) {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const segments = normalizedPath.split('/').filter(Boolean);
  const sensitiveNames = new Set([
    '.env',
    '.env.local',
    '.env.development',
    '.env.production',
    'credentials.json',
    'secrets.json',
    'id_rsa',
    'id_ed25519'
  ]);

  return segments.some((segment) => segment.startsWith('.') || sensitiveNames.has(segment.toLowerCase()));
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

function formatContextLength(characterCount: number) {
  if (characterCount < 1000) {
    return `${characterCount} 字符`;
  }

  return `${(characterCount / 1000).toFixed(1)}k 字符`;
}

function estimateTokenCount(characterCount: number) {
  return Math.ceil(characterCount / 2);
}

function MarkdownMessage({ content }: { content: string }) {
  return (
    <ReactMarkdown rehypePlugins={[rehypeHighlight]} remarkPlugins={[remarkGfm]}>
      {content}
    </ReactMarkdown>
  );
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
  const [streamingSessionId, setStreamingSessionId] = useState<string | null>(null);
  const [aiBaseUrl, setAiBaseUrl] = useState('');
  const [aiApiKey, setAiApiKey] = useState('');
  const [aiModel, setAiModel] = useState('');
  const [aiTimeoutSeconds, setAiTimeoutSeconds] = useState(30);
  const [aiConfigStatus, setAiConfigStatus] = useState('未配置');
  const [isAiConfigOpen, setIsAiConfigOpen] = useState(false);
  const [folderPanelWidth, setFolderPanelWidth] = useState(260);
  const [aiPanelWidth, setAiPanelWidth] = useState(390);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [sessionContextMenu, setSessionContextMenu] = useState<SessionContextMenuState>(null);
  const [workspaceContextMenu, setWorkspaceContextMenu] = useState<WorkspaceContextMenuState>(null);
  const [previewContextMenu, setPreviewContextMenu] = useState<PreviewContextMenuState>(null);
  const [openTopMenu, setOpenTopMenu] = useState<TopMenuKey | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const [openPreviewTabs, setOpenPreviewTabs] = useState<FilePreviewTab[]>([]);
  const [activePreviewTabId, setActivePreviewTabId] = useState<string | null>(null);
  const [fileEditSuggestions, setFileEditSuggestions] = useState<FileEditSuggestion[]>([]);
  const [applyingEditId, setApplyingEditId] = useState<string | null>(null);
  const [memoryDebug, setMemoryDebug] = useState<SessionMemoryDebug | null>(null);
  const [isMemoryDebugOpen, setIsMemoryDebugOpen] = useState(false);

  const selectedFileIds = new Set(selectedFiles.map((file) => file.id));
  const visibleFileTree = filterTreeNodes(fileTree, fileSearchKeyword);
  const activePreviewTab = openPreviewTabs.find((tab) => tab.node.id === activePreviewTabId) ?? null;
  const sessionTitle = currentSession?.title ?? '新会话';
  const contextCharacterCount = [
    currentDirectory ?? '',
    chatInput,
    ...messages.map((message) => message.content),
    ...selectedFiles.map((file) => `${file.name}\n${file.path}`)
  ].join('\n').length;
  const estimatedTokenCount = estimateTokenCount(contextCharacterCount);

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
      setWorkspaceContextMenu(null);
      setPreviewContextMenu(null);
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

  useEffect(() => {
    const offWorkspaceChanged = window.aiWorkspace.onWorkspaceChanged((event) => {
      if (!currentDirectory || event.workspacePath !== currentDirectory) {
        return;
      }

      void window.aiWorkspace.listFileTree(currentDirectory).then(setFileTree).catch(() => {
        setFileTreeError('工作区文件变化后刷新失败');
      });

      setOpenPreviewTabs((currentTabs) => {
        for (const tab of currentTabs) {
          if (tab.isDirty || tab.preview.status !== 'ready') {
            continue;
          }

          void window.aiWorkspace.readTextPreview(tab.node.path).then((result) => {
            setOpenPreviewTabs((latestTabs) => latestTabs.map((latestTab) => latestTab.node.id === tab.node.id && !latestTab.isDirty
              ? {
                ...latestTab,
                preview: { status: 'ready', content: result.content, message: '' },
                draftContent: result.content,
                originalHash: result.originalHash,
                isEditable: result.isEditable,
                contentKind: result.contentKind,
                ocrEnabled: result.ocrEnabled,
                isOcrLoading: false,
                node: {
                  ...latestTab.node,
                  size: result.size,
                  modifiedAt: result.modifiedAt
                },
                saveMessage: '外部变化已同步'
              }
              : latestTab));
          }).catch(() => {
            setOpenPreviewTabs((latestTabs) => latestTabs.map((latestTab) => latestTab.node.id === tab.node.id && !latestTab.isDirty
              ? {
                ...latestTab,
                preview: {
                  status: 'error',
                  content: '',
                  message: '文件已被移动、删除或无法读取'
                },
                saveMessage: '外部变化'
              }
              : latestTab));
          });
        }

        return currentTabs.map((tab) => tab.isDirty
          ? { ...tab, saveMessage: '有未保存修改，外部变化未自动同步' }
          : tab);
      });
    });

    return offWorkspaceChanged;
  }, [currentDirectory]);

  const handleOpenSession = async (sessionId: string) => {
    const detail = await window.aiWorkspace.getSession({ sessionId });
    const events = await window.aiWorkspace.getSessionEvents({ sessionId });
    const appliedSuggestionIds = new Set(events
      .filter((event) => event.type === 'file_edit_applied')
      .map((event) => (event.payload as { suggestionId?: string }).suggestionId)
      .filter(Boolean));
    const restoredSuggestions = events.flatMap((event) => {
      if (event.type !== 'file_edit_suggested') {
        return [];
      }

      const payload = event.payload as {
        suggestionId?: string;
        messageId?: string;
        filePath?: string;
        fileName?: string;
        operation?: 'update' | 'create' | 'delete' | 'rename';
        originalHash?: string | null;
        proposedHash?: string | null;
        targetPath?: string | null;
        summary?: string;
      };

      if (!payload.suggestionId || !payload.filePath || !payload.fileName || !payload.summary) {
        return [];
      }

      return [{
        id: payload.suggestionId,
        sessionId,
        operation: payload.operation ?? 'update',
        filePath: payload.filePath,
        targetPath: payload.targetPath ?? null,
        fileName: payload.fileName,
        originalHash: payload.originalHash ?? null,
        originalContent: null,
        proposedContent: '',
        proposedHash: payload.proposedHash ?? null,
        summary: payload.summary,
        status: appliedSuggestionIds.has(payload.suggestionId) ? 'applied' as const : 'suggested' as const,
        messageId: payload.messageId ?? null
      }];
    });

    setCurrentSession(detail.session);
    setCurrentDirectory(detail.session.workspacePath);
    setMessages(detail.messages.map((message) => ({
      ...message,
      fileEditSuggestionId: restoredSuggestions.find((suggestion) => suggestion.messageId === message.id)?.id
    })));
    setFileEditSuggestions(restoredSuggestions);
  };

  const refreshSessions = async () => {
    const nextSessions = await window.aiWorkspace.listSessions();
    setSessions(nextSessions);
  };

  const handleSessionContextMenu = (event: ReactMouseEvent, session: SessionRecord) => {
    event.preventDefault();
    setContextMenu(null);
    setWorkspaceContextMenu(null);
    setPreviewContextMenu(null);
    setOpenTopMenu(null);
    const position = getContextMenuPosition(event.clientX, event.clientY, 4);

    setSessionContextMenu({
      x: position.x,
      y: position.y,
      session
    });
  };

  const handleRenameSession = async (session: SessionRecord) => {
    const title = window.prompt('请输入新的会话名称', session.title);

    if (!title || title.trim() === session.title) {
      setSessionContextMenu(null);
      return;
    }

    try {
      await window.aiWorkspace.renameSession({ sessionId: session.id, title });
      if (currentSession?.id === session.id) {
        setCurrentSession({ ...session, title: title.trim() });
      }
      await refreshSessions();
    } catch (error) {
      window.alert(getFriendlyErrorMessage(error, '重命名会话失败'));
    }
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

  const handleOpenMemoryDebug = async () => {
    if (!currentSession) {
      window.alert('当前没有会话');
      return;
    }

    const memory = await window.aiWorkspace.getSessionMemory({ sessionId: currentSession.id });
    setMemoryDebug(memory);
    setIsMemoryDebugOpen(true);
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

  const handleResizeAiPanel = (event: ReactPointerEvent<HTMLDivElement>) => {
    const startX = event.clientX;
    const startWidth = aiPanelWidth;

    event.currentTarget.setPointerCapture(event.pointerId);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const nextWidth = Math.min(620, Math.max(300, startWidth + startX - moveEvent.clientX));
      setAiPanelWidth(nextWidth);
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
      setOpenPreviewTabs([]);
      setActivePreviewTabId(null);
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
      return;
    }

    setActivePreviewTabId(node.id);
    setOpenPreviewTabs((currentTabs) => {
      if (currentTabs.some((tab) => tab.node.id === node.id)) {
        return currentTabs;
      }

      return [
        ...currentTabs,
        {
          node,
          preview: { status: 'loading', content: '', message: getReadLoadingMessage(node) },
          draftContent: '',
          originalHash: '',
          isEditable: false,
          contentKind: 'text',
          ocrEnabled: false,
          isOcrLoading: false,
          isDirty: false,
          isSaving: false,
          saveMessage: ''
        }
      ];
    });

    try {
      const result = await window.aiWorkspace.readTextPreview(node.path);
      setOpenPreviewTabs((currentTabs) => currentTabs.map((tab) => tab.node.id === node.id
        ? {
          ...tab,
          preview: tab.isDirty ? tab.preview : { status: 'ready', content: result.content, message: '' },
          draftContent: tab.isDirty ? tab.draftContent : result.content,
          originalHash: tab.isDirty ? tab.originalHash : result.originalHash,
          isEditable: result.isEditable,
          contentKind: result.contentKind,
          ocrEnabled: result.ocrEnabled,
          isOcrLoading: false,
          node: {
            ...tab.node,
            size: result.size,
            modifiedAt: result.modifiedAt
          },
          saveMessage: tab.isDirty ? tab.saveMessage : ''
        }
        : tab));
      setSelectedNode((currentNode) => currentNode?.id === node.id
        ? { ...currentNode, size: result.size, modifiedAt: result.modifiedAt }
        : currentNode);
    } catch (error) {
      setOpenPreviewTabs((currentTabs) => currentTabs.map((tab) => tab.node.id === node.id
        ? {
          ...tab,
          preview: {
            status: 'error',
            content: '',
            message: getFriendlyErrorMessage(error, '文件内容读取失败')
          }
        }
        : tab));
    }
  };

  const handleActivatePreviewTab = (tab: FilePreviewTab) => {
    setActivePreviewTabId(tab.node.id);
    setSelectedNode(tab.node);
  };

  const handlePreviewDraftChange = (nodeId: string, content: string) => {
    setOpenPreviewTabs((currentTabs) => currentTabs.map((tab) => tab.node.id === nodeId
      ? {
        ...tab,
        draftContent: content,
        isDirty: content !== tab.preview.content,
        saveMessage: content !== tab.preview.content ? '未保存' : ''
      }
      : tab));
  };

  const handleSavePreviewTab = async (tab: FilePreviewTab) => {
    if (!currentDirectory) {
      setOpenPreviewTabs((currentTabs) => currentTabs.map((currentTab) => currentTab.node.id === tab.node.id
        ? { ...currentTab, saveMessage: '请先选择工作区目录' }
        : currentTab));
      return;
    }

    if (!tab.isEditable) {
      setOpenPreviewTabs((currentTabs) => currentTabs.map((currentTab) => currentTab.node.id === tab.node.id
        ? { ...currentTab, saveMessage: 'Office 文件只读，不能保存' }
        : currentTab));
      return;
    }

    const sensitivePathConfirmed = isSensitiveFilePath(tab.node.path)
      ? window.confirm(`文件“${tab.node.name}”位于隐藏或敏感路径，确认保存吗？`)
      : false;

    if (isSensitiveFilePath(tab.node.path) && !sensitivePathConfirmed) {
      return;
    }

    const savedContent = tab.draftContent;

    setOpenPreviewTabs((currentTabs) => currentTabs.map((currentTab) => currentTab.node.id === tab.node.id
      ? { ...currentTab, isSaving: true, saveMessage: '保存中...' }
      : currentTab));

    try {
      const result = await window.aiWorkspace.saveTextFile({
        workspacePath: currentDirectory,
        filePath: tab.node.path,
        expectedOriginalHash: tab.originalHash,
        content: savedContent,
        sensitivePathConfirmed
      });
      setOpenPreviewTabs((currentTabs) => currentTabs.map((currentTab) => currentTab.node.id === tab.node.id
        ? (() => {
          const hasNewChanges = currentTab.draftContent !== savedContent;

          return {
            ...currentTab,
            node: {
              ...currentTab.node,
              size: result.size,
              modifiedAt: result.modifiedAt
            },
            preview: hasNewChanges ? currentTab.preview : {
              status: 'ready',
              content: savedContent,
              message: ''
            },
            originalHash: hasNewChanges ? currentTab.originalHash : result.nextHash,
            isDirty: hasNewChanges,
            isSaving: false,
            saveMessage: hasNewChanges ? '未保存' : '已保存'
          };
        })()
        : currentTab));
      setSelectedNode((currentNode) => currentNode?.id === tab.node.id
        ? { ...currentNode, size: result.size, modifiedAt: result.modifiedAt }
        : currentNode);
      setFileTree((currentTree) => updateTreeNode(currentTree, tab.node.id, (currentNode) => ({
        ...currentNode,
        size: result.size,
        modifiedAt: result.modifiedAt
      })));
    } catch (error) {
      setOpenPreviewTabs((currentTabs) => currentTabs.map((currentTab) => currentTab.node.id === tab.node.id
        ? {
          ...currentTab,
          isSaving: false,
          saveMessage: getFriendlyErrorMessage(error, '保存失败')
        }
      : currentTab));
    }
  };

  const handleRunOcr = async (tab: FilePreviewTab) => {
    setOpenPreviewTabs((currentTabs) => currentTabs.map((currentTab) => currentTab.node.id === tab.node.id
      ? {
        ...currentTab,
        isOcrLoading: true,
        saveMessage: '正在识别图片文字...'
      }
      : currentTab));

    try {
      const result = await window.aiWorkspace.readTextPreview({
        filePath: tab.node.path,
        enableOcr: true
      });

      setOpenPreviewTabs((currentTabs) => currentTabs.map((currentTab) => currentTab.node.id === tab.node.id
        ? {
          ...currentTab,
          preview: { status: 'ready', content: result.content, message: '' },
          draftContent: result.content,
          originalHash: result.originalHash,
          isEditable: result.isEditable,
          contentKind: result.contentKind,
          ocrEnabled: result.ocrEnabled,
          isOcrLoading: false,
          saveMessage: 'OCR 已完成'
        }
        : currentTab));
    } catch (error) {
      setOpenPreviewTabs((currentTabs) => currentTabs.map((currentTab) => currentTab.node.id === tab.node.id
        ? {
          ...currentTab,
          isOcrLoading: false,
          saveMessage: getFriendlyErrorMessage(error, 'OCR 识别失败')
        }
        : currentTab));
    }
  };

  useEffect(() => {
    const handleSaveShortcut = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 's' || (!event.ctrlKey && !event.metaKey)) {
        return;
      }

      event.preventDefault();

      if (!activePreviewTab?.isEditable || !activePreviewTab.isDirty || activePreviewTab.isSaving || activePreviewTab.preview.status !== 'ready') {
        return;
      }

      void handleSavePreviewTab(activePreviewTab);
    };

    window.addEventListener('keydown', handleSaveShortcut);

    return () => {
      window.removeEventListener('keydown', handleSaveShortcut);
    };
  }, [activePreviewTab]);

  const handleClosePreviewTab = (nodeId: string) => {
    const tab = openPreviewTabs.find((previewTab) => previewTab.node.id === nodeId);

    if (tab?.isDirty && !window.confirm(`文件“${tab.node.name}”尚未保存，确定关闭吗？`)) {
      return;
    }

    setOpenPreviewTabs((currentTabs) => {
      const tabIndex = currentTabs.findIndex((tab) => tab.node.id === nodeId);
      const nextTabs = currentTabs.filter((tab) => tab.node.id !== nodeId);

      if (activePreviewTabId === nodeId) {
        const nextActiveTab = nextTabs[Math.max(0, tabIndex - 1)] ?? nextTabs[0] ?? null;
        setActivePreviewTabId(nextActiveTab?.node.id ?? null);
        setSelectedNode(nextActiveTab?.node ?? null);
      }

      return nextTabs;
    });
  };

  const handleNodeContextMenu = (event: ReactMouseEvent, node: FileTreeViewNode) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedNode(node);
    setSessionContextMenu(null);
    setWorkspaceContextMenu(null);
    setPreviewContextMenu(null);
    setOpenTopMenu(null);
    const itemCount = node.type === 'directory' ? directoryContextMenuItems.length : fileContextMenuItems.length;
    const position = getContextMenuPosition(event.clientX, event.clientY, itemCount);

    setContextMenu({
      x: position.x,
      y: position.y,
      node
    });
  };

  const handleWorkspaceContextMenu = (event: ReactMouseEvent) => {
    event.preventDefault();

    if (!currentDirectory) {
      return;
    }

    setContextMenu(null);
    setSessionContextMenu(null);
    setPreviewContextMenu(null);
    setOpenTopMenu(null);
    const position = getContextMenuPosition(event.clientX, event.clientY, 2);

    setWorkspaceContextMenu(position);
  };

  const refreshFileTree = async () => {
    if (!currentDirectory) {
      return;
    }

    const nodes = await window.aiWorkspace.listFileTree(currentDirectory);
    setFileTree(nodes);
  };

  const handleCreateWorkspaceEntry = async (type: 'file' | 'directory') => {
    const label = type === 'file' ? '文件' : '文件夹';
    const name = window.prompt(`请输入新${label}名称`);

    setWorkspaceContextMenu(null);

    if (!name?.trim()) {
      return;
    }

    try {
      const createdEntry = await window.aiWorkspace.createWorkspaceEntry({ type, name: name.trim() });
      await refreshFileTree();
      setSelectedNode(createdEntry);

      if (createdEntry.type === 'file') {
        void handleNodeClick(createdEntry);
      }
    } catch (error) {
      window.alert(getFriendlyErrorMessage(error, `新建${label}失败`));
    }
  };

  const handleCopyText = async (value: string, label: string) => {
    await navigator.clipboard.writeText(value);
    setContextMenu(null);
    setPreviewContextMenu(null);
    setWorkspaceContextMenu(null);
    setSessionContextMenu(null);

    if (activePreviewTab) {
      setOpenPreviewTabs((currentTabs) => currentTabs.map((tab) => tab.node.id === activePreviewTab.node.id
        ? { ...tab, saveMessage: `${label}已复制` }
        : tab));
    }
  };

  const handleRenameWorkspaceEntry = async (node: FileTreeNode) => {
    const newName = window.prompt(`请输入新的${node.type === 'directory' ? '文件夹' : '文件'}名称`, node.name);

    setContextMenu(null);
    setPreviewContextMenu(null);

    if (!newName?.trim() || newName.trim() === node.name) {
      return;
    }

    try {
      const renamedNode = await window.aiWorkspace.renameWorkspaceEntry({
        filePath: node.path,
        newName: newName.trim()
      });

      await refreshFileTree();
      setSelectedNode(renamedNode);
      setSelectedFiles((currentFiles) => currentFiles.map((file) => file.path === node.path ? renamedNode : file));
      setOpenPreviewTabs((currentTabs) => currentTabs.map((tab) => tab.node.path === node.path
        ? {
          ...tab,
          node: renamedNode,
          saveMessage: '已重命名'
        }
        : tab));

      if (activePreviewTabId === node.id) {
        setActivePreviewTabId(renamedNode.id);
      }
    } catch (error) {
      window.alert(getFriendlyErrorMessage(error, '重命名失败'));
    }
  };

  const handleFileContextMenuAction = async (item: string, node: FileTreeNode) => {
    if (item === '添加到引用文件') {
      handleAddToChat(node);
      return;
    }

    if (item === '复制文件名' || item === '复制文件夹名') {
      await handleCopyText(node.name, item);
      return;
    }

    if (item === '复制路径') {
      await handleCopyText(node.path, item);
      return;
    }

    if (item === '重命名') {
      await handleRenameWorkspaceEntry(node);
    }
  };

  const handleAddToChat = (node: FileTreeNode) => {
    setSelectedFiles((currentFiles) => {
      if (currentFiles.some((file) => file.id === node.id)) {
        return currentFiles;
      }

      return [...currentFiles, node];
    });
    setContextMenu(null);
    setPreviewContextMenu(null);
  };

  const handlePreviewContextMenu = (event: ReactMouseEvent, tab: FilePreviewTab | null) => {
    if (!tab) {
      return;
    }

    event.preventDefault();
    setContextMenu(null);
    setSessionContextMenu(null);
    setWorkspaceContextMenu(null);
    setOpenTopMenu(null);
    const position = getContextMenuPosition(event.clientX, event.clientY, previewContextMenuItems.length);

    setPreviewContextMenu({
      ...position,
      tab
    });
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
    let streamingMessageId: string | null = null;

    try {
      const locatedPaths = await window.aiWorkspace.locatePaths({
        workspacePath: currentDirectory,
        content
      });
      const session = currentSession ?? await window.aiWorkspace.createSession({
        workspacePath: currentDirectory
      });
      setCurrentSession(session);
      setStreamingSessionId(session.id);
      streamingMessageId = `assistant-stream-${session.id}`;
      const currentStreamingMessageId = streamingMessageId;

      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: currentStreamingMessageId,
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
        {
          ...result.assistantMessage,
          fileEditSuggestionId: result.fileEditSuggestion?.id
        }
      ]);
      if (result.fileEditSuggestion) {
        setFileEditSuggestions((currentSuggestions) => [...currentSuggestions, result.fileEditSuggestion as FileEditSuggestion]);
      }
      void window.aiWorkspace.listSessions().then(setSessions);
    } catch (error) {
      const errorMessage = getFriendlyErrorMessage(error, 'AI 接口调用失败');

      if (errorMessage === '回复已停止') {
        setMessages((currentMessages) => currentMessages.map((message) => streamingMessageId && message.id === streamingMessageId
          ? {
            ...message,
            content: message.content ? `${message.content}\n\n（回复已停止）` : '回复已停止'
          }
          : message));
        return;
      }

      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: `assistant-error-${createdAt}`,
          role: 'assistant',
          content: errorMessage
        }
      ]);
    } finally {
      setIsSending(false);
      setStreamingSessionId(null);
    }
  };

  const handleStopMessage = async () => {
    if (!streamingSessionId) {
      return;
    }

    await window.aiWorkspace.stopMessage({ sessionId: streamingSessionId });
  };

  const handleApplyFileEdit = async (suggestion: FileEditSuggestion) => {
    const dirtyTab = openPreviewTabs.find((tab) => tab.node.path === suggestion.filePath && tab.isDirty);

    if (dirtyTab && suggestion.operation !== 'create') {
      window.alert('当前文件有未保存修改，请先保存或取消自己的修改后再应用 AI 修改。');
      return;
    }

    if (suggestion.operation !== 'delete' && suggestion.operation !== 'rename' && !suggestion.proposedContent) {
      window.alert('历史编辑建议无法直接应用，请重新生成修改建议。');
      return;
    }

    if (suggestion.operation === 'rename' && !suggestion.targetPath) {
      window.alert('重命名建议缺少目标路径，请重新生成修改建议。');
      return;
    }

    const deleteConfirmed = suggestion.operation === 'delete'
      ? window.confirm(`确认删除文件“${suggestion.fileName}”吗？\n\n${suggestion.filePath}`)
      : false;

    if (suggestion.operation === 'delete' && !deleteConfirmed) {
      return;
    }

    const sensitivePathConfirmed = isSensitiveFilePath(suggestion.filePath)
      ? window.confirm(`文件“${suggestion.fileName}”位于隐藏或敏感路径，确认${suggestion.operation === 'delete' ? '删除' : suggestion.operation === 'rename' ? '重命名' : '应用'}吗？`)
      : false;

    if (isSensitiveFilePath(suggestion.filePath) && !sensitivePathConfirmed) {
      return;
    }

    setApplyingEditId(suggestion.id);

    try {
      const result = await window.aiWorkspace.applyFileEdit({
        sessionId: suggestion.sessionId,
        suggestionId: suggestion.id,
        operation: suggestion.operation,
        filePath: suggestion.filePath,
        targetPath: suggestion.targetPath,
        expectedOriginalHash: suggestion.originalHash,
        proposedContent: suggestion.proposedContent,
        sensitivePathConfirmed,
        deleteConfirmed,
        summary: suggestion.summary
      });

      setFileEditSuggestions((currentSuggestions) => currentSuggestions.map((currentSuggestion) => currentSuggestion.id === suggestion.id
        ? { ...currentSuggestion, status: 'applied' }
        : currentSuggestion));
      setOpenPreviewTabs((currentTabs) => suggestion.operation === 'delete'
        ? currentTabs.filter((tab) => tab.node.path !== suggestion.filePath)
        : currentTabs.map((tab) => tab.node.path === suggestion.filePath
          ? {
            ...tab,
            node: {
              ...tab.node,
              id: suggestion.operation === 'rename' ? suggestion.targetPath ?? tab.node.id : tab.node.id,
              path: suggestion.operation === 'rename' ? suggestion.targetPath ?? tab.node.path : tab.node.path,
              name: suggestion.operation === 'rename' && suggestion.targetPath ? suggestion.targetPath.split(/[\\/]/).pop() ?? tab.node.name : tab.node.name,
              size: result.size,
              modifiedAt: result.modifiedAt
            },
            preview: suggestion.operation === 'rename' ? tab.preview : {
              status: 'ready',
              content: suggestion.proposedContent ?? '',
              message: ''
            },
            draftContent: suggestion.operation === 'rename' ? tab.draftContent : suggestion.proposedContent ?? '',
            originalHash: result.nextHash,
            isDirty: false,
            isSaving: false,
            saveMessage: suggestion.operation === 'create' ? 'AI 已创建文件' : suggestion.operation === 'rename' ? 'AI 已重命名文件' : 'AI 修改已应用'
          }
          : tab));
      setFileTree((currentTree) => updateTreeNode(currentTree, suggestion.filePath, (currentNode) => ({
        ...currentNode,
        size: result.size,
        modifiedAt: result.modifiedAt
      })));
      if (currentDirectory) {
        void window.aiWorkspace.listFileTree(currentDirectory).then(setFileTree);
      }
      setMessages((currentMessages) => [...currentMessages, {
        id: `file-edit-applied-${Date.now()}`,
        role: 'assistant',
        content: `${suggestion.operation === 'delete' ? '已删除文件' : suggestion.operation === 'create' ? '已创建文件' : suggestion.operation === 'rename' ? '已重命名文件' : '已应用 AI 修改'}：${suggestion.fileName}\n${suggestion.summary}`
      }]);
    } catch (error) {
      const message = getFriendlyErrorMessage(error, '应用 AI 修改失败');
      setFileEditSuggestions((currentSuggestions) => currentSuggestions.map((currentSuggestion) => currentSuggestion.id === suggestion.id
        ? { ...currentSuggestion, status: 'failed' }
        : currentSuggestion));
      window.alert(message);
    } finally {
      setApplyingEditId(null);
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

  const renderJsonBlock = (value: unknown) => (
    <pre className="memory-debug-json">{JSON.stringify(value, null, 2) || 'null'}</pre>
  );

  const renderMemoryDebugModal = () => {
    if (!isMemoryDebugOpen) {
      return null;
    }

    return (
      <div className="modal-backdrop" onClick={() => setIsMemoryDebugOpen(false)}>
        <div className="memory-debug-modal" onClick={(event) => event.stopPropagation()}>
          <div className="memory-debug-header">
            <div>
              <p>Memory 调试</p>
              <span>{currentSession?.title ?? '当前会话'}</span>
            </div>
            <button onClick={() => setIsMemoryDebugOpen(false)} type="button">关闭</button>
          </div>
          {!memoryDebug ? (
            <div className="memory-debug-empty">暂无 Memory 数据。</div>
          ) : (
            <div className="memory-debug-content">
              <section>
                <h3>任务状态</h3>
                <small>更新时间：{memoryDebug.taskStateUpdatedAt ?? '-'}</small>
                {renderJsonBlock(memoryDebug.taskState)}
              </section>
              <section>
                <h3>滚动摘要</h3>
                {memoryDebug.rollingSummary ? (
                  <>
                    <small>更新时间：{memoryDebug.rollingSummary.updatedAt}</small>
                    <pre className="memory-debug-json">{memoryDebug.rollingSummary.summary}</pre>
                  </>
                ) : (
                  <p className="memory-debug-empty">暂无 rolling_summary。</p>
                )}
              </section>
              <section>
                <h3>压缩包</h3>
                <small>创建时间：{memoryDebug.contextPackCreatedAt ?? '-'}</small>
                {renderJsonBlock(memoryDebug.contextPack)}
              </section>
              <section>
                <h3>文件记录</h3>
                {memoryDebug.files.length === 0 ? <p className="memory-debug-empty">暂无文件记录。</p> : memoryDebug.files.map((file) => (
                  <div className="memory-debug-row" key={file.id}>
                    <strong>{file.operation}</strong>
                    <span title={file.path}>{file.path}</span>
                  </div>
                ))}
              </section>
              <section>
                <h3>命令记录</h3>
                {memoryDebug.commands.length === 0 ? <p className="memory-debug-empty">暂无命令记录。</p> : memoryDebug.commands.map((command) => (
                  <div className="memory-debug-row" key={command.id}>
                    <strong>{command.status}</strong>
                    <span title={command.command}>{command.command}</span>
                  </div>
                ))}
              </section>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderFileTreeNodes = (nodes: FileTreeViewNode[], level = 0) => nodes.map((node) => {
    const isDirectory = node.type === 'directory';
    const isSelected = selectedNode?.id === node.id;
    const isFileSelected = selectedFileIds.has(node.id);
    const capability = getFileCapability(node);

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
          {!isDirectory && <span className={`capability-mark ${capability.tone}`} title={capability.detail}>{capability.label}</span>}
          {isFileSelected && <span className="selected-mark">已引用</span>}
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
    const enabledItems = contextMenu.node.type === 'directory' ? enabledDirectoryContextMenuItems : enabledFileContextMenuItems;

    return (
      <div
        className="context-menu"
        onClick={(event) => event.stopPropagation()}
        style={{ left: contextMenu.x, top: contextMenu.y }}
      >
        {items.map((item) => (
          <button
            className={item === '添加到引用文件' ? 'context-menu-item primary' : 'context-menu-item'}
            disabled={!enabledItems.has(item)}
            key={item}
            onClick={() => void handleFileContextMenuAction(item, contextMenu.node)}
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

  const renderWorkspaceContextMenu = () => {
    if (!workspaceContextMenu) {
      return null;
    }

    return (
      <div
        className="context-menu"
        onClick={(event) => event.stopPropagation()}
        style={{ left: workspaceContextMenu.x, top: workspaceContextMenu.y }}
      >
        <button className="context-menu-item primary" onClick={() => void handleCreateWorkspaceEntry('file')}>新建文件</button>
        <button className="context-menu-item primary" onClick={() => void handleCreateWorkspaceEntry('directory')}>新建文件夹</button>
      </div>
    );
  };

  const renderPreviewContextMenu = () => {
    if (!previewContextMenu) {
      return null;
    }

    return (
      <div
        className="context-menu"
        onClick={(event) => event.stopPropagation()}
        style={{ left: previewContextMenu.x, top: previewContextMenu.y }}
      >
        {previewContextMenuItems.map((item) => (
          <button
            className={item === '添加到引用文件' ? 'context-menu-item primary' : 'context-menu-item'}
            key={item}
            onClick={() => void handleFileContextMenuAction(item, previewContextMenu.tab.node)}
          >
            {item}
          </button>
        ))}
      </div>
    );
  };

  const renderFileEditSuggestion = (suggestionId: string | undefined) => {
    if (!suggestionId) {
      return null;
    }

    const suggestion = fileEditSuggestions.find((currentSuggestion) => currentSuggestion.id === suggestionId);

    if (!suggestion) {
      return null;
    }

    const isApplied = suggestion.status === 'applied';
    const isFailed = suggestion.status === 'failed';
    const actionLabel = suggestion.operation === 'delete' ? '删除文件' : suggestion.operation === 'create' ? '创建文件' : suggestion.operation === 'rename' ? '重命名文件' : '应用修改';
    const title = suggestion.operation === 'delete' ? 'AI 删除文件建议' : suggestion.operation === 'create' ? 'AI 创建文件建议' : suggestion.operation === 'rename' ? 'AI 重命名建议' : 'AI 文件修改建议';
    const shouldShowContentCompare = suggestion.operation === 'update' || suggestion.operation === 'create' || suggestion.operation === 'delete';
    const changePreview = buildChangePreview(suggestion.originalContent, suggestion.proposedContent);

    return (
      <div className="file-edit-suggestion">
        <div className="file-edit-suggestion-header">
          <strong>{title}</strong>
          <span>{isApplied ? '已应用' : isFailed ? '应用失败' : '待确认'}</span>
        </div>
        <div className="file-edit-suggestion-path" title={suggestion.filePath}>{suggestion.fileName}</div>
        {suggestion.operation === 'rename' && suggestion.targetPath && (
          <div className="file-edit-suggestion-path" title={suggestion.targetPath}>目标：{suggestion.targetPath}</div>
        )}
        <p>{suggestion.summary}</p>
        {shouldShowContentCompare && (
          <div className="file-edit-compare">
            <div className="file-edit-compare-pane before">
              <div className="file-edit-compare-title">修改前</div>
              <pre>{changePreview.before ?? (suggestion.operation === 'create' ? '新文件，无原内容' : '历史建议未保存原内容，请重新生成修改建议')}</pre>
            </div>
            <div className="file-edit-compare-pane after">
              <div className="file-edit-compare-title">修改后</div>
              <pre>{suggestion.operation === 'delete' ? '文件将被删除' : changePreview.after ?? '历史建议未保存修改后内容，请重新生成修改建议'}</pre>
            </div>
          </div>
        )}
        <button
          disabled={isApplied || applyingEditId === suggestion.id || (suggestion.operation !== 'delete' && suggestion.operation !== 'rename' && !suggestion.proposedContent)}
          onClick={() => void handleApplyFileEdit(suggestion)}
          type="button"
        >
          {applyingEditId === suggestion.id ? '处理中' : isApplied ? '已应用' : actionLabel}
        </button>
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
        style={{ gridTemplateColumns: `${folderPanelWidth}px 6px minmax(300px, 1fr) 6px ${aiPanelWidth}px` }}
      >
        <aside className="folder-panel">
          <div className="folder-header">
            <div className="panel-title">文件目录</div>
            <button className="add-folder-button" onClick={handleSelectDirectory}>选择目录</button>
          </div>
          <div className="current-directory" title={currentDirectory ?? ''}>
            当前目录：{currentDirectory ?? '请选择一个本地目录'}
          </div>
            <div className="soft-note">右键文件选择“添加到引用文件”后，支持的文本、Office 和 PDF 会被读取；过大或不支持格式会明确提示。</div>
          <nav className="folder-list" onContextMenu={handleWorkspaceContextMenu}>
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
            <div className="session-list">
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
          </div>
        </aside>
        <div className="resize-handle" onPointerDown={handleResizeFolderPanel} />

        <section className="file-panel">
          <div className="preview-tabs-bar" aria-label="已打开文件标签">
            {openPreviewTabs.length === 0 ? (
              <div className="preview-tabs-empty">未打开文件</div>
            ) : openPreviewTabs.map((tab) => {
              const isActive = tab.node.id === activePreviewTabId;

              return (
                <button
                  className={isActive ? 'preview-tab active' : 'preview-tab'}
                  key={tab.node.id}
                  onClick={() => handleActivatePreviewTab(tab)}
                  title={tab.node.path}
                  type="button"
                >
                  <span className="preview-tab-name">{tab.isDirty ? `* ${tab.node.name}` : tab.node.name}</span>
                  <span
                    aria-label={`关闭 ${tab.node.name}`}
                    className="preview-tab-close"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleClosePreviewTab(tab.node.id);
                    }}
                    role="button"
                    tabIndex={0}
                    title="关闭"
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        event.stopPropagation();
                        handleClosePreviewTab(tab.node.id);
                      }
                    }}
                  >
                    x
                  </span>
                </button>
              );
            })}
          </div>

          <div className="preview-card">
            <div className="preview-toolbar">
              <span className="status-text">{activePreviewTab ? '文本编辑' : '等待打开文件'}</span>
              <span>
                {activePreviewTab
                  ? `${activePreviewTab.node.name} · ${activePreviewTab.isEditable ? '可编辑文本' : '文档只读预览'} · 修改于 ${formatModifiedAt(activePreviewTab.node.modifiedAt)}`
                  : '点击左侧文件后，会在上方生成可关闭标签。'}
              </span>
              {activePreviewTab && (
                <div className="preview-edit-actions">
                  <span className={activePreviewTab.isDirty ? 'save-state dirty' : 'save-state'}>
                    {activePreviewTab.saveMessage || (activePreviewTab.isDirty ? '未保存' : '已同步')}
                  </span>
                  <button
                    disabled={!activePreviewTab.isDirty || activePreviewTab.isSaving || activePreviewTab.preview.status !== 'ready' || !activePreviewTab.isEditable}
                    onClick={() => void handleSavePreviewTab(activePreviewTab)}
                    type="button"
                  >
                    {activePreviewTab.isSaving ? '保存中' : '保存'}
                  </button>
                  {!activePreviewTab.isEditable && activePreviewTab.contentKind === 'office' && (
                    <button
                      disabled={activePreviewTab.isOcrLoading || activePreviewTab.preview.status !== 'ready'}
                      onClick={() => void handleRunOcr(activePreviewTab)}
                      type="button"
                    >
                      {activePreviewTab.isOcrLoading ? 'OCR 中' : activePreviewTab.ocrEnabled ? '重新 OCR' : '识别图片文字'}
                    </button>
                  )}
                </div>
              )}
            </div>
            <article className="file-preview" onContextMenu={(event) => handlePreviewContextMenu(event, activePreviewTab)}>
              {activePreviewTab ? (
                activePreviewTab.preview.status === 'ready' ? (
                  activePreviewTab.isEditable ? (
                    <textarea
                      className="text-preview-editor"
                      onChange={(event) => handlePreviewDraftChange(activePreviewTab.node.id, event.target.value)}
                      spellCheck={false}
                      value={activePreviewTab.draftContent}
                    />
                  ) : (
                    <pre className="text-preview-content">{activePreviewTab.preview.content}</pre>
                  )
                ) : (
                  <div className={activePreviewTab.preview.status === 'error' ? 'preview-message error' : 'preview-message'}>
                    {activePreviewTab.preview.message}
                  </div>
                )
              ) : (
                <div className="preview-message">选择目录后，点击左侧文件。文本文件可编辑，Office/PDF 只读预览，不支持或过大的文件会显示原因。</div>
              )}
            </article>
          </div>
        </section>

        <div className="resize-handle ai-resize-handle" onPointerDown={handleResizeAiPanel} />

        <aside className="ai-panel">
          <div className="ai-session-header">
            <div className="ai-session-title-box">
              <span className="panel-title">当前会话</span>
              <strong title={sessionTitle}>{sessionTitle}</strong>
            </div>
            <div className="context-length-box" title="按当前消息、输入框、目录路径和引用文件名粗略估算，不等同于模型真实 token。">
              <span>上下文</span>
              <strong>{formatContextLength(contextCharacterCount)}</strong>
              <small>约 {estimatedTokenCount.toLocaleString('zh-CN')} tokens</small>
            </div>
            <button className="memory-debug-button" disabled={!currentSession} onClick={() => void handleOpenMemoryDebug()} type="button">Memory</button>
          </div>
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
                {message.role === 'assistant' ? <MarkdownMessage content={message.content} /> : message.content}
                {message.role === 'assistant' && renderFileEditSuggestion(message.fileEditSuggestionId)}
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
                      <span className={`selected-file-status ${getFileCapability(file).tone}`}>{getFileCapability(file).label}</span>
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
                  {isSending && (
                    <button className="mini-action-button" onClick={() => void handleStopMessage()} type="button">停止回复</button>
                  )}
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
        <span>文本文件可编辑</span>
        <span>AI 可定位当前工作区内路径</span>
        <span>已引用 {selectedFiles.length} 个文件或文件夹</span>
      </footer>
      {renderContextMenu()}
      {renderSessionContextMenu()}
      {renderWorkspaceContextMenu()}
      {renderPreviewContextMenu()}
      {renderMemoryDebugModal()}
    </main>
  );
}

# Windows 打包说明

## 1. 安装依赖

```bash
npm install
```

如果没有安装 `electron-builder`：

```bash
npm install -D electron-builder
```

## 2. 设置下载镜像

```bash
set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
set "ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/"
```

## 3. 生成 Windows 安装包

```bash
npm run dist:win
```

## 4. 安装包位置

生成后只需要发这个文件：

```text
dist\ai-workspace-connector Setup 0.1.0.exe
```

不用发：

```text
*.blockmap
win-unpacked\
```

## 常见问题

### electron-builder 不是内部或外部命令

运行：

```bash
npm install -D electron-builder
```

### 下载 Electron 很慢或超时

运行镜像命令后重新打包：

```bash
set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
set "ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/"
npm run dist:win
```

### better-sqlite3 被占用

关闭软件窗口，结束 `electron.exe`、`node.exe` 后重新运行：

```bash
npm install
```

### 打开安装包后空白界面

确认 `vite.config.ts` 里有：

```ts
base: './'
```

然后重新打包。

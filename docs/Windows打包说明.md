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

## 5. 安装路径与数据存储路径

### 5.1 当前结论

当前安装包使用 `electron-builder` 的 NSIS 安装器，但 `package.json` 里只配置了：

```json
"win": {
  "target": "nsis"
}
```

因此：

- 安装目录是否可选：当前未显式配置安装目录选择页，安装器大概率走默认安装流程。
- 数据存储目录是否可选：当前不可选。
- 当前数据库位置：应用启动时通过 `app.getPath('userData')` 创建 `ai-workstation.db`。

Windows 下默认类似：

```text
C:\Users\用户名\AppData\Roaming\AI Workspace Connector\ai-workstation.db
```

这不是安装目录，而是 Electron 默认应用数据目录。但从用户视角看，它仍然在 C 盘用户目录下，确实不适合长期存放大量会话、索引、缓存或附件类数据。

### 5.2 用户预期

AI Station 这类本地工作台建议把“程序安装位置”和“业务数据存储位置”分开处理：

- 程序安装位置：可以默认安装到系统推荐目录，必要时允许用户改安装目录。
- 数据存储位置：必须在应用内提供选择入口，允许用户放到 `D:\AIStationData`、移动硬盘或公司指定数据盘。
- 默认策略：首次启动如果未选择数据目录，可以先使用 `userData`，但应提示用户可迁移到非 C 盘目录。
- 长期策略：会话库、Memory、索引、缓存、导入文件副本等都应放在用户选择的数据目录中。

### 5.3 推荐实现方案

推荐不要只依赖安装器选择路径，因为安装器选择的是程序目录，不等于业务数据目录。

更合适的方式是在应用内实现“数据目录设置”：

1. 首次启动时弹出“选择数据存储位置”。
2. 用户选择目录后，在 Electron 默认 `userData` 中只保存一个很小的配置文件，例如：

```text
C:\Users\用户名\AppData\Roaming\AI Workspace Connector\settings.json
```

配置内容示例：

```json
{
  "dataDir": "D:\\AIStationData"
}
```

3. 数据库改为写入用户选择目录：

```text
D:\AIStationData\ai-workstation.db
```

4. 后续缓存、索引、附件、Memory 文件也统一放在该目录下：

```text
D:\AIStationData\
  ai-workstation.db
  cache\
  index\
  memory\
  logs\
```

5. 设置页提供“更改数据目录”和“打开数据目录”。迁移时需要先关闭数据库连接，再复制旧目录数据到新目录，校验成功后切换配置。

### 5.4 可选：允许选择安装目录

如果也希望安装器允许选择程序安装目录，可以在 `package.json` 的 `build` 中增加 NSIS 配置：

```json
"build": {
  "win": {
    "target": "nsis"
  },
  "nsis": {
    "oneClick": false,
    "allowToChangeInstallationDirectory": true,
    "perMachine": false
  }
}
```

注意：这只能让用户选择软件安装位置，不能解决 SQLite 数据库仍在 C 盘 `AppData` 的问题。数据目录仍需要按 5.3 在应用内实现。

### 5.5 当前版本对外说明建议

如果当前版本还没有实现数据目录选择，对用户应明确说明：

```text
当前版本会将本地会话数据库存放在 Windows 用户应用数据目录。
后续版本将支持在首次启动或设置页中选择数据存储路径，并支持迁移到非 C 盘目录。
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

# GitHub 源码发布

`selene-github-source.zip` 用于创建源码仓库；`selene-cloudflare.zip` 是可直接部署的网页文件。这份源码包已经包含最新四关地图、共享资金、幸存继承、教学和编辑器。

## 上传

1. 解压 `selene-github-source.zip`，进入其中的 `selene-lunar-autobattler` 目录。
2. 在 GitHub 新建仓库，把项目目录内的文件上传到仓库根目录，让 `package.json` 与英文 `README.md` 直接出现在根目录。
3. 上传时包括 `.gitignore`、`.gitattributes` 和 `.nvmrc`。Finder 可按 `Command+Shift+.` 显示隐藏文件。
4. 源码 ZIP 本身可以作为 Release 附件，不需要作为仓库里的源码文件提交。

使用终端上传也可以。在解压后的项目目录执行以下命令，将 `YOUR_NAME` 与 `YOUR_REPOSITORY` 换成你的实际仓库信息：

```bash
git init
git add .
git commit -m "Initial SELENE source release"
git branch -M main
git remote add origin https://github.com/YOUR_NAME/YOUR_REPOSITORY.git
git push -u origin main
```

本次只生成了本地源码包，没有创建仓库、提交或推送到 GitHub。

## 下载后的运行方式

安装 Node.js 22.12 或更高版本，然后在项目目录执行：

```bash
npm ci
npm run dev:public
```

`dev:public` 和 `build:public` 只提供 English 与 Português (Brasil)。普通本地开发 `dev`、`build` 和 `build:offline` 保留中文，方便继续开发；部署公网使用 `build:public`。

```bash
npm run check
npm test
npm run build:public
```

将生成的 `dist-public` 内容交给静态托管平台即可。Cloudflare 操作见 [发布说明](cloudflare-deploy.md)。项目使用相对资源路径，也能放在 GitHub Pages 的仓库子路径中；本包没有自动发布工作流，上传源码不会自动改变已发布的站点。

## 源码包范围

- 包含：`src`、`tests`、`scripts`、`docs`、根配置、依赖锁文件、英中说明、第三方许可信息、macOS 启动器，以及最新一轮地图几何诊断图。
- 排除：`node_modules`、`dist`、`dist-public`、试玩 HTML、其他 ZIP、系统文件、环境变量、个人 agent/云工具配置、提示词、技能文件和旧版制作截图。
- 使用明确文件白名单打包。文档内的本机绝对路径会转换为通用描述，内部 `SOURCE-MANIFEST.sha256` 记录每个文件的校验值。
- 没有替项目选定开源许可证。根目录第三方说明只保留依赖的原有许可信息。

## 重新生成

在原工程目录或解压后的源码目录中执行：

```bash
npm run package:github
```

该命令需要 Python 3，游戏运行与构建本身不依赖 Python。输出为 `selene-github-source.zip` 和 `selene-github-source.zip.sha256`。

macOS 可校验：

```bash
shasum -a 256 -c selene-github-source.zip.sha256
```

内部文件清单可在解压目录校验：

```bash
shasum -a 256 -c SOURCE-MANIFEST.sha256
```

## 本次验证

已从实际生成的 ZIP 解压到独立目录，通过 `npm ci` 重新安装依赖、`npm run check`、全部 8 组 `npm test`、`npm run build:public` 和 `npm run build:offline`。安装使用本地缓存的公开 npm 包并校验完整性，没有依赖原工程的 `node_modules`。公网构建输出与原工程现有版本一致。

源码 ZIP 的路径、文件校验值和文档相对链接均已检查。构建仍有现有主脚本大于 500 kB 的体积提示；本次未改游戏运行逻辑，也未新增浏览器视觉验收。

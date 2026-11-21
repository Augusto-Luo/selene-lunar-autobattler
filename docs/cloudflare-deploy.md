# Cloudflare Pages 手动发布

本项目是纯静态浏览器游戏。上传版只提供 English 和 Português (Brasil)，无登录、服务端、数据库、玩家资料或统计上报。战役、语言选择、成绩、编辑器内容均不读取或写入浏览器持久存储；刷新后游戏从第一关重新开始。四关之间在当前页面保留资金与幸存部队。编辑器仅保留玩家手动发起的 JSON 导入/导出。

## 首次发布

1. 登录 [Cloudflare 控制台](https://dash.cloudflare.com/)。
2. 进入 **Workers & Pages**，选择创建应用中的 **Pages**，进入 **Upload assets / Direct Upload**（上传静态资源）入口。后台名称可能随界面版本变化，选择的是 Pages 静态资源上传。
3. 项目名可填 `selene-arena`，名称需在你的账号和平台规则下可用。
4. 上传项目根目录中的 `selene-cloudflare.zip`。压缩包根目录直接是 `index.html` 与 `assets/`，无需再构建。
5. 点击部署，完成后打开控制台给出的 `https://项目名.pages.dev` 地址。
6. 分享这个地址即可直接游玩。不要添加 Cloudflare Access 登录保护、数据库绑定或 Web Analytics。

不需要购买域名。若已有域名，可以在 Pages 项目中的 **Custom domains** 添加域名并按向导设置 DNS。

官方操作参考：[Cloudflare Pages Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)。本次执行环境无法访问 Cloudflare 官方文档，因此未核验后台最新按钮名称。

## 更新游戏

在项目目录运行：

```bash
npm run build:public
```

新的上传文件位于 `dist-public/`。进入该目录，全选 `index.html` 和 `assets/` 压缩成 ZIP；打开原 Pages 项目，新建部署并上传 ZIP。也可以直接上传 `dist-public` 文件夹，确保站点根目录能看到 `index.html`。

macOS 终端重新打包：

```bash
cd dist-public
zip -r ../selene-cloudflare.zip index.html assets
```

重新创建同名 ZIP 前可先在 Finder 删除旧压缩包，避免 zip 更新时保留旧资源。不要上传工程目录、`src`、`node_modules` 或本地三语言版 `dist/`；公网版输出目录为 `dist-public/`。

如果以后连接 Git 仓库自动部署，对应设置为：构建命令 `npm run build:public`，构建输出目录 `dist-public`，无需环境变量或后端。当前目录不含 Git 元数据，直接上传即可。

## 发布后检查

- 首页能加载战场和兵种卡片，语言菜单只有 English、Português (Brasil)。
- 购买一名单位后刷新：回到第一关、资金 140、无友军。
- `?lang=pt-BR` 显示巴葡，`?lang=zh-CN` 不会启用中文。
- 下一关继续在当前页面加载，继承资金和幸存者。
- 浏览器 WebGL 2 用于三维渲染；无需用户授权或账户。

应用代码不保存玩家信息；Cloudflare 作为托管商的基础访问日志和浏览器的静态文件缓存仍由各自平台控制，本项目不能保证它们完全不记录任何数据。

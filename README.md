# BUSINESSFORUM202605

好未来业务论坛前端页。项目是一个静态 HTML 页面，主入口为 `index.html`，可以直接本地预览，也可以构建后部署到 GitHub Pages。

## 怎么做的

页面主要用原生 HTML、CSS 和 JavaScript 完成，没有依赖前端框架。视觉主体是业务论坛主视觉海报，外层加入了玻璃拟态卡片、动态弥散背景、粒子光效和音乐控制。

主要实现方式：

- `index.html`: 页面结构、样式和交互逻辑都集中在这里，便于快速交付和直接部署。
- `assets/logo.svg`、`assets/slogan.svg`: 页面中的品牌和标语图形。
- `assets/attendees.js`、`assets/blessings.js`: 参会者名单和祝福文案，用来生成页面里的动态问候。
- `media/`: 页面直接调用的背景视频、海报图和音乐资源。
- `scripts/build-static.mjs`: 构建静态发布目录，并按部署环境改写资源地址。
- `verify-html.mjs`: 用 Playwright 本地检查 HTML 渲染和截图。

## 本地预览

```bash
python3 -m http.server 8080
```

然后打开：

```text
http://localhost:8080/
```

## 构建

```bash
npm run build
```

构建结果会输出到 `dist/`。

## 本地验证

```bash
npm run verify
```

脚本会打开项目里的 HTML 页面，等待字体、图片和视频信息稳定后生成截图，并输出检查结果。

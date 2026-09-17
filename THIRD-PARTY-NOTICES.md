# 第三方声明

本文件记录本项目当前使用或早期依托的第三方项目。版本以 `package-lock.json` 为准；传递依赖可能随依赖版本更新而变化。

## 直接开发依赖

- [Vite](https://github.com/vitejs/vite)：本地开发服务器、生产构建和预览工具，MIT License。
- [Node.js](https://nodejs.org/)：运行 npm 脚本和 Node.js 内置测试运行器，适用 Node.js 及其组件各自的许可证。

## 传递依赖

Vite 当前带来的主要传递依赖包括：

- [esbuild](https://github.com/evanw/esbuild)：MIT License。
- [Rollup](https://github.com/rollup/rollup)：MIT License。
- [PostCSS](https://github.com/postcss/postcss)：MIT License。
- [nanoid](https://github.com/ai/nanoid)：MIT License。
- [picocolors](https://github.com/alexeyraspopov/picocolors)：ISC License。
- [source-map-js](https://github.com/7rulnik/source-map-js)：BSD-3-Clause License。
- [fsevents](https://github.com/fsevents/fsevents)：MIT License（macOS 可选依赖）。
- [@types/estree](https://github.com/DefinitelyTyped/DefinitelyTyped)：MIT License。

其中 `esbuild` 和 `Rollup` 还会按当前操作系统和 CPU 架构安装对应的可选平台包。完整包名、版本、来源和许可证信息请以 `package-lock.json` 及各包自身发布的许可证文本为准。

## 早期项目来源

本项目早期以 [relation-graph-startup-for-web-component](https://github.com/relation-graph/relation-graph-startup-for-web-component) 为工程起点，并参考了 [RelationGraph](https://github.com/relation-graph/relation-graph) 的 Web Component 方案。当前版本已移除 `@relation-graph/web-components` 的 npm 依赖，图谱渲染和计算逻辑位于本项目 `src/` 目录。若使用早期来源代码，应保留上游项目的 MIT 许可证和版权声明。

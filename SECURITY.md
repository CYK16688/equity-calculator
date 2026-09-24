# 安全与隐私

## 不要公开提交的内容

请不要在 Issue、Pull Request、截图或导出的 JSON 中提交以下内容：

- 真实企业的未公开股权资料、个人信息或客户数据
- 密码、访问令牌、私钥、证书和内部接口地址
- `.env` 文件、本地配置、日志、构建产物和编辑器临时文件

## 报告安全问题

请不要在公开 Issue 中粘贴敏感数据或可利用细节。安全漏洞请通过 [GitHub Private Vulnerability Reporting](https://github.com/CYK16688/equity-calculator/security/advisories/new) 提交；其他问题提交前先完成脱敏，并只提供复现所必需的信息。

本项目是浏览器本地工具，不提供后端鉴权或远程数据存储。应用中的图谱数据仍可能包含用户主动录入的敏感信息，使用者需要自行负责导出文件、浏览器存储和分享范围的管理。

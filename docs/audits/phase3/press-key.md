# 官方文档快照：文章客户端加密（press-key）

- 来源 URL：`https://docs.mizuki.mysqil.com/press/key/`
- 快照内容由架构师 2026-08-28 抓取，执行会话无网，以本文件为准。

## 机制

主题的文章密码锁为**纯客户端**实现，技术栈两件：

- **bcryptjs**：密码哈希比对——页面内预存密码哈希，访客输入密码后哈希比对，一致才放行；
- **crypto-js**：内容对称加密——明文密码（仅存浏览器内存、不发送）作为密钥，解密页面内密文，动态插入还原 HTML。

全流程在访客浏览器内完成：密码输入界面 → bcryptjs 哈希与页面预存哈希比对 → crypto-js 解密 → 渲染。官方定性：**「没有后端的情况下模拟出安全的验证-解密-渲染流程」**——即加密发生于构建期，Server 无参与义务。

## 用法（verbatim）

```yaml
---
title: '这是一篇加密文章'
encrypted: true
password: 'your-secret-password'
---
```

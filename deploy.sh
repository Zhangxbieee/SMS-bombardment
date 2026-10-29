#!/bin/bash
set -e

# Cloudflare Pages 部署脚本
echo "🚀 开始部署到 Cloudflare Pages..."

# 检查 Wrangler 是否已安装
if ! command -v wrangler &> /dev/null; then
    echo "❌ Wrangler CLI 未安装，请先运行：npm install -g wrangler"
    exit 1
fi

# 检查是否已登录
if ! wrangler whoami &> /dev/null; then
    echo "🔐 请先登录 Cloudflare：wrangler login"
    exit 1
fi

# 跑一遍单元测试再部署
echo "🧪 运行单元测试..."
npm test --silent

# 本地预览
echo "🔍 本地预览中..."
wrangler pages dev --port 8080 &
DEV_PID=$!

echo "✅ 本地预览已启动：http://localhost:8080"
echo "⏹️  按 Ctrl+C 停止预览"

# 等待用户输入
read -p "按 Enter 继续部署到生产环境..."

# 停止本地预览
kill $DEV_PID 2>/dev/null || true

# 部署到生产环境（静态资源在 public/，Functions 在 functions/）
echo "🌐 部署到生产环境..."
wrangler pages deploy --branch main

echo "✅ 部署完成！"
echo "📱 访问地址：https://zhangxbieee-sms-bombardment.pages.dev"

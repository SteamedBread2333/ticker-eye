#!/usr/bin/env node

/**
 * 生成Chrome扩展所需的图标文件
 * 需要安装 sharp: npm install sharp
 * 或者运行: npm install
 */

const fs = require('fs');
const path = require('path');

// 检查是否安装了sharp
let sharp;
try {
  sharp = require('sharp');
} catch (e) {
  console.error('错误: 需要安装 sharp 库');
  console.log('请运行: npm install sharp');
  console.log('或者使用浏览器打开 icons/generate-icons.html 来生成图标');
  process.exit(1);
}

const sizes = [16, 48, 128];
const iconsDir = path.join(__dirname, 'icons');

// 确保icons目录存在
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

async function generateIcon(size) {
  // 创建SVG
  const svg = `
    <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#4CAF50;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#2E7D32;stop-opacity:1" />
        </linearGradient>
      </defs>
      <rect width="${size}" height="${size}" rx="${size * 0.15}" fill="url(#grad)"/>
      <path d="M ${size * 0.15} ${size * 0.85} 
              L ${size * 0.35} ${size * 0.65} 
              L ${size * 0.55} ${size * 0.7} 
              L ${size * 0.75} ${size * 0.4} 
              L ${size * 0.95} ${size * 0.55} 
              L ${size * 0.99} ${size * 0.35}" 
            stroke="white" 
            stroke-width="${Math.max(1, size / 32)}" 
            fill="none" 
            stroke-linecap="round" 
            stroke-linejoin="round"/>
      <circle cx="${size * 0.99}" cy="${size * 0.35}" r="${Math.max(2, size / 25)}" fill="white"/>
    </svg>
  `;

  const outputPath = path.join(iconsDir, `icon${size}.png`);
  
  try {
    await sharp(Buffer.from(svg))
      .png()
      .toFile(outputPath);
    
    console.log(`已生成: icon${size}.png`);
  } catch (error) {
    console.error(`生成 icon${size}.png 失败:`, error.message);
  }
}

async function main() {
  console.log('开始生成图标文件...\n');
  
  for (const size of sizes) {
    await generateIcon(size);
  }
  
  console.log('\n所有图标生成完成！');
  console.log('现在可以加载Chrome扩展了。');
}

main().catch(console.error);

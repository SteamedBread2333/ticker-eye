#!/usr/bin/env node

// 测试脚本：检查美股和港股的API响应是否包含委比和量比数据
const https = require('https');
const http = require('http');

// 腾讯API测试函数
async function testTencentAPI(code, label) {
  return new Promise((resolve) => {
    const url = `http://qt.gtimg.cn/q=${code}`;
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          // 转换GBK到UTF-8
          const iconv = require('iconv-lite');
          const text = iconv.decode(Buffer.from(data, 'binary'), 'gbk');
          
          const match = text.match(/v_\w+="([^"]+)"/);
          if (!match || !match[1]) {
            resolve({ success: false, error: '无法解析响应' });
            return;
          }
          
          const fields = match[1].split('~');
          
          console.log(`\n=== ${label} (腾讯API) ===`);
          console.log(`字段总数: ${fields.length}`);
          console.log(`字段10-28 (买盘卖盘): ${fields.slice(9, 29).join(', ')}`);
          console.log(`字段49 (量比): ${fields[49] || '不存在'}`);
          
          // 检查委比相关字段
          const buy1 = fields[10] ? parseFloat(fields[10]) : 0;
          const buy2 = fields[12] ? parseFloat(fields[12]) : 0;
          const buy3 = fields[14] ? parseFloat(fields[14]) : 0;
          const buy4 = fields[16] ? parseFloat(fields[16]) : 0;
          const buy5 = fields[18] ? parseFloat(fields[18]) : 0;
          const sell1 = fields[20] ? parseFloat(fields[20]) : 0;
          const sell2 = fields[22] ? parseFloat(fields[22]) : 0;
          const sell3 = fields[24] ? parseFloat(fields[24]) : 0;
          const sell4 = fields[26] ? parseFloat(fields[26]) : 0;
          const sell5 = fields[28] ? parseFloat(fields[28]) : 0;
          
          const buyTotal = buy1 + buy2 + buy3 + buy4 + buy5;
          const sellTotal = sell1 + sell2 + sell3 + sell4 + sell5;
          const total = buyTotal + sellTotal;
          
          const hasWeibi = total > 0;
          const liangbi = fields[49] ? parseFloat(fields[49]) : null;
          const hasLiangbi = liangbi !== null && !isNaN(liangbi) && liangbi > 0;
          
          console.log(`买盘总量: ${buyTotal}`);
          console.log(`卖盘总量: ${sellTotal}`);
          console.log(`可计算委比: ${hasWeibi ? '是' : '否'}`);
          if (hasWeibi) {
            const weibi = ((buyTotal - sellTotal) / total * 100);
            console.log(`委比值: ${weibi.toFixed(2)}%`);
          }
          console.log(`可获取量比: ${hasLiangbi ? '是' : '否'}`);
          if (hasLiangbi) {
            console.log(`量比值: ${liangbi}`);
          }
          
          resolve({ 
            success: true, 
            fieldsCount: fields.length,
            hasWeibi, 
            hasLiangbi,
            weibiValue: hasWeibi ? ((buyTotal - sellTotal) / total * 100) : null,
            liangbiValue: liangbi
          });
        } catch (error) {
          resolve({ success: false, error: error.message });
        }
      });
    }).on('error', (error) => {
      resolve({ success: false, error: error.message });
    });
  });
}

// 新浪API测试函数
async function testSinaAPI(code, label) {
  return new Promise((resolve) => {
    const url = `https://hq.sinajs.cn/list=${code}`;
    const options = {
      headers: {
        'Referer': 'http://finance.sina.com.cn',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    };
    
    https.get(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          // 转换GBK到UTF-8
          const iconv = require('iconv-lite');
          const text = iconv.decode(Buffer.from(data, 'binary'), 'gbk');
          
          const match = text.match(/var hq_str_\w+="([^"]+)"/);
          if (!match || !match[1]) {
            resolve({ success: false, error: '无法解析响应' });
            return;
          }
          
          const fields = match[1].split(',');
          
          console.log(`\n=== ${label} (新浪API) ===`);
          console.log(`字段总数: ${fields.length}`);
          console.log(`字段9-28 (买盘卖盘): ${fields.slice(9, 29).join(', ')}`);
          
          // 检查委比相关字段
          const buy1 = parseFloat(fields[9]) || 0;
          const buy2 = parseFloat(fields[11]) || 0;
          const buy3 = parseFloat(fields[13]) || 0;
          const buy4 = parseFloat(fields[15]) || 0;
          const buy5 = parseFloat(fields[17]) || 0;
          const sell1 = parseFloat(fields[19]) || 0;
          const sell2 = parseFloat(fields[21]) || 0;
          const sell3 = parseFloat(fields[23]) || 0;
          const sell4 = parseFloat(fields[25]) || 0;
          const sell5 = parseFloat(fields[27]) || 0;
          
          const buyTotal = buy1 + buy2 + buy3 + buy4 + buy5;
          const sellTotal = sell1 + sell2 + sell3 + sell4 + sell5;
          const total = buyTotal + sellTotal;
          
          const hasWeibi = total > 0;
          
          console.log(`买盘总量: ${buyTotal}`);
          console.log(`卖盘总量: ${sellTotal}`);
          console.log(`可计算委比: ${hasWeibi ? '是' : '否'}`);
          if (hasWeibi) {
            const weibi = ((buyTotal - sellTotal) / total * 100);
            console.log(`委比值: ${weibi.toFixed(2)}%`);
          }
          console.log(`量比: 新浪API不支持量比字段`);
          
          resolve({ 
            success: true, 
            fieldsCount: fields.length,
            hasWeibi,
            weibiValue: hasWeibi ? ((buyTotal - sellTotal) / total * 100) : null,
            hasLiangbi: false
          });
        } catch (error) {
          resolve({ success: false, error: error.message });
        }
      });
    }).on('error', (error) => {
      resolve({ success: false, error: error.message });
    });
  });
}

// 主测试函数
async function runTests() {
  console.log('开始测试美股和港股的委比和量比数据...\n');
  
  const results = {};
  
  // 测试美股（AAPL）
  console.log('测试美股: AAPL');
  const tencentUS = await testTencentAPI('usAAPL', '美股 AAPL');
  const sinaUS = await testSinaAPI('gb_aapl', '美股 AAPL');
  results.us = { tencent: tencentUS, sina: sinaUS };
  
  // 测试港股（00700.HK）
  console.log('\n\n测试港股: 00700.HK');
  const tencentHK = await testTencentAPI('hk00700', '港股 00700');
  const sinaHK = await testSinaAPI('hk00700', '港股 00700');
  results.hk = { tencent: tencentHK, sina: sinaHK };
  
  // 测试A股作为对比（600000.SH）
  console.log('\n\n测试A股（对比）: 600000.SH');
  const tencentA = await testTencentAPI('sh600000', 'A股 600000');
  const sinaA = await testSinaAPI('sh600000', 'A股 600000');
  results.a = { tencent: tencentA, sina: sinaA };
  
  // 总结
  console.log('\n\n=== 测试总结 ===');
  console.log('\n美股 (AAPL):');
  console.log(`  腾讯API - 委比: ${tencentUS.hasWeibi ? '✓' : '✗'}, 量比: ${tencentUS.hasLiangbi ? '✓' : '✗'}`);
  console.log(`  新浪API - 委比: ${sinaUS.hasWeibi ? '✓' : '✗'}, 量比: ${sinaUS.hasLiangbi ? '✓' : '✗'}`);
  
  console.log('\n港股 (00700.HK):');
  console.log(`  腾讯API - 委比: ${tencentHK.hasWeibi ? '✓' : '✗'}, 量比: ${tencentHK.hasLiangbi ? '✓' : '✗'}`);
  console.log(`  新浪API - 委比: ${sinaHK.hasWeibi ? '✓' : '✗'}, 量比: ${sinaHK.hasLiangbi ? '✓' : '✗'}`);
  
  console.log('\nA股 (600000.SH) - 参考:');
  console.log(`  腾讯API - 委比: ${tencentA.hasWeibi ? '✓' : '✗'}, 量比: ${tencentA.hasLiangbi ? '✓' : '✗'}`);
  console.log(`  新浪API - 委比: ${sinaA.hasWeibi ? '✓' : '✗'}, 量比: ${sinaA.hasLiangbi ? '✓' : '✗'}`);
  
  // 结论
  console.log('\n=== 结论 ===');
  const usTencentFeasible = tencentUS.hasWeibi || tencentUS.hasLiangbi;
  const usSinaFeasible = sinaUS.hasWeibi;
  const hkTencentFeasible = tencentHK.hasWeibi || tencentHK.hasLiangbi;
  const hkSinaFeasible = sinaHK.hasWeibi;
  
  if (usTencentFeasible || usSinaFeasible || hkTencentFeasible || hkSinaFeasible) {
    console.log('✓ 可行！美股和/或港股API响应包含委比和/或量比数据');
    console.log('\n建议：');
    if (usTencentFeasible || hkTencentFeasible) {
      console.log('  - 腾讯API支持美股/港股的委比/量比数据');
    }
    if (usSinaFeasible || hkSinaFeasible) {
      console.log('  - 新浪API支持美股/港股的委比数据（但新浪API不支持量比）');
    }
  } else {
    console.log('✗ 不可行！美股和港股API响应不包含委比和量比数据');
  }
}

// 运行测试
runTests().catch(console.error);

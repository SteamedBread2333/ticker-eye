// Background service worker
// 可以在这里处理后台任务，如定期更新数据等

chrome.runtime.onInstalled.addListener(() => {
  // 扩展已安装
});

// 监听存储变化
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.tickers) {
    // 通知所有标签页更新
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { action: 'updateTickers' }).catch(() => {
          // 忽略无法发送消息的标签页（如chrome://页面）
        });
      });
    });
  }
});

// 处理消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getCurrentTabId') {
    // 返回发送消息的标签页ID
    const tabId = sender.tab?.id || null;
    sendResponse({ tabId });
    return true;
  } else if (message.action === 'tickerDeleted' || message.action === 'tickersReordered') {
    // 通知所有标签页更新（包括popup）
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { action: 'updateTickers' }).catch(() => {
          // 忽略错误（某些标签页可能没有content script）
        });
      });
    });
    return true;
  } else if (message.action === 'fetchPrice') {
    fetchPrice(message.symbol)
      .then(data => {
        if (data) {
          sendResponse({ success: true, data: data });
        } else {
          sendResponse({ success: false, error: '无法获取数据' });
        }
      })
      .catch(error => {
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }
});

// 使用新浪hq.sinajs.cn API获取股票数据（备用）
async function fetchPriceFromSina(symbol) {
  try {
    const normalizedSymbol = normalizeSymbol(symbol);
    let sinaCode = '';
    
    // 转换为新浪API格式
    if (normalizedSymbol.endsWith('.SH')) {
      const code = symbol.replace(/\.(SH|SS)$/i, '');
      sinaCode = `sh${code}`;
    } else if (normalizedSymbol.endsWith('.SZ')) {
      const code = symbol.replace(/\.SZ$/i, '');
      sinaCode = `sz${code}`;
    } else if (normalizedSymbol.endsWith('.HK')) {
      // 新浪可能不支持港股，但尝试一下
      const hkCode = symbol.replace(/\.HK$/i, '');
      sinaCode = `hk${hkCode.padStart(5, '0')}`;
    } else if (/^\d{6}$/.test(symbol)) {
      // 6位数字，根据normalizeSymbol的结果判断
      const normalized = normalizeSymbol(symbol);
      if (normalized.endsWith('.SZ')) {
        sinaCode = `sz${symbol}`; // 深圳
      } else {
        sinaCode = `sh${symbol}`; // 默认上海
      }
    } else {
      // 可能是美股代码（如AAPL），新浪API支持美股，格式为 gb_代码（小写）
      // 如果代码不包含点且不是纯数字，尝试作为美股查询
      if (!symbol.includes('.') && !/^\d+$/.test(symbol)) {
        sinaCode = `gb_${symbol.toLowerCase()}`;
      } else {
        return null;
      }
    }
    
    // 优先使用HTTPS（新浪API对HTTPS更友好）
    let url = `https://hq.sinajs.cn/list=${sinaCode}`;
    let response = await fetch(url, {
      method: 'GET',
      headers: {
        'Referer': 'http://finance.sina.com.cn',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
      },
      mode: 'cors',
      credentials: 'omit'
    });
    
    // 如果HTTPS返回403，尝试HTTP（某些情况下HTTP可能可用）
    if (!response.ok && response.status === 403) {
      url = `http://hq.sinajs.cn/list=${sinaCode}`;
      response = await fetch(url, {
        method: 'GET',
        headers: {
          'Referer': 'http://finance.sina.com.cn',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': '*/*',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
        },
        mode: 'cors',
        credentials: 'omit'
      });
    }
    if (!response.ok) {
      return null;
    }
    
    // 新浪API返回GBK编码
    const arrayBuffer = await response.arrayBuffer();
    const decoder = new TextDecoder('gbk');
    const text = decoder.decode(arrayBuffer);
    
    // 解析响应格式：var hq_str_sh600000="股票名称,今开,昨收,当前价,..."
    // 美股格式：var hq_str_gb_aapl="股票名称,当前价,涨跌额,涨跌幅,时间,涨跌额2,今开,最高,最低,52周最高,52周最低,...,昨收"
    const match = text.match(/var hq_str_\w+="([^"]+)"/);
    if (!match || !match[1]) {
      return null;
    }
    
    const fields = match[1].split(',');
    
    if (fields.length < 4) {
      return null;
    }
    
    let price, prevClose, change, changePercent;
    
    if (sinaCode.startsWith('gb_')) {
      // 美股格式：
      // 0: 股票名称
      // 1: 当前价
      // 2: 涨跌额
      // 3: 时间
      // 4: 涨跌额2
      // 5: 今开
      // 6: 最高
      // 7: 最低
      // ... 更多字段
      // 最后一个字段通常是昨收
      price = parseFloat(fields[1]);
      change = parseFloat(fields[2]) || 0;
      // 从最后一个字段获取昨收
      if (fields.length >= 1) {
        const lastField = fields[fields.length - 1];
        prevClose = parseFloat(lastField);
        if (isNaN(prevClose) || prevClose === 0) {
          // 如果最后一个字段无效，尝试计算
          prevClose = price - change;
        }
      } else {
        prevClose = price - change;
      }
      // 计算涨跌幅
      changePercent = prevClose && prevClose > 0 ? ((change / prevClose) * 100) : 0;
    } else {
      // A股/港股格式：
      // 0: 股票名称
      // 1: 今开
      // 2: 昨收
      // 3: 当前价
      price = parseFloat(fields[3]);
      prevClose = parseFloat(fields[2]);
      change = price - prevClose;
      changePercent = prevClose && prevClose > 0 ? ((change / prevClose) * 100) : 0;
    }
    
    if (isNaN(price) || price === 0) {
      return null;
    }
    
    // 计算委比（尝试对所有市场计算，包括美股和港股）
    // 新浪API字段：9-18是买盘（数量和价格交替），19-28是卖盘（数量和价格交替）
    let weibi = null;
    if (fields.length > 28) {
      try {
        const buy1 = parseFloat(fields[9]) || 0; // 买一量
        const buy2 = parseFloat(fields[11]) || 0; // 买二量
        const buy3 = parseFloat(fields[13]) || 0; // 买三量
        const buy4 = parseFloat(fields[15]) || 0; // 买四量
        const buy5 = parseFloat(fields[17]) || 0; // 买五量
        const sell1 = parseFloat(fields[19]) || 0; // 卖一量
        const sell2 = parseFloat(fields[21]) || 0; // 卖二量
        const sell3 = parseFloat(fields[23]) || 0; // 卖三量
        const sell4 = parseFloat(fields[25]) || 0; // 卖四量
        const sell5 = parseFloat(fields[27]) || 0; // 卖五量
        
        const buyTotal = buy1 + buy2 + buy3 + buy4 + buy5;
        const sellTotal = sell1 + sell2 + sell3 + sell4 + sell5;
        const total = buyTotal + sellTotal;
        
        if (total > 0) {
          weibi = ((buyTotal - sellTotal) / total * 100);
        }
      } catch (e) {
        // 忽略委比计算错误
      }
    }
    
    // 获取时间戳（新浪API美股格式中字段3是时间）
    let updateTime = null;
    if (sinaCode.startsWith('gb_') && fields.length > 3 && fields[3]) {
      try {
        const timeStr = fields[3].trim();
        if (timeStr) {
          updateTime = timeStr;
        }
      } catch (e) {
        // 忽略时间解析错误
      }
    }
    
    return {
      regularMarketPrice: price,
      regularMarketChange: change,
      regularMarketChangePercent: changePercent,
      weibi: weibi, // 委比（百分比）
      currency: normalizedSymbol.endsWith('.HK') ? 'HKD' : 
                (normalizedSymbol.endsWith('.SH') || normalizedSymbol.endsWith('.SZ') || normalizedSymbol.endsWith('.CNS')) ? 'CNY' : 'USD',
      normalizedSymbol: normalizedSymbol,
      stockName: fields[0] || '', // 股票名称
      updateTime: updateTime, // 数据更新时间
      source: 'sina'
    };
  } catch (error) {
    return null;
  }
}

// 使用腾讯qt.gtimg.cn API获取股票数据
async function fetchPriceFromTencent(symbol) {
  try {
    // 腾讯API需要市场前缀
    // 格式：sh（上海）、sz（深圳）、hk（港股）
    const normalizedSymbol = normalizeSymbol(symbol);
    let tencentCode = '';
    
    // 转换为腾讯API格式
    if (normalizedSymbol.endsWith('.SH')) {
      // 上海：sh + 6位数字（处理.SH或.SS后缀）
      const code = symbol.replace(/\.(SH|SS)$/i, '');
      tencentCode = `sh${code}`;
    } else if (normalizedSymbol.endsWith('.SZ')) {
      // 深圳：sz + 6位数字
      const code = symbol.replace(/\.SZ$/i, '');
      tencentCode = `sz${code}`;
    } else if (normalizedSymbol.endsWith('.HK')) {
      // 港股：hk + 代码（纯数字补零到5位，字母代码如HSI不补零）
      const hkCode = symbol.replace(/\.HK$/i, '');
      // 如果是纯数字，补零到5位；如果是字母代码（如HSI指数），不补零
      if (/^\d+$/.test(hkCode)) {
        tencentCode = `hk${hkCode.padStart(5, '0')}`;
      } else {
        tencentCode = `hk${hkCode}`;
      }
    } else if (/^\d{6}$/.test(symbol)) {
      // 6位数字，根据normalizeSymbol的结果判断
      const normalized = normalizeSymbol(symbol);
      if (normalized.endsWith('.SZ')) {
        tencentCode = `sz${symbol}`; // 深圳
      } else {
        tencentCode = `sh${symbol}`; // 默认上海
      }
    } else {
      // 可能是美股代码（如AAPL），腾讯API支持美股，格式为 us代码
      // 如果代码不包含点且不是纯数字，尝试作为美股查询
      if (!symbol.includes('.') && !/^\d+$/.test(symbol)) {
        tencentCode = `us${symbol.toUpperCase()}`;
      } else {
        return null;
      }
    }
    
    const url = `http://qt.gtimg.cn/q=${tencentCode}`;
    
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    
    // 腾讯API返回GBK编码，需要转换
    const arrayBuffer = await response.arrayBuffer();
    const decoder = new TextDecoder('gbk');
    const text = decoder.decode(arrayBuffer);
    
    // 解析响应格式：v_sh600000="1~name~code~price~prevClose~..." 或 v_usAAPL="200~name~code~price~prevClose~..."
    // 检查是否有匹配的数据
    if (text.includes('v_pv_none_match') || !text.includes('v_')) {
      return null;
    }
    
    const match = text.match(/v_\w+="([^"]+)"/);
    if (!match || !match[1]) {
      return null;
    }
    
    const fields = match[1].split('~');
    
    // 字段索引（根据实际响应）：
    // 0: 状态/交易所代码（1表示正常A股，200表示美股）
    // 1: 股票名称
    // 2: 股票代码
    // 3: 当前价格
    // 4: 昨收
    // 31: 涨跌额
    // 32: 涨跌幅（百分比，已包含%）
    
    if (fields.length < 4) {
      return null;
    }
    
    const price = parseFloat(fields[3]);
    const prevClose = parseFloat(fields[4]);
    
    if (isNaN(price) || price === 0) {
      return null;
    }
    
    // 获取涨跌额和涨跌幅
    const change = fields.length > 31 ? parseFloat(fields[31]) : (price - prevClose);
    const changePercentStr = fields.length > 32 ? fields[32] : '';
    let changePercent = 0;
    
    if (changePercentStr) {
      // 移除%符号并解析
      changePercent = parseFloat(changePercentStr.replace('%', '').trim());
    }
    
    // 如果涨跌幅无效，计算
    if (isNaN(changePercent) && prevClose && prevClose > 0) {
      changePercent = ((price - prevClose) / prevClose) * 100;
    }
    
    // 如果涨跌额无效，计算
    const finalChange = isNaN(change) ? (price - prevClose) : change;
    
    // 计算委比（尝试对所有市场计算，包括美股和港股）
    // 腾讯API字段：9-18是买盘（价格和数量交替），19-28是卖盘（价格和数量交替）
    let weibi = null;
    if (fields.length > 28) {
      try {
        // 确保字段存在且是有效数字
        const buy1 = fields[10] ? parseFloat(fields[10]) : 0; // 买一量
        const buy2 = fields[12] ? parseFloat(fields[12]) : 0; // 买二量
        const buy3 = fields[14] ? parseFloat(fields[14]) : 0; // 买三量
        const buy4 = fields[16] ? parseFloat(fields[16]) : 0; // 买四量
        const buy5 = fields[18] ? parseFloat(fields[18]) : 0; // 买五量
        const sell1 = fields[20] ? parseFloat(fields[20]) : 0; // 卖一量
        const sell2 = fields[22] ? parseFloat(fields[22]) : 0; // 卖二量
        const sell3 = fields[24] ? parseFloat(fields[24]) : 0; // 卖三量
        const sell4 = fields[26] ? parseFloat(fields[26]) : 0; // 卖四量
        const sell5 = fields[28] ? parseFloat(fields[28]) : 0; // 卖五量
        
        const buyTotal = buy1 + buy2 + buy3 + buy4 + buy5;
        const sellTotal = sell1 + sell2 + sell3 + sell4 + sell5;
        const total = buyTotal + sellTotal;
        
        if (total > 0 && !isNaN(buyTotal) && !isNaN(sellTotal)) {
          weibi = ((buyTotal - sellTotal) / total * 100);
        }
      } catch (e) {
        // 忽略委比计算错误
      }
    }
    
    // 获取量比（字段49，索引49）
    // 量比范围：150-250健康，250-350偏热，350-450过热，450+极度危险
    let liangbi = null;
    if (fields.length > 49) {
      try {
        const liangbiValue = parseFloat(fields[49]);
        // 允许更大的量比值（移除上限限制）
        if (!isNaN(liangbiValue) && liangbiValue > 0) {
          liangbi = liangbiValue;
        }
      } catch (e) {
        // 忽略量比解析错误
      }
    }
    
    // 获取时间戳（字段30通常是时间，格式可能是 HHMMSS 或完整时间戳）
    let updateTime = null;
    if (fields.length > 30 && fields[30]) {
      try {
        const timeStr = fields[30].trim();
        // 尝试解析时间格式
        if (timeStr && timeStr.length >= 6) {
          // 如果是14位数字（YYYYMMDDHHMMSS），转换为标准格式
          if (/^\d{14}$/.test(timeStr)) {
            const year = timeStr.substring(0, 4);
            const month = timeStr.substring(4, 6);
            const day = timeStr.substring(6, 8);
            const hour = timeStr.substring(8, 10);
            const minute = timeStr.substring(10, 12);
            const second = timeStr.substring(12, 14);
            updateTime = `${year}-${month}-${day} ${hour}:${minute}:${second}`;
          }
          // 如果是6位数字（HHMMSS），不处理（因为只有时间没有日期，不准确）
          // 如果是其他格式且看起来像时间（包含 - 和 :），直接使用
          else if (timeStr.includes('-') && timeStr.includes(':')) {
            updateTime = timeStr;
          }
          // 其他格式忽略，因为不确定是否准确
        }
      } catch (e) {
        // 忽略时间解析错误
      }
    }
    
    return {
      regularMarketPrice: price,
      regularMarketChange: finalChange,
      regularMarketChangePercent: changePercent,
      weibi: weibi, // 委比（百分比）
      liangbi: liangbi, // 量比
      currency: normalizedSymbol.endsWith('.HK') ? 'HKD' : 
                (normalizedSymbol.endsWith('.SH') || normalizedSymbol.endsWith('.SZ') || normalizedSymbol.endsWith('.CNS')) ? 'CNY' : 'USD',
      normalizedSymbol: normalizedSymbol,
      stockName: fields[1] || '', // 股票名称
      updateTime: updateTime, // 数据更新时间
      source: 'tencent'
    };
  } catch (error) {
    return null;
  }
}

// 获取股票价格（在background script中，可能有更好的权限）
async function fetchPrice(symbol) {
  const normalizedSymbol = normalizeSymbol(symbol);
  
  // 如果是6位数字且没有明确后缀，可能需要尝试两个市场
  if (/^\d{6}$/.test(symbol) && !symbol.includes('.')) {
    // 先尝试识别出的市场
    let tencentResult = await fetchPriceFromTencent(symbol);
    if (tencentResult) {
      return tencentResult;
    }
    
    // 如果失败，尝试另一个市场
    // 159开头默认深圳，如果失败尝试上海
    // 其他默认上海，如果失败尝试深圳
    if (/^159/.test(symbol)) {
      // 159开头，尝试上海看看
      const altResult = await fetchPriceFromTencent(symbol.replace(/^159/, 'sh159'));
      if (altResult) return altResult;
    } else {
      // 其他，尝试深圳
      const altResult = await fetchPriceFromTencent(symbol.replace(/^(\d{6})$/, 'sz$1'));
      if (altResult) return altResult;
    }
    
    // 尝试新浪API
    let sinaResult = await fetchPriceFromSina(symbol);
    if (sinaResult) {
      return sinaResult;
    }
    
    // 如果新浪也失败，尝试另一个市场
    if (/^159/.test(symbol)) {
      sinaResult = await fetchPriceFromSina(symbol.replace(/^159/, 'sh159'));
    } else {
      sinaResult = await fetchPriceFromSina(symbol.replace(/^(\d{6})$/, 'sz$1'));
    }
    if (sinaResult) {
      return sinaResult;
    }
  } else {
    // 有明确后缀或不是6位数字，正常处理
    // 优先使用腾讯API（支持A股、港股、美股）
    const tencentResult = await fetchPriceFromTencent(symbol);
    if (tencentResult) {
      return tencentResult;
    }
    
    // 如果腾讯API失败，尝试新浪API作为备用
    const sinaResult = await fetchPriceFromSina(symbol);
    if (sinaResult) {
      return sinaResult;
    }
  }
  
  return null;
}

// 规范化股票代码
function normalizeSymbol(symbol) {
  symbol = symbol.trim().toUpperCase();
  if (symbol.includes('.')) {
    // 将.SS转换为.SH（上海交易所）
    if (symbol.endsWith('.SS')) {
      return symbol.replace(/\.SS$/, '.SH');
    }
    return symbol;
  }
  if (/^\d+$/.test(symbol)) {
    if (symbol.length === 6) {
      // 上海：600xxx, 601xxx, 603xxx, 688xxx, 689xxx, 510xxx, 511xxx, 512xxx, 513xxx, 515xxx, 516xxx, 517xxx, 518xxx, 519xxx
      if (/^(600|601|603|688|689|510|511|512|513|515|516|517|518|519)/.test(symbol)) {
        return `${symbol}.SH`; // 上海交易所使用.SH
      } 
      // 深圳：000xxx, 001xxx, 002xxx, 003xxx, 300xxx, 159xxx（ETF）
      else if (/^(000|001|002|003|300|159)/.test(symbol)) {
        return `${symbol}.SZ`; // 深圳交易所
      }
      // 默认尝试上海
      return `${symbol}.SH`;
    }
    if (symbol.length >= 4 && symbol.length <= 5) {
      return `${symbol}.HK`;
    }
  }
  return symbol;
}


// 加载股票列表
async function loadTickers() {
  const result = await chrome.storage.sync.get(['tickers']);
  const tickers = result.tickers || [];
  
  // 检查当前标签页是否启用
  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    if (!tabs[0]) return;
    
    const tabId = tabs[0].id;
    const localResult = await chrome.storage.local.get(['enabledTabs']);
    const enabledTabs = localResult.enabledTabs || [];
    const enabled = enabledTabs.includes(tabId);
    
    document.getElementById('enableToggle').checked = enabled;
  });
  
  const tickerList = document.getElementById('tickerList');
  
  if (tickers.length === 0) {
    tickerList.innerHTML = '<div class="empty-state">暂无股票，请添加股票代码</div>';
    return;
  }
  
  tickerList.innerHTML = '';
  
  // 获取最新价格
  for (const ticker of tickers) {
    const item = document.createElement('div');
    item.className = 'ticker-item';
    
    const info = document.createElement('div');
    info.className = 'ticker-info';
    
    const symbol = document.createElement('div');
    symbol.className = 'ticker-symbol';
    symbol.textContent = ticker.toUpperCase();
    
    const price = document.createElement('div');
    price.className = 'ticker-price';
    price.textContent = '加载中...';
    
    info.appendChild(symbol);
    info.appendChild(price);
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn';
    deleteBtn.textContent = '删除';
    deleteBtn.onclick = () => deleteTicker(ticker);
    
    item.appendChild(info);
    item.appendChild(deleteBtn);
    tickerList.appendChild(item);
    
    // 获取价格
    fetchPrice(ticker).then(data => {
      if (data) {
        const change = data.regularMarketChange || 0;
        const changePercent = data.regularMarketChangePercent || 0;
        const priceValue = data.regularMarketPrice?.toFixed(2) || 'N/A';
        price.textContent = `${priceValue} (${change >= 0 ? '+' : ''}${changePercent.toFixed(2)}%)`;
        price.className = `ticker-price ${change >= 0 ? 'positive' : 'negative'}`;
        
        // 显示股票名称和代码
        if (data.stockName) {
          symbol.textContent = `${data.stockName} (${ticker.toUpperCase()})`;
        } else if (data.normalizedSymbol && data.normalizedSymbol !== ticker.toUpperCase()) {
          symbol.textContent = `${ticker.toUpperCase()} (${data.normalizedSymbol})`;
        } else {
          symbol.textContent = ticker.toUpperCase();
        }
      } else {
        // 生成尝试过的代码列表用于提示
        const normalizedSymbol = normalizeSymbol(ticker);
        const triedSymbols = [normalizedSymbol];
        if (/^\d+$/.test(ticker)) {
          if (normalizedSymbol.endsWith('.HK')) {
            triedSymbols.push(`${ticker}.SH`, `${ticker}.SZ`);
          } else if (normalizedSymbol.endsWith('.SH')) {
            triedSymbols.push(`${ticker}.HK`, `${ticker}.SZ`);
          } else if (normalizedSymbol.endsWith('.SZ')) {
            triedSymbols.push(`${ticker}.HK`, `${ticker}.SH`);
          }
        }
        price.textContent = '获取失败';
        price.className = 'ticker-price';
        
        // 检查是否是6位数字（可能是中国基金）
        const isChineseFund = /^\d{6}$/.test(ticker);
        let errorMsg = `已尝试: ${triedSymbols.join(', ')}\n`;
        if (isChineseFund) {
          errorMsg += `\n注意: 该代码可能是中国基金/ETF。\n`;
          errorMsg += `Yahoo Finance可能不支持某些中国基金代码。\n`;
          errorMsg += `建议: 访问 https://finance.yahoo.com 搜索该代码，\n`;
          errorMsg += `查看Yahoo Finance上的实际代码格式。`;
        } else {
          errorMsg += `\n提示: 请确认代码是否正确，或尝试手动添加市场后缀（如 .HK, .SH, .SZ）`;
        }
        price.title = errorMsg;
      }
    });
  }
}

// 规范化股票代码（添加市场后缀）
function normalizeSymbol(symbol) {
  symbol = symbol.trim().toUpperCase();
  
  // 如果已经包含市场后缀，将.SS转换为.SH
  if (symbol.includes('.')) {
    if (symbol.endsWith('.SS')) {
      return symbol.replace(/\.SS$/, '.SH');
    }
    return symbol;
  }
  
  // 纯数字代码，可能是港股或A股
  if (/^\d+$/.test(symbol)) {
    // A股代码通常是6位数字
    if (symbol.length === 6) {
      // 上海：600xxx, 601xxx, 603xxx, 688xxx, 689xxx, 510xxx, 511xxx, 512xxx, 513xxx, 515xxx, 516xxx, 517xxx, 518xxx, 519xxx
      // 深圳：000xxx, 001xxx, 002xxx, 003xxx, 300xxx, 159xxx（ETF）
      if (/^(600|601|603|688|689|510|511|512|513|515|516|517|518|519)/.test(symbol)) {
        return `${symbol}.SH`; // 上海（包括ETF代码51xxxx）
      } else if (/^(000|001|002|003|300|159)/.test(symbol)) {
        return `${symbol}.SZ`; // 深圳（包括ETF代码159xxx）
      }
      // 默认尝试上海
      return `${symbol}.SH`;
    }
    // 港股代码通常是4-5位数字（0001-99999）
    if (symbol.length >= 4 && symbol.length <= 5) {
      return `${symbol}.HK`; // 港股
    }
  }
  
  // 其他代码，直接返回
  return symbol;
}

// 获取股票价格 - 使用background script（腾讯/新浪API）
async function fetchPrice(symbol) {
  // 通过background script获取（使用腾讯/新浪API）
  try {
    // 检查扩展上下文是否有效
    if (!chrome.runtime?.id) {
      return null;
    }
    
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'fetchPrice', symbol: symbol }, (response) => {
        if (chrome.runtime.lastError) {
          // 静默处理所有错误
          resolve(null);
        } else {
          resolve(response);
        }
      });
    });
    
    if (response && response.success && response.data) {
      return response.data;
    }
  } catch (error) {
    // 静默处理所有错误
  }
  
  return null;
}


// 添加股票
async function addTicker() {
  const input = document.getElementById('tickerInput');
  const symbol = input.value.trim().toUpperCase();
  
  if (!symbol) {
    alert('请输入代码');
    return;
  }
  
  const result = await chrome.storage.sync.get(['tickers']);
  const tickers = result.tickers || [];
  
  if (tickers.includes(symbol)) {
    alert('该股票已存在');
    return;
  }
  
  tickers.unshift(symbol); // 添加到第一个位置
  await chrome.storage.sync.set({ tickers });
  
  input.value = '';
  loadTickers();
  
  // 通知content script更新
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'updateTickers' }, (response) => {
        // 静默处理所有错误（content script可能不存在或页面不支持）
        if (chrome.runtime.lastError) {
          // 忽略所有错误，不输出警告
        }
      });
    }
  });
}

// 删除股票
async function deleteTicker(symbol) {
  const result = await chrome.storage.sync.get(['tickers']);
  const tickers = result.tickers || [];
  const filtered = tickers.filter(t => t !== symbol);
  
  await chrome.storage.sync.set({ tickers: filtered });
  loadTickers();
  
  // 通知content script更新
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'updateTickers' }, (response) => {
        // 静默处理所有错误（content script可能不存在或页面不支持）
        if (chrome.runtime.lastError) {
          // 忽略所有错误，不输出警告
        }
      });
    }
  });
}

// 切换启用状态
async function toggleEnabled() {
  const enabled = document.getElementById('enableToggle').checked;
  
  // 获取当前标签页ID
  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    if (!tabs[0]) return;
    
    const tabId = tabs[0].id;
    
    // 更新启用标签页列表
    const result = await chrome.storage.local.get(['enabledTabs']);
    const enabledTabs = result.enabledTabs || [];
    
    if (enabled) {
      // 添加到启用列表
      if (!enabledTabs.includes(tabId)) {
        enabledTabs.push(tabId);
        await chrome.storage.local.set({ enabledTabs });
      }
    } else {
      // 从启用列表移除
      const filtered = enabledTabs.filter(id => id !== tabId);
      await chrome.storage.local.set({ enabledTabs: filtered });
    }
    
    // 更新popup中的全局enabled状态（用于显示开关状态）
    await chrome.storage.sync.set({ enabled });
    
    // 通知content script
    chrome.tabs.sendMessage(tabId, { action: 'toggleEnabled', enabled }, (response) => {
      // 静默处理所有错误（content script可能不存在或页面不支持）
      if (chrome.runtime.lastError) {
        // 忽略所有错误，不输出警告
      }
    });
  });
}

// 监听消息（用于接收删除通知）
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'updateTickers') {
    loadTickers();
  }
  return true; // 保持消息通道开放
});

// 事件监听
document.getElementById('addBtn').addEventListener('click', addTicker);
document.getElementById('tickerInput').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    addTicker();
  }
});
document.getElementById('enableToggle').addEventListener('change', toggleEnabled);

// 初始化
loadTickers();

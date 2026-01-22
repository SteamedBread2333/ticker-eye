// 创建UI容器
let tickerContainer = null;
let refreshInterval = null;
let isDragging = false;
let dragOffset = { x: 0, y: 0 };

// 初始化
async function init() {
  try {
    // 检查扩展上下文是否有效
    if (!chrome.runtime?.id) {
      return;
    }
    
    // 先获取股票列表，如果有股票再检查是否启用
    const tickersResult = await chrome.storage.sync.get(['tickers']);
    if (chrome.runtime.lastError) {
      // 静默处理所有错误
      return;
    }
    
    const tickers = tickersResult.tickers || [];
    if (tickers.length === 0) {
      return; // 没有股票，不显示
    }
    
    // 检查当前标签页是否启用了浮窗
    const tabId = await getCurrentTabId();
    
    // 如果无法获取tabId，尝试使用旧的enabled状态作为fallback
    let shouldShow = false;
    
    if (tabId) {
      const result = await chrome.storage.local.get(['enabledTabs']);
      if (!chrome.runtime.lastError) {
        const enabledTabs = result.enabledTabs || [];
        shouldShow = enabledTabs.includes(tabId);
      } else {
        // 如果获取enabledTabs失败，默认显示
        shouldShow = true;
      }
    } else {
      // 如果无法获取tabId，检查旧的全局enabled状态（向后兼容）
      const oldEnabledResult = await chrome.storage.sync.get(['enabled']);
      if (!chrome.runtime.lastError) {
        shouldShow = oldEnabledResult.enabled !== false; // 默认启用
      } else {
        // 如果都获取失败，默认显示
        shouldShow = true;
      }
    }
    
    if (shouldShow) {
      createUI();
      await updateTickers();
      startRefresh();
      loadPosition(); // 加载保存的位置
    }
  } catch (error) {
    // 静默处理所有错误
  }
}

// 获取当前标签页ID
async function getCurrentTabId() {
  return new Promise((resolve) => {
    try {
      // 检查扩展上下文是否有效
      try {
        if (!chrome.runtime?.id) {
          resolve(null);
          return;
        }
      } catch (e) {
        // 如果访问 chrome.runtime 本身抛出错误，说明扩展上下文已失效
        resolve(null);
        return;
      }
      
      try {
        chrome.runtime.sendMessage({ action: 'getCurrentTabId' }, (response) => {
          if (chrome.runtime.lastError) {
            // 处理扩展上下文失效的情况
            const error = chrome.runtime.lastError.message || '';
            if (error.includes('Extension context invalidated') || 
                error.includes('message port closed')) {
              // 静默处理，不输出警告
              resolve(null);
              return;
            }
            resolve(null);
          } else {
            resolve(response?.tabId || null);
          }
        });
      } catch (e) {
        // 如果 sendMessage 本身抛出错误，说明扩展上下文已失效
        resolve(null);
      }
    } catch (error) {
      // 静默处理所有错误
      resolve(null);
    }
  });
}

// 创建UI - 可拖拽浮窗
function createUI() {
  // 检查body是否存在
  if (!document.body) {
    return;
  }
  
  // 创建股票行情浮窗
  if (!tickerContainer) {
    tickerContainer = document.createElement('div');
    tickerContainer.id = 'ticker-eye-container';
    
    // 创建标题栏（可拖拽区域）
    const header = document.createElement('div');
    header.className = 'ticker-header';
    header.innerHTML = '<span class="ticker-title">📈 股票行情</span>';
    
    // 创建内容区域
    const content = document.createElement('div');
    content.className = 'ticker-content';
    content.id = 'ticker-content';
    
    tickerContainer.appendChild(header);
    tickerContainer.appendChild(content);
    document.body.appendChild(tickerContainer);
    
    // 添加拖拽功能
    setupDrag(header);
  }
}

// 设置拖拽功能
function setupDrag(header) {
  header.style.cursor = 'move';
  
  header.addEventListener('mousedown', (e) => {
    isDragging = true;
    const rect = tickerContainer.getBoundingClientRect();
    dragOffset.x = e.clientX - rect.left;
    dragOffset.y = e.clientY - rect.top;
    tickerContainer.style.transition = 'none';
    e.preventDefault();
  });
  
  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    
    const x = e.clientX - dragOffset.x;
    const y = e.clientY - dragOffset.y;
    
    // 限制在视窗内
    const maxX = window.innerWidth - tickerContainer.offsetWidth;
    const maxY = window.innerHeight - tickerContainer.offsetHeight;
    
    const finalX = Math.max(0, Math.min(x, maxX));
    const finalY = Math.max(0, Math.min(y, maxY));
    
    tickerContainer.style.left = finalX + 'px';
    tickerContainer.style.top = finalY + 'px';
    
    // 保存位置
    savePosition(finalX, finalY);
  });
  
  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      tickerContainer.style.transition = '';
    }
  });
}

// 保存位置
function savePosition(x, y) {
  try {
    if (!chrome.runtime?.id) {
      return;
    }
    
    chrome.storage.local.set({ tickerPosition: { x, y } }, () => {
      // 静默处理所有错误
    });
  } catch (error) {
    // 静默处理所有错误
  }
}

// 加载位置
async function loadPosition() {
  try {
    if (!chrome.runtime?.id) {
      return;
    }
    
    const result = await chrome.storage.local.get(['tickerPosition']);
    if (chrome.runtime.lastError) {
      // 静默处理所有错误
      return;
    }
    
    if (result.tickerPosition && tickerContainer) {
      tickerContainer.style.left = result.tickerPosition.x + 'px';
      tickerContainer.style.top = result.tickerPosition.y + 'px';
    }
  } catch (error) {
    // 静默处理所有错误
  }
}

// 更新股票列表
async function updateTickers() {
  try {
    // 检查扩展上下文是否有效
    try {
      // 尝试访问 chrome.runtime.id，如果失败说明扩展上下文已失效
      const runtimeId = chrome.runtime?.id;
      if (!runtimeId) {
        return;
      }
    } catch (e) {
      // 如果访问 chrome.runtime 本身抛出错误，说明扩展上下文已失效
      return;
    }
    
    // 检查当前标签页是否启用
    const tabId = await getCurrentTabId();
    
    // 如果无法获取tabId，检查旧的全局enabled状态（向后兼容）
    let isEnabled = false;
    
    if (tabId) {
      try {
        const localResult = await chrome.storage.local.get(['enabledTabs']);
        if (chrome.runtime.lastError) {
          // 如果获取失败，默认启用
          isEnabled = true;
        } else {
          const enabledTabs = localResult.enabledTabs || [];
          isEnabled = enabledTabs.includes(tabId);
        }
      } catch (e) {
        // 其他错误，默认启用
        isEnabled = true;
      }
    } else {
      // 如果无法获取tabId，检查旧的全局enabled状态
      try {
        const oldEnabledResult = await chrome.storage.sync.get(['enabled']);
        if (chrome.runtime.lastError) {
          // 如果都获取失败，默认启用
          isEnabled = true;
        } else {
          isEnabled = oldEnabledResult.enabled !== false; // 默认启用
        }
      } catch (e) {
        // 其他错误，默认启用
        isEnabled = true;
      }
    }
    
    if (!isEnabled) {
      // 如果当前标签页未启用，移除UI
      removeUI();
      return;
    }
    
    let result;
    try {
      result = await chrome.storage.sync.get(['tickers']);
      if (chrome.runtime.lastError) {
        // 静默处理所有错误
        return;
      }
    } catch (e) {
      // 如果访问 storage 本身抛出错误，说明扩展上下文已失效
      // 静默处理所有错误
      return;
    }
    
    const tickers = result.tickers || [];
    
    const contentDiv = document.getElementById('ticker-content');
    if (!contentDiv || tickers.length === 0) {
      if (contentDiv) {
        contentDiv.innerHTML = '<div class="ticker-empty">暂无股票，请添加股票代码</div>';
      }
      return;
    }
    
    const promises = tickers.map(symbol => fetchTickerData(symbol));
    const results = await Promise.all(promises);
    
    // 保存当前顺序，用于拖拽时计算新位置
    const currentTickers = [...tickers];
    
    contentDiv.innerHTML = results
    .map((data, index) => {
      if (!data) {
        const symbol = tickers[index];
        return `
          <div class="ticker-item ticker-error" data-symbol="${symbol}" data-index="${index}">
            <div class="ticker-order-controls">
              <button class="ticker-order-btn ticker-order-up" data-index="${index}" ${index === 0 ? 'disabled' : ''} title="上移">↑</button>
              <button class="ticker-order-btn ticker-order-down" data-index="${index}" ${index === tickers.length - 1 ? 'disabled' : ''} title="下移">↓</button>
            </div>
            <div style="flex: 1; min-width: 0;">
              <div class="ticker-symbol ticker-symbol-clickable" data-symbol="${symbol}" title="点击复制代码: ${symbol}">${symbol}</div>
              <div class="ticker-error-text">获取失败</div>
            </div>
            <button class="ticker-copy-item-btn" data-symbol="${symbol}" data-index="${index}" title="复制股票代码">📋</button>
          </div>
        `;
      }
      
      const symbol = tickers[index];
      const price = data.regularMarketPrice || 0;
      const change = data.regularMarketChange || 0;
      const changePercent = data.regularMarketChangePercent || 0;
      const weibi = data.weibi; // 委比（可能为null）
      const liangbi = data.liangbi; // 量比（可能为null）
      const isPositive = change >= 0;
      
      // 显示股票名称，如果名称太长则只显示代码
      const stockName = data.stockName || '';
      const displayName = stockName ? `${stockName} (${symbol})` : symbol;
      
      // 委比和量比显示逻辑
      let weibiHtml = '';
      if (weibi !== null && !isNaN(weibi)) {
        const weibiPositive = weibi >= 0;
        weibiHtml = `<span class="ticker-weibi ${weibiPositive ? 'positive' : 'negative'}" title="委比 (Bid Ratio)">
          BR: ${weibiPositive ? '+' : ''}${weibi.toFixed(2)}%
        </span>`;
      }
      
      let liangbiHtml = '';
      if (liangbi !== null && !isNaN(liangbi)) {
        liangbiHtml = `<span class="ticker-liangbi" title="量比 (Volume Ratio)">
          VR: ${liangbi.toFixed(2)}
        </span>`;
      }
      
      // 合并委比和量比显示
      let ratioHtml = '';
      if (weibiHtml || liangbiHtml) {
        ratioHtml = `<div style="margin-top: 2px; display: flex; align-items: center; gap: 8px;">
          ${weibiHtml}
          ${liangbiHtml}
        </div>`;
      }
      
      return `
        <div class="ticker-item" data-symbol="${symbol}" data-index="${index}">
          <div class="ticker-order-controls">
            <button class="ticker-order-btn ticker-order-up" data-index="${index}" ${index === 0 ? 'disabled' : ''} title="上移">↑</button>
            <button class="ticker-order-btn ticker-order-down" data-index="${index}" ${index === tickers.length - 1 ? 'disabled' : ''} title="下移">↓</button>
          </div>
          <div style="flex: 1; min-width: 0;">
            <div class="ticker-symbol ticker-symbol-clickable" data-symbol="${symbol}" title="点击复制代码: ${symbol}">${displayName}</div>
            <div style="display: flex; align-items: baseline; gap: 8px; margin-top: 4px;">
              <span class="ticker-price ${isPositive ? 'positive' : 'negative'}">
                ${price.toFixed(2)}
              </span>
              <span class="ticker-change ${isPositive ? 'positive' : 'negative'}">
                ${isPositive ? '+' : ''}${changePercent.toFixed(2)}%
              </span>
            </div>
            ${ratioHtml}
          </div>
          <button class="ticker-copy-item-btn" data-symbol="${symbol}" data-index="${index}" title="复制该股票所有信息">📋</button>
        </div>
      `;
    })
    .join('');
    
    // 添加股票代码点击复制功能
    contentDiv.querySelectorAll('.ticker-symbol-clickable').forEach(el => {
      el.addEventListener('click', async (e) => {
        e.stopPropagation();
        const symbol = el.getAttribute('data-symbol');
        if (symbol) {
          await copyToClipboard(symbol, el);
        }
      });
    });
    
    // 添加上下箭头排序功能
    setupOrderButtons(contentDiv, tickers);
    
    // 添加复制按钮功能
    setupCopyButtons(contentDiv, results, tickers);
  } catch (error) {
    // 捕获并处理扩展上下文失效的错误
    const errorMsg = error.message || '';
    if (errorMsg.includes('Extension context invalidated') || 
        errorMsg.includes('message port closed')) {
      // 静默处理扩展上下文失效，移除UI
      removeUI();
    }
    // 静默处理所有错误，不输出警告
  }
}

// 设置上下箭头排序功能
function setupOrderButtons(container, tickers) {
  // 上移按钮
  container.querySelectorAll('.ticker-order-up').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const currentIndex = parseInt(btn.getAttribute('data-index'));
      if (currentIndex > 0) {
        await reorderTickers(currentIndex, currentIndex - 1);
        await updateTickers();
      }
    });
  });
  
  // 下移按钮
  container.querySelectorAll('.ticker-order-down').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const currentIndex = parseInt(btn.getAttribute('data-index'));
      if (currentIndex < tickers.length - 1) {
        await reorderTickers(currentIndex, currentIndex + 1);
        await updateTickers();
      }
    });
  });
}



// 设置复制按钮功能
function setupCopyButtons(contentDiv, results, tickers) {
  contentDiv.querySelectorAll('.ticker-copy-item-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const index = parseInt(btn.getAttribute('data-index'));
      const symbol = btn.getAttribute('data-symbol');
      
      let copyText = '';
      
      // 检查是否有数据（获取失败的情况）
      if (index >= 0 && index < results.length && results[index]) {
        const data = results[index];
        const price = data.regularMarketPrice || 0;
        const change = data.regularMarketChange || 0;
        const changePercent = data.regularMarketChangePercent || 0;
        const weibi = data.weibi;
        const liangbi = data.liangbi;
        const stockName = data.stockName || '';
        
        // 构建要复制的文本
        copyText = `${stockName ? stockName + ' ' : ''}${symbol}\n`;
        copyText += `价格: ${price.toFixed(2)}\n`;
        copyText += `涨跌: ${change >= 0 ? '+' : ''}${changePercent.toFixed(2)}%\n`;
        
        if (weibi !== null && !isNaN(weibi)) {
          copyText += `委比: ${weibi >= 0 ? '+' : ''}${weibi.toFixed(2)}%\n`;
        }
        
        if (liangbi !== null && !isNaN(liangbi)) {
          copyText += `量比: ${liangbi.toFixed(2)}\n`;
        }
      } else {
        // 获取失败的情况，只复制股票代码
        copyText = symbol;
      }
      
      // 复制到剪贴板
      try {
        await navigator.clipboard.writeText(copyText.trim());
        showCopyToast(btn, '已复制');
        
        // 临时改变按钮样式
        const originalHTML = btn.innerHTML;
        btn.innerHTML = '✓';
        btn.style.background = '#4CAF50';
        btn.style.color = 'white';
        setTimeout(() => {
          btn.innerHTML = originalHTML;
          btn.style.background = '';
          btn.style.color = '';
        }, 1000);
      } catch (err) {
        // 降级方案：使用传统方法
        const textArea = document.createElement('textarea');
        textArea.value = copyText.trim();
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        document.body.appendChild(textArea);
        textArea.select();
        try {
          document.execCommand('copy');
          showCopyToast(btn, '已复制');
        } catch (err2) {
          showCopyToast(btn, '复制失败');
        }
        document.body.removeChild(textArea);
      }
    });
  });
}

// 重新排序股票列表
async function reorderTickers(fromIndex, toIndex) {
  try {
    if (!chrome.runtime?.id) {
      return;
    }
    
    const result = await chrome.storage.sync.get(['tickers']);
    if (chrome.runtime.lastError) {
      // 静默处理所有错误
      return;
    }
    
    const tickers = result.tickers || [];
    
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || 
        fromIndex >= tickers.length || toIndex >= tickers.length) {
      return;
    }
    
    // 移动元素
    const [moved] = tickers.splice(fromIndex, 1);
    tickers.splice(toIndex, 0, moved);
    
    // 保存新顺序
    await chrome.storage.sync.set({ tickers });
    
    // 通知popup更新（静默处理所有错误）
    try {
      if (chrome.runtime?.id) {
        chrome.runtime.sendMessage({ action: 'tickersReordered' }, () => {
          // 静默处理所有错误，不输出警告
        });
      }
    } catch (error) {
      // 静默处理所有错误
    }
  } catch (error) {
    // 静默处理所有错误
  }
}

// 复制到剪贴板
async function copyToClipboard(text, element) {
  try {
    await navigator.clipboard.writeText(text);
    
    // 显示复制成功提示
    showCopyToast(element, '已复制');
    
    // 临时改变按钮样式
    if (element.classList.contains('ticker-copy-btn')) {
      element.textContent = '✓';
      element.style.background = '#4CAF50';
      element.style.color = 'white';
      setTimeout(() => {
        element.textContent = '📋';
        element.style.background = '';
        element.style.color = '';
      }, 1000);
    }
  } catch (err) {
    // 降级方案：使用传统方法
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    document.body.appendChild(textArea);
    textArea.select();
    try {
      document.execCommand('copy');
      showCopyToast(element, '已复制');
    } catch (err2) {
      showCopyToast(element, '复制失败');
    }
    document.body.removeChild(textArea);
  }
}

// 显示复制提示
function showCopyToast(element, message) {
  // 移除已存在的提示
  const existingToast = document.getElementById('ticker-copy-toast');
  if (existingToast) {
    existingToast.remove();
  }
  
  // 创建提示元素
  const toast = document.createElement('div');
  toast.id = 'ticker-copy-toast';
  toast.textContent = message;
  toast.className = 'ticker-copy-toast';
  
  // 定位到元素附近
  const rect = element.getBoundingClientRect();
  toast.style.left = (rect.left + rect.width / 2) + 'px';
  toast.style.top = (rect.top - 30) + 'px';
  
  document.body.appendChild(toast);
  
  // 动画显示
  setTimeout(() => {
    toast.classList.add('show');
  }, 10);
  
  // 2秒后移除
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }, 2000);
}

// 删除股票
async function deleteTicker(symbol) {
  try {
    if (!chrome.runtime?.id) {
      return;
    }
    
    const result = await chrome.storage.sync.get(['tickers']);
    if (chrome.runtime.lastError) {
      // 静默处理所有错误
      return;
    }
    
    const tickers = result.tickers || [];
    const filtered = tickers.filter(t => t !== symbol);
    
      await chrome.storage.sync.set({ tickers: filtered });
    
    // 更新显示
    await updateTickers();
    
    // 通知popup更新（如果popup打开，静默处理所有错误）
    try {
      if (chrome.runtime?.id) {
        chrome.runtime.sendMessage({ action: 'tickerDeleted' }, () => {
          // 静默处理所有错误，不输出警告
        });
      }
    } catch (error) {
      // 静默处理所有错误
    }
  } catch (error) {
    // 静默处理所有错误
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

// 获取股票数据 - 使用background script
async function fetchTickerData(symbol) {
  // 通过background script获取（使用腾讯/新浪API）
  try {
    // 检查扩展上下文是否有效
    try {
      if (!chrome.runtime?.id) {
        return null;
      }
    } catch (e) {
      // 如果访问 chrome.runtime 本身抛出错误，说明扩展上下文已失效
      return null;
    }
    
    const response = await new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ action: 'fetchPrice', symbol: symbol }, (response) => {
          if (chrome.runtime.lastError) {
            const error = chrome.runtime.lastError.message || '';
            if (error.includes('Extension context invalidated') || 
                error.includes('message port closed')) {
              // 静默处理，不输出警告
              resolve(null);
              return;
            }
            resolve(null);
          } else {
            resolve(response);
          }
        });
      } catch (e) {
        // 如果 sendMessage 本身抛出错误，说明扩展上下文已失效
        resolve(null);
      }
    });
    
    if (response && response.success && response.data) {
      return {
        regularMarketPrice: response.data.regularMarketPrice,
        regularMarketChange: response.data.regularMarketChange,
        regularMarketChangePercent: response.data.regularMarketChangePercent,
        weibi: response.data.weibi, // 委比
        liangbi: response.data.liangbi, // 量比
        currency: response.data.currency,
        stockName: response.data.stockName
      };
    }
  } catch (error) {
    // 静默处理所有错误
  }
  
  return null;
}


// 开始刷新
function startRefresh() {
  // 清除已有定时器
  if (refreshInterval) clearInterval(refreshInterval);
  
  // 每3秒刷新股票数据
  refreshInterval = setInterval(() => {
    // 在定时器中调用时，确保捕获所有错误
    updateTickers().catch(() => {
      // 静默处理所有错误
    });
  }, 3000);
}

// 停止刷新
function stopRefresh() {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
}

// 移除UI
function removeUI() {
  if (tickerContainer) {
    tickerContainer.remove();
    tickerContainer = null;
  }
  stopRefresh();
}

// 监听消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'updateTickers') {
    updateTickers();
  } else if (message.action === 'toggleEnabled') {
    // 获取当前标签页ID
    getCurrentTabId().then(tabId => {
      if (!tabId) return;
      
      try {
        if (!chrome.runtime?.id) {
          return;
        }
        
        // 更新启用标签页列表
        chrome.storage.local.get(['enabledTabs'], (result) => {
          if (chrome.runtime.lastError) {
            // 静默处理所有错误
            return;
          }
          
          const enabledTabs = result.enabledTabs || [];
          
          if (message.enabled) {
            // 添加到启用列表
            if (!enabledTabs.includes(tabId)) {
              enabledTabs.push(tabId);
              try {
                chrome.storage.local.set({ enabledTabs }, () => {
                  // 静默处理所有错误
                });
              } catch (e) {
                // 静默处理所有错误
              }
            }
            createUI();
            updateTickers().catch(() => {
              // 静默处理所有错误
            });
            startRefresh();
            loadPosition();
          } else {
            // 从启用列表移除
            const filtered = enabledTabs.filter(id => id !== tabId);
            try {
              chrome.storage.local.set({ enabledTabs: filtered }, () => {
                // 静默处理所有错误
              });
            } catch (e) {
              // 静默处理所有错误
            }
            removeUI();
          }
        });
      } catch (error) {
        // 静默处理所有错误
      }
    });
  }
});

// 页面加载完成后初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

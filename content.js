// 创建UI容器
let tickerContainer = null;
let refreshInterval = null;
let isDragging = false;
let dragOffset = { x: 0, y: 0 };
let isMinimized = false;
let minimizedPosition = null;
let goldIcon = null;

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
      await loadPosition(); // 先加载保存的位置和大小
      await loadMinimizedState(); // 加载最小化状态
      if (!isMinimized) {
        await updateTickers();
        startRefresh();
      }
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
    // 创建拖拽图标
    const dragIcon = document.createElement('div');
    dragIcon.className = 'ticker-drag-icon';
    dragIcon.innerHTML = `<svg viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" width="20" height="20"><path d="M512 704a32 32 0 0 1 31.701333 27.648l0.298667 4.352v93.354667l30.72-30.634667a32 32 0 0 1 41.642667-3.114667l3.584 3.114667a32 32 0 0 1 3.114666 41.642667l-3.114666 3.584-85.333334 85.333333-1.621333 1.536-3.072 2.389333-4.053333 2.304-3.712 1.493334-4.352 1.152-3.626667 0.426666h-4.394667l-5.12-0.768-2.901333-0.810666-2.517333-0.981334-2.986667-1.493333-2.218667-1.365333-1.322666-0.938667a32.170667 32.170667 0 0 1-3.370667-2.944l-85.333333-85.333333a32 32 0 0 1 41.685333-48.341334l3.584 3.114667 30.72 30.677333V736a32 32 0 0 1 27.648-31.701333L512 704zM512 384a128 128 0 1 1 0 256 128 128 0 0 1 0-256z m286.72 20.053333a32 32 0 0 1 41.642667-3.114666l3.584 3.114666 85.333333 85.333334 1.493333 1.621333 2.389334 3.072 2.346666 4.053333 1.493334 3.669334 1.109333 4.394666 0.426667 3.626667v4.352l-0.725334 5.12-0.853333 2.901333-0.938667 2.56-1.493333 2.986667-1.365333 2.176-1.194667 1.621333-2.688 3.072-85.333333 85.333334a32 32 0 0 1-48.341334-41.642667l3.072-3.584 30.677334-30.72H736a32 32 0 0 1-31.744-27.648L704 512a32 32 0 0 1 27.648-31.701333l4.352-0.298667h93.397333l-30.72-30.72a32 32 0 0 1-3.072-41.642667l3.072-3.584z m-618.666667 0a32 32 0 0 1 48.341334 41.642667l-3.114667 3.584-30.72 30.72h93.44a32 32 0 0 1 31.701333 27.648L320 512a32 32 0 0 1-27.690667 31.701333l-4.309333 0.298667H194.56l30.72 30.72a32 32 0 0 1 3.114667 41.642667l-3.114667 3.584a32 32 0 0 1-41.685333 3.114666l-3.584-3.114666-85.333334-85.333334-3.84-4.693333-2.346666-4.053333-1.536-3.669334-1.109334-4.394666-0.469333-3.84v-3.968l0.768-5.290667 0.853333-2.901333 0.938667-2.56 1.493333-2.986667 1.365334-2.176 0.981333-1.365333a32.256 32.256 0 0 1 2.901333-3.328l85.333334-85.333334zM512 448a64 64 0 1 0 0 128 64 64 0 0 0 0-128z m-5.845333-362.154667l2.858666-0.384 3.712-0.128 2.56 0.170667 4.010667 0.682667 2.901333 0.810666 2.517334 0.981334 2.986666 1.493333 2.218667 1.365333 1.621333 1.152 3.072 2.730667 85.333334 85.333333a32 32 0 0 1-41.685334 48.341334l-3.584-3.114667-30.72-30.677333V288a32 32 0 0 1-27.648 31.701333L512 320a32 32 0 0 1-31.701333-27.648l-0.298667-4.352V194.56l-30.72 30.72a32 32 0 0 1-41.685333 3.114667L404.053333 225.28a32 32 0 0 1-3.072-41.642667l3.072-3.584 85.333334-85.333333 4.693333-3.925333 4.053333-2.304 3.712-1.493334 4.352-1.152z" fill="currentColor"></path></svg>`;
    header.appendChild(dragIcon);
    
    // 创建最小化按钮
    const minimizeBtn = document.createElement('button');
    minimizeBtn.className = 'ticker-minimize-btn';
    minimizeBtn.innerHTML = `<svg viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" width="16" height="16"><path d="M449.92 543.36C449.92 520.96 431.36 512 410.24 512L97.92 512c-17.92 0-32 14.08-32 32 0 17.92 14.08 32 32 32l242.56 0-267.52 267.52c-12.16 12.16-12.16 31.36 0 43.52 12.16 12.16 31.36 12.16 43.52 0l269.44-269.44 0 246.4c0 17.92 14.08 32 32 32 17.92 0 32-14.08 32-32l0-320M865.92 384 622.72 384l267.52-267.52c12.16-12.16 12.16-31.36 0-43.52-12.16-12.16-31.36-12.16-43.52 0L577.92 342.4 577.92 96C577.92 78.08 563.2 64 545.92 64c-17.92 0-32 14.08-32 32l0 320c0 0.64 0.64 1.28 0.64 1.92 0 8.32 2.56 16.64 8.96 22.4C531.2 448.64 542.72 451.2 552.96 448l312.32 0c17.92 0 32-14.08 32-32C897.92 398.08 883.2 384 865.92 384z" fill="currentColor"></path></svg>`;
    minimizeBtn.title = '最小化';
    minimizeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      minimizeWindow();
    });
    header.appendChild(minimizeBtn);
    
    // 创建内容区域
    const content = document.createElement('div');
    content.className = 'ticker-content';
    content.id = 'ticker-content';
    
    tickerContainer.appendChild(header);
    tickerContainer.appendChild(content);
    document.body.appendChild(tickerContainer);
    
    // 添加拖拽功能
    setupDrag(header);
    
    // 监听大小变化（使用防抖）
    const resizeObserver = new ResizeObserver(() => {
      debouncedSaveSize();
    });
    resizeObserver.observe(tickerContainer);
    
    // 也监听鼠标释放事件，确保调整大小结束时保存
    let isResizing = false;
    const handleMouseDown = () => {
      isResizing = true;
    };
    const handleMouseUp = () => {
      if (isResizing) {
        isResizing = false;
        setTimeout(() => {
          saveSize();
        }, 100);
      }
    };
    tickerContainer.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mouseup', handleMouseUp);
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

// 最小化浮窗
function minimizeWindow() {
  if (!tickerContainer || isMinimized) return;
  
  const rect = tickerContainer.getBoundingClientRect();
  minimizedPosition = {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height
  };
  
  // 添加最小化动画
  tickerContainer.classList.add('minimizing');
  
  // 动画结束后隐藏并显示金元宝（固定在右下角）
  setTimeout(() => {
    tickerContainer.style.display = 'none';
    tickerContainer.classList.remove('minimizing');
    isMinimized = true;
    showGoldIcon();
    
    // 停止刷新
    if (refreshInterval) {
      clearInterval(refreshInterval);
      refreshInterval = null;
    }
    
    // 保存最小化状态
    saveMinimizedState(true, null, null);
  }, 500);
}

// 展开浮窗
async function expandWindow() {
  if (!tickerContainer || !isMinimized) return;
  
  // 隐藏金元宝
  hideGoldIcon();
  
  // 恢复位置和大小
  if (minimizedPosition) {
    tickerContainer.style.display = 'block';
    tickerContainer.style.left = minimizedPosition.x + 'px';
    tickerContainer.style.top = minimizedPosition.y + 'px';
    tickerContainer.style.width = minimizedPosition.width + 'px';
    tickerContainer.style.height = minimizedPosition.height + 'px';
    
    // 添加展开动画
    tickerContainer.classList.add('expanding');
    
    setTimeout(async () => {
      tickerContainer.classList.remove('expanding');
      isMinimized = false;
      minimizedPosition = null;
      
      // 清除最小化状态
      saveMinimizedState(false, null, null);
      
      // 恢复更新
      await updateTickers();
      startRefresh();
    }, 500);
  }
}

// 显示金元宝图标（固定在右下角）
function showGoldIcon() {
  if (goldIcon) return;
  
  goldIcon = document.createElement('div');
  goldIcon.className = 'ticker-gold-icon';
  goldIcon.innerHTML = `<svg viewBox="0 0 1097 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" width="48" height="48"><path d="M1036.262016 126.16012h-94.636384a22.703173 22.703173 0 1 1 0-45.395483h23.311488a40.355161 40.355161 0 0 0 0-80.710323H753.862789a40.355161 40.355161 0 1 0 0 80.710323h43.266381a22.703173 22.703173 0 0 1 0 45.395483H627.94165a61.265979 61.265979 0 1 0 0 122.531957h408.320366a61.265979 61.265979 0 0 0 0-122.531957z m-643.727285 771.831839h-76.039335a23.354939 23.354939 0 0 1 0-46.709877h23.963253a41.506614 41.506614 0 0 0 0-83.002366H42.178063a41.506614 41.506614 0 1 0 0 83.002366h125.682158a23.354939 23.354939 0 1 1 0 46.709877H102.14051a63.00402 63.00402 0 0 0 0 126.008041h290.394221a63.00402 63.00402 0 1 0 0-126.008041z m0 0" fill="#FFCB27" opacity=".26"></path><path d="M145.059284 214.148493l-11.786097-11.786097 11.807822-11.818685 11.829548 11.818685z m0 9.352838l11.818685 11.807823-11.818685 11.818685-11.786097-11.786097z m28.243181-4.670987l-11.786097 11.84041-11.818685-11.807822 11.818685-11.818685z m-32.990208 0l-11.731784 11.829548-11.818685-11.807823 11.818685-11.818685z m0 0" fill="#FFB000"></path><path d="M1018.588302 378.067574q1.553375 19.129324 1.564238 38.649708c0 260.174016-210.91139 434.36927-471.041955 434.36927S78.057767 676.902161 78.057767 416.717282q0-19.357442 1.531649-38.345551" fill="#FFCB27"></path><path d="M733.897032 302.929848c167.069282-5.844166 284.082956-8.288288 284.082956 63.319041 0 95.91819-209.944604 173.695567-468.880266 173.695567S80.219456 462.167079 80.219456 366.227163c0-71.69423 117.502498-69.152344 285.136644-63.286452" fill="#FFB000"></path><path d="M549.110585 864.827946c-131.754442 0-253.287025-43.711755-342.253047-123.107683C114.925981 659.695546 64.294647 544.267835 64.294647 416.717282c0-13.035315 0.532275-26.320473 1.575101-39.44269a13.76312 13.76312 0 1 1 27.439337 2.172553q-1.477336 18.597049-1.488199 37.259274c0 243.706069 192.27089 420.595288 457.322287 420.595288s457.322287-176.889219 457.322287-420.595288c0-12.579079-0.51055-25.212471-1.509924-37.530843a13.754429 13.754429 0 1 1 27.417611-2.237729c1.086276 13.035315 1.618552 26.450826 1.618552 39.768572 0 127.550553-50.631334 242.978264-142.562891 325.013844-89.009473 79.395929-210.59637 123.107683-342.318223 123.107683z m0 0" fill="#CA3A2A"></path><path d="M549.099722 553.707575c-270.645719 0-482.643385-82.339737-482.643385-187.458686 0-18.227715 6.267814-33.522484 18.6405-45.46066 39.36665-38.019668 132.341031-36.77045 280.737225-31.578049a13.76312 13.76312 0 1 1-0.966786 27.504513c-117.07885-4.095261-227.683495-7.962405-260.706292 23.898077-6.973893 6.745775-10.232722 14.90371-10.232722 25.668707 0 77.234239 182.885464 159.932447 455.149734 159.932447s455.149734-82.698208 455.149735-159.932447c0-10.764997-3.258829-18.933794-10.232722-25.668707-32.95762-31.838756-143.040852-27.982475-259.620016-23.898077h-0.488824a13.765292 13.765292 0 0 1-0.456236-27.526239c147.733565-5.159812 240.306024-6.398167 279.672674 31.621501 12.372686 11.949038 18.6405 27.232945 18.6405 45.460659 0 105.118949-211.997666 187.458686-482.643385 187.458687z m0 0" fill="#CA3A2A"></path><path d="M549.099722 553.707575c-270.645719 0-482.643385-82.339737-482.643385-187.458686 0-18.227715 6.267814-33.522484 18.6405-45.46066 39.36665-38.019668 132.341031-36.77045 280.737225-31.578049a13.76312 13.76312 0 1 1-0.966786 27.504513c-117.07885-4.095261-227.683495-7.962405-260.706292 23.898077-6.973893 6.745775-10.232722 14.90371-10.232722 25.668707 0 77.234239 182.885464 159.932447 455.149734 159.932447s455.149734-82.698208 455.149735-159.932447c0-10.764997-3.258829-18.933794-10.232722-25.668707-32.95762-31.838756-143.040852-27.982475-259.620016-23.898077h-0.488824a13.765292 13.765292 0 0 1-0.456236-27.526239c147.733565-5.159812 240.306024-6.398167 279.672674 31.621501 12.372686 11.949038 18.6405 27.232945 18.6405 45.460659 0 105.118949-211.997666 187.458686-482.643385 187.458687z m0 0" fill="#CA3A2A"></path><path d="M751.853178 486.23896a223.175448 223.175448 0 0 0 21.627759-96.11372c0-123.933253-100.458824-224.381215-224.370352-224.381215s-224.370352 100.415373-224.370353 224.381215a223.153723 223.153723 0 0 0 21.606034 96.146308" fill="#FFB000"></path><path d="M768.201635 452.195063a13.752257 13.752257 0 0 1-13.437237-16.728654 212.030254 212.030254 0 0 0 4.942557-45.341169c0-116.13379-94.506031-210.618095-210.607233-210.618095S338.481627 273.958862 338.481627 390.12524a210.889664 210.889664 0 0 0 4.953419 45.373758 13.764206 13.764206 0 1 1-26.885336 5.920205 239.491317 239.491317 0 0 1-5.594323-51.293963c0-131.309069 106.835266-238.144335 238.144335-238.144335s238.111746 106.802678 238.111746 238.144335a238.817826 238.817826 0 0 1-5.605185 51.293963 13.741394 13.741394 0 0 1-13.426374 10.808448z m0 0M544.971872 122.195211a13.773982 13.773982 0 0 1-13.773982-13.763119V71.118504a13.76312 13.76312 0 1 1 27.526239 0v37.313588a13.752257 13.752257 0 0 1-13.752257 13.763119z m190.847869 79.059183a13.76312 13.76312 0 0 1-9.776486-23.507017l26.407374-26.374786a13.795708 13.795708 0 1 1 19.552972 19.466069l-26.363923 26.374787a13.741394 13.741394 0 0 1-9.776486 4.040947z m-381.717462 0a13.719669 13.719669 0 0 1-9.776486-4.040947l-26.363924-26.374787a13.788104 13.788104 0 0 1 19.531246-19.466069l26.374787 26.374786a13.773982 13.773982 0 0 1-9.776486 23.507017z m0 0M656.923499 146.506073a13.76312 13.76312 0 0 1-12.503039-19.476932l15.479436-33.946132a13.76312 13.76312 0 1 1 25.038667 11.416763l-15.479436 33.946132a13.773982 13.773982 0 0 1-12.535628 8.060169z m-206.392481-7.223737a13.752257 13.752257 0 0 1-12.894099-8.950916l-13.035314-34.934643a13.773982 13.773982 0 0 1 25.777334-9.646133l13.035315 34.934644a13.795708 13.795708 0 0 1-12.948412 18.597048z m0 0" fill="#CA3A2A"></path><path d="M680.387065 469.271325a112.462177 112.462177 0 1 0 56.225657-97.395525A112.473039 112.473039 0 0 0 680.387065 469.271325z m0 0" fill="#FF664D"></path><path d="M792.838379 595.485759a126.225296 126.225296 0 1 1 126.225296-126.225297 126.366512 126.366512 0 0 1-126.225296 126.225297z m0-224.859177A98.688194 98.688194 0 1 0 891.493985 469.271325a98.851136 98.851136 0 0 0-98.655606-98.699057z m0 0" fill="#CA3A2A"></path><path d="M806.384244 515.047005l-59.267231-32.284129 32.284129-59.267231 59.256368 32.273267z m0 0" fill="#FFFFFF"></path><path d="M806.362518 528.788399a13.68708 13.68708 0 0 1-6.517657-1.683728l-59.34327-32.262404a13.76312 13.76312 0 0 1-5.431381-18.673088l32.294992-59.26723a13.76312 13.76312 0 0 1 18.662225-5.507421l59.256368 32.273267a13.76312 13.76312 0 0 1 5.50742 18.673088l-32.32758 59.223779a13.76312 13.76312 0 0 1-12.101117 7.180286z m-40.583279-51.532944l35.097584 19.107599 19.118462-35.108447-35.086722-19.107599z m0 0" fill="#CA3A2A"></path><path d="M676.302667 372.636193a135.849704 135.849704 0 1 1-192.097086 4.214752 135.882292 135.882292 0 0 1 192.097086-4.214752z m0 0" fill="#FF664D"></path><path d="M582.350637 620.415798a149.623686 149.623686 0 1 1 103.467809-257.719032c59.593113 57.051227 61.667901 151.95918 4.649263 211.552293a148.363606 148.363606 0 0 1-108.117072 46.166739z m0-271.721133a122.108309 122.108309 0 1 0 84.392799 33.891818 121.054621 121.054621 0 0 0-84.392799-33.891818z m0 0" fill="#CA3A2A"></path><path d="M639.999316 469.521169l-56.366873 58.897896-58.908759-56.377736 56.377735-58.897896z m0 0" fill="#FFFFFF"></path><path d="M583.578129 542.20391a13.795708 13.795708 0 0 1-9.51578-3.812829l-58.897896-56.377736a13.76312 13.76312 0 0 1-0.434511-19.455207l56.377736-58.908759a13.752257 13.752257 0 0 1 9.63527-4.236477 13.915198 13.915198 0 0 1 9.776486 3.812829l58.897896 56.377736a13.784845 13.784845 0 0 1 0.423648 19.46607l-56.377735 58.897896a13.708806 13.708806 0 0 1-9.63527 4.236477z m-39.442689-70.607954l39.019041 37.335314 37.346177-39.008179-39.019042-37.346176z m0 0" fill="#CA3A2A"></path><path d="M714.235432 902.16326l-9.037818-9.016093 9.026955-9.048681 9.037819 9.037818z m0 7.15856l9.026956 9.016093-9.026956 9.04868-9.026955-9.026955z m21.638622-3.573849l-9.059543 9.048681-9.026956-9.037818 9.037819-9.026955z m-25.201608 0l-9.048681 9.048681-9.026955-9.026955 9.026955-9.037818z m0 0" fill="#FFB000"></path></svg>`;
  
  document.body.appendChild(goldIcon);
  
  // 添加出现动画
  setTimeout(() => {
    goldIcon.classList.add('show');
  }, 50);
  
  // 点击金元宝恢复浮窗
  goldIcon.addEventListener('click', () => {
    expandWindow();
  });
}


// 隐藏金元宝图标
function hideGoldIcon() {
  if (goldIcon) {
    goldIcon.classList.remove('show');
    setTimeout(() => {
      if (goldIcon && goldIcon.parentNode) {
        goldIcon.parentNode.removeChild(goldIcon);
      }
      goldIcon = null;
    }, 300);
  }
}

// 保存最小化状态
function saveMinimizedState(minimized, x, y) {
  try {
    if (!chrome.runtime?.id) return;
    
    chrome.storage.local.set({ 
      tickerMinimized: { 
        minimized, 
        x, 
        y,
        position: minimizedPosition 
      } 
    }, () => {
      // 静默处理所有错误
    });
  } catch (error) {
    // 静默处理所有错误
  }
}

// 加载最小化状态
async function loadMinimizedState() {
  try {
    if (!chrome.runtime?.id) return;
    
    const result = await chrome.storage.local.get(['tickerMinimized']);
    if (chrome.runtime.lastError) return;
    
    if (result.tickerMinimized && result.tickerMinimized.minimized) {
      const state = result.tickerMinimized;
      isMinimized = true;
      minimizedPosition = state.position;
      
      if (tickerContainer) {
        tickerContainer.style.display = 'none';
      }
      
      // 显示在右下角
      showGoldIcon();
    }
  } catch (error) {
    // 静默处理所有错误
  }
}

// 保存位置和大小
function savePosition(x, y) {
  try {
    if (!chrome.runtime?.id || !tickerContainer) {
      return;
    }
    
    const width = tickerContainer.offsetWidth;
    const height = tickerContainer.offsetHeight;
    
    chrome.storage.local.set({ tickerPosition: { x, y, width, height } }, () => {
      // 静默处理所有错误
    });
  } catch (error) {
    // 静默处理所有错误
  }
}

// 防抖保存大小
let saveSizeTimeout = null;
function debouncedSaveSize() {
  if (saveSizeTimeout) {
    clearTimeout(saveSizeTimeout);
  }
  saveSizeTimeout = setTimeout(() => {
    saveSize();
  }, 300);
}

// 保存大小（当调整大小时调用）
function saveSize() {
  try {
    if (!chrome.runtime?.id || !tickerContainer) {
      return;
    }
    
    const rect = tickerContainer.getBoundingClientRect();
    const x = rect.left;
    const y = rect.top;
    const width = tickerContainer.offsetWidth;
    const height = tickerContainer.offsetHeight;
    
    chrome.storage.local.set({ tickerPosition: { x, y, width, height } }, () => {
      // 静默处理所有错误
    });
  } catch (error) {
    // 静默处理所有错误
  }
}

// 加载位置和大小
async function loadPosition() {
  try {
    if (!chrome.runtime?.id || !tickerContainer) {
      return;
    }
    
    const result = await chrome.storage.local.get(['tickerPosition']);
    if (chrome.runtime.lastError) {
      // 静默处理所有错误
      return;
    }
    
    if (result.tickerPosition && tickerContainer) {
      const pos = result.tickerPosition;
      if (pos.x !== undefined && pos.y !== undefined) {
        tickerContainer.style.left = pos.x + 'px';
        tickerContainer.style.top = pos.y + 'px';
      }
      if (pos.width !== undefined && pos.width >= 200) {
        tickerContainer.style.width = pos.width + 'px';
      }
      if (pos.height !== undefined && pos.height >= 200) {
        tickerContainer.style.height = pos.height + 'px';
      }
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
              <button class="ticker-order-btn ticker-order-up" data-index="${index}" ${index === 0 ? 'disabled' : ''} title="上移">▲</button>
              <button class="ticker-order-btn ticker-order-down" data-index="${index}" ${index === tickers.length - 1 ? 'disabled' : ''} title="下移">▼</button>
            </div>
            <div style="flex: 1; min-width: 0;">
              <div class="ticker-symbol ticker-symbol-clickable" data-symbol="${symbol}" title="点击复制代码: ${symbol}">${symbol}</div>
              <div class="ticker-error-text">获取失败</div>
            </div>
            <button class="ticker-copy-item-btn" data-symbol="${symbol}" data-index="${index}" title="复制股票代码">Ask AI</button>
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
            <button class="ticker-order-btn ticker-order-up" data-index="${index}" ${index === 0 ? 'disabled' : ''} title="上移">▲</button>
            <button class="ticker-order-btn ticker-order-down" data-index="${index}" ${index === tickers.length - 1 ? 'disabled' : ''} title="下移">▼</button>
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
          <button class="ticker-copy-item-btn" data-symbol="${symbol}" data-index="${index}" title="复制该股票所有信息">Ask AI</button>
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
          btn.innerHTML = '已复制';
        btn.style.background = 'linear-gradient(135deg, #D4AF37 0%, #B8860B 50%, #8B6914 100%)';
        btn.style.color = 'white';
        btn.style.boxShadow = '0 2px 8px rgba(212, 175, 55, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.2)';
        setTimeout(() => {
          btn.innerHTML = originalHTML;
          btn.style.background = '';
          btn.style.color = '';
          btn.style.boxShadow = '';
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
      element.textContent = '已复制';
      element.style.background = 'linear-gradient(135deg, #D4AF37 0%, #B8860B 50%, #8B6914 100%)';
      element.style.boxShadow = '0 2px 8px rgba(212, 175, 55, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.2)';
      element.style.color = 'white';
      setTimeout(() => {
        element.textContent = '复制';
        element.style.background = '';
        element.style.color = '';
        element.style.boxShadow = '';
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

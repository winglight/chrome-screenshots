let tasks = {};

function initializeTaskManager() {
  const addTaskBtn = document.getElementById('add-task-btn');
  const modal = document.getElementById('task-modal');
  const form = document.getElementById('task-form');
  const cancelBtn = document.querySelector('.cancel-btn');
  
  const closeBtn = document.getElementById('close-sidebar-btn');
  const sidebar = document.getElementById('screenshot-task-sidebar');
  closeBtn.addEventListener('click', () => {
    // stopAllTasks();
    sidebar.style.display = 'none';
    // Set state in storage
    chrome.storage.local.set({ sidebarVisible: false });
  });

  // Load existing tasks
  chrome.storage.local.get(['tasks'], function(result) {
    tasks = result.tasks || {};
    renderTasks();
  });

  addTaskBtn.addEventListener('click', () => {
    modal.style.display = 'flex';  // 改为flex而不是block
    form.reset(); // 重置表单
  });

  // 点击modal背景时关闭
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.style.display = 'none';
    }
  });

  cancelBtn.addEventListener('click', () => {
    modal.style.display = 'none';
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const editingTaskId = form.dataset.editTaskId;
    
    const taskData = {
      id: editingTaskId ? parseInt(editingTaskId) : Date.now(),
      screenshotArea: formData.get('screenshotArea'),
      selector: formData.get('selector'),
      interval: parseInt(formData.get('interval')),
      apiUrl: formData.get('apiUrl'),
      apiToken: formData.get('apiToken'),
      active: editingTaskId ? tasks[editingTaskId]?.active : false,
      intervalId: editingTaskId ? tasks[editingTaskId]?.intervalId : null
    };

    tasks[taskData.id] = taskData;
    chrome.storage.local.set({ tasks });
    modal.style.display = 'none';
    form.dataset.editTaskId = ''; // Clear the editing state
    renderTasks();
  });

  // Handle screenshot area selector change
  const screenshotAreaSelect = form.querySelector('[name="screenshotArea"]');
  const selectorInput = form.querySelector('[name="selector"]');
  
  screenshotAreaSelect.addEventListener('change', (e) => {
    selectorInput.style.display = e.target.value === 'selector' ? 'block' : 'none';
  });
}

function renderTasks() {
  const taskList = document.getElementById('task-list');
  taskList.innerHTML = '';

  Object.values(tasks).forEach(task => {
    const taskElement = document.createElement('div');
    taskElement.className = 'task-item';
    
    // 创建任务信息元素
    const infoDiv = document.createElement('div');
    infoDiv.innerHTML = `
      <div>Screenshot: ${task.screenshotArea === 'full' ? 'Full Page' : `Selector: ${task.selector}`}</div>
      <div>Interval: ${task.interval/1000/60} minutes</div>
      <div>API Endpoint: ${task.apiUrl}</div>
    `;
    taskElement.appendChild(infoDiv);

    // 创建控制按钮容器
    const controlsDiv = document.createElement('div');
    controlsDiv.className = 'task-controls';

    // 创建启动/停止按钮
    const toggleBtn = document.createElement('button');
    toggleBtn.textContent = task.active ? 'Stop' : 'Start';
    toggleBtn.addEventListener('click', () => toggleTask(task.id));

    // 创建编辑按钮
    const editBtn = document.createElement('button');
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => editTask(task.id));

    // 创建删除按钮
    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => deleteTask(task.id));

    // 添加按钮到控制容器
    controlsDiv.appendChild(toggleBtn);
    controlsDiv.appendChild(editBtn);
    controlsDiv.appendChild(deleteBtn);

    // 添加控制容器到任务元素
    taskElement.appendChild(controlsDiv);
    
    taskList.appendChild(taskElement);
  });
}

// 修改 toggleTask 函数以接受任务ID参数
function toggleTask(taskId) {
  const task = tasks[taskId];
  if (!task) return;

  task.active = !task.active;
  
  if (task.active) {
    console.log(`Activating task ${taskId}`);
    chrome.runtime.sendMessage({
      type: 'startTask',
      task: task
    }, response => {
      if (!response || !response.success) {
        console.error('Failed to start task:', response ? response.error : 'Unknown error');
        task.active = false;
        renderTasks();
      } else {
        console.log(`Task ${taskId} started successfully`);
      }
    });
  } else {
    console.log(`Deactivating task ${taskId}`);
    chrome.runtime.sendMessage({
      type: 'stopTask',
      taskId: taskId
    }, response => {
      if (!response || !response.success) {
        console.error('Failed to stop task:', response ? response.error : 'Unknown error');
      } else {
        console.log(`Task ${taskId} stopped successfully`);
      }
    });
  }
  
  chrome.storage.local.set({ tasks });
  renderTasks();
}

// Add message listener for task execution
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'executeTask') {
    captureAndSend(request.task);
    return;
  }
  if (request.type === 'toggleSidebar') {
    // 打开或关闭设置面板
    injectSidebar();
    const sidebar = document.getElementById('screenshot-task-sidebar');
    if (sidebar) {
      const visible = sidebar.style.display !== 'none';
      sidebar.style.display = visible ? 'none' : 'block';
      chrome.storage.local.set({ sidebarVisible: !visible });
      sendResponse && sendResponse({ success: true, visible: !visible });
    } else {
      sendResponse && sendResponse({ success: false });
    }
    return true;
  }
  if (request.type === 'composeInChatGPT') {
    (async () => {
      try {
        activeComposePlatform = 'chatgpt';
        if (!/chat\.openai\.com$|chatgpt\.com$/i.test(location.hostname)) {
          sendResponse({ success: false, error: 'Not ChatGPT domain' });
          return;
        }
        // 确保已加载设置
        if (!settings || typeof settings !== 'object') {
          await new Promise(resolve => loadSettings(resolve));
        }
        if (request.imageDataUrl) {
          await attachImageToAssistant(request.imageDataUrl, 'chatgpt');
          // 等待上传完成（以发送按钮可点击作为完成信号）
          await waitForSendButtonEnabled(settings.sendButtonWaitTimeoutMs || 60000);
        }
        if (typeof request.text === 'string') {
          await fillTextAndSend(request.text);
        }
        // 如果设置开启，则自动发送并等待回复（仅保留首次发送与等待）
        if (request.imageDataUrl && settings.autoSendAfterUpload) {
          const sent = await clickSendButtonWhenEnabled(settings.sendButtonWaitTimeoutMs || 60000);
          if (!sent) throw new Error('发送按钮不可用');
          const replyText = await waitForAssistantResponseDone(
            settings.replyWaitTimeoutMs || 120000,
            settings.replyStableCycles || 6,
            settings.replyPollIntervalMs || 500
          );
          // 根据你的要求：不再进行二次提示与 JSON 提取，也不再上报 ibbot
        }
        sendResponse({ success: true });
      } catch (e) {
        console.error('composeInChatGPT error:', e);
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }
  if (request.type === 'composeInGoogleAI') {
    (async () => {
      try {
        activeComposePlatform = 'google';
        const hostOk = /aistudio\.google\.com$/i.test(location.hostname);
        const pathOk = /^\/prompts/i.test(location.pathname || '');
        if (!hostOk || !pathOk) {
          sendResponse({ success: false, error: 'Not Google AI Studio domain' });
          return;
        }
        if (!settings || typeof settings !== 'object') {
          await new Promise(resolve => loadSettings(resolve));
        }
        if (request.imageDataUrl) {
          await attachImageToAssistant(request.imageDataUrl, 'google');
          await waitForSendButtonEnabled(settings.sendButtonWaitTimeoutMs || 60000);
        }
        if (typeof request.text === 'string') {
          await fillTextAndSend(request.text);
        }
        if (request.imageDataUrl && settings.autoSendAfterUpload) {
          const sent = await clickSendButtonWhenEnabled(settings.sendButtonWaitTimeoutMs || 60000);
          if (!sent) throw new Error('发送按钮不可用');
          const replyText = await waitForAssistantResponseDone(
            settings.replyWaitTimeoutMs || 120000,
            settings.replyStableCycles || 6,
            settings.replyPollIntervalMs || 500
          );
        }
        sendResponse({ success: true });
      } catch (e) {
        console.error('composeInGoogleAI error:', e);
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }
});

async function captureElement(element) {
  // Get device pixel ratio for scaling
  const pixelRatio = window.devicePixelRatio;
  
  // Get scroll position
  const scrollLeft = window.scrollX || document.documentElement.scrollLeft;
  const scrollTop = window.scrollY || document.documentElement.scrollTop;
  
  // Get element dimensions
  const rect = element.getBoundingClientRect();
  
  // Calculate actual dimensions accounting for DPI and scroll
  const dpr = window.devicePixelRatio || 1;
  let dimensions;
  if (element === document.documentElement) {
    dimensions = {
      x: 0,
      y: 0,
      width: Math.round(window.innerWidth * dpr),
      height: Math.round(window.innerHeight * dpr)
    };
  } else {
    dimensions = {
      x: Math.round((rect.left) * dpr),
      y: Math.round((rect.top) * dpr),
      width: Math.round(rect.width * dpr),
      height: Math.round(rect.height * dpr)
    };
  }

  console.log('截图区域:', dimensions);

  const response = await sendMessageSafe({
    type: 'captureScreenshot',
    data: dimensions
  });

  if (response.error) {
    console.error('截图失败:', response.error);
    throw new Error(response.error);
  }

  // Convert array back to Blob
  return new Blob([new Uint8Array(response.data)], {
      type: response.type
  });
}

async function captureAndSend(task) {
  console.log(`开始执行任务 ${task.id}...`);
  let element = task.screenshotArea === 'full' ? document.documentElement : 
                document.querySelector(task.selector);
  
  if (!element) {
    console.error('找不到指定的元素:', task.selector);
    return;
  }

  try {
    console.log('开始捕获截图...');
    const screenshot = await captureElement(element);
    console.log('截图捕获成功，准备发送...');
    
    // 将截图发送到后台脚本处理，而不是直接从内容脚本发送
    chrome.runtime.sendMessage({
      type: 'sendScreenshot',
      screenshot: await blobToBase64(screenshot),
      apiUrl: task.apiUrl,
      apiToken: task.apiToken
    }, response => {
      if (response && response.success) {
        console.log(`任务 ${task.id} 截图发送成功`);
      } else {
        console.error(`任务 ${task.id} 截图发送失败:`, response ? response.error : '未知错误');
      }
    });
  } catch (error) {
    console.error(`任务 ${task.id} 截图捕获/发送失败:`, error);
  }
}

// 辅助函数：将 Blob 转换为 Base64
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// 新增：全局设置与快捷键（顶层）
const AI_PLATFORM_META = {
  chatgpt: {
    key: 'chatgpt',
    label: 'ChatGPT',
    listMessageType: 'listChatGPTTabs',
    sendMessageType: 'sendToChatGPT',
  },
  google: {
    key: 'google',
    label: 'Google AI Studio',
    listMessageType: 'listGoogleAITabs',
    sendMessageType: 'sendToGoogleAI',
  },
};

let activeComposePlatform = 'chatgpt';

let settings = {
  screenshotArea: 'full',
  selector: '',
  hotkey: 'Ctrl+Shift+S',
  quickHotkey: 'Ctrl+Shift+Q',
  texts: [''],
  targetPlatform: 'chatgpt',
  targetChatGPTTabId: null,
  targetGoogleAITabId: null,
  lastUsedText: '',
};
let hotkeyListenerAttached = false;
const currentHotkeys = { capture: null, quickSend: null };

function normalizePlatform(value) {
  return value === 'google' ? 'google' : 'chatgpt';
}

function getPlatformMeta(value) {
  return AI_PLATFORM_META[normalizePlatform(value)] || AI_PLATFORM_META.chatgpt;
}

function getPlatformLabel(value) {
  return getPlatformMeta(value).label;
}

function getPlatformTabIdFrom(container, platform) {
  const normalized = normalizePlatform(platform);
  const source = container || {};
  if (normalized === 'google') {
    return source.targetGoogleAITabId != null ? source.targetGoogleAITabId : null;
  }
  return source.targetChatGPTTabId != null ? source.targetChatGPTTabId : null;
}

function setPlatformTabIdFor(container, platform, val) {
  if (!container) return;
  const normalized = normalizePlatform(platform);
  let parsed = null;
  if (val !== '' && val !== null && val !== undefined) {
    const num = Number(val);
    parsed = Number.isFinite(num) ? num : null;
  }
  if (normalized === 'google') {
    container.targetGoogleAITabId = parsed;
  } else {
    container.targetChatGPTTabId = parsed;
  }
}

function getCurrentTargetConfig() {
  const platform = normalizePlatform(settings.targetPlatform);
  const tabId = getPlatformTabIdFrom(settings, platform);
  const meta = getPlatformMeta(platform);
  return { platform, tabId, meta };
}

// 等待工具：轮询直到 predicate 返回非空或超时
async function waitFor(predicate, timeout = 4000, interval = 150) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      last = await predicate();
      if (last) return last;
    } catch {}
    await new Promise(r => setTimeout(r, interval));
  }
  return last || null;
}

function isVisible(el) {
  if (!el) return false;
  const style = window.getComputedStyle(el);
  if (style.visibility === 'hidden' || style.display === 'none') return false;
  const rects = el.getClientRects();
  return rects && rects.length > 0;
}

function isTradingViewChartUrl() {
  try {
    return /tradingview\.com$/i.test(location.hostname) && location.pathname.startsWith('/chart');
  } catch { return false; }
}

function normalizeHotkey(str) {
  return String(str || '').replace(/\s+/g, '').toLowerCase();
}

function eventToHotkey(e) {
  const parts = [];
  if (e.ctrlKey) parts.push('ctrl');
  if (e.metaKey) parts.push('meta');
  if (e.shiftKey) parts.push('shift');
  if (e.altKey) parts.push('alt');
  const key = e.key && e.key.length === 1 ? e.key.toUpperCase() : (e.key || '').toUpperCase();
  if (key && !['CONTROL','META','SHIFT','ALT'].includes(key)) parts.push(key);
  return normalizeHotkey(parts.join('+'));
}

function applyHotkeyListener() {
  currentHotkeys.capture = normalizeHotkey(settings.hotkey);
  currentHotkeys.quickSend = normalizeHotkey(settings.quickHotkey);
  if (hotkeyListenerAttached) return;
  window.addEventListener('keydown', async (e) => {
    try {
      if (!isTradingViewChartUrl()) return;
      const pressed = eventToHotkey(e);
      if (pressed && currentHotkeys.capture && pressed === currentHotkeys.capture) {
        e.preventDefault();
        e.stopPropagation();
        console.debug('[chrome-screenshots] Hotkey matched, starting capture flow');
        await startCaptureFlow();
      } else if (pressed && currentHotkeys.quickSend && pressed === currentHotkeys.quickSend) {
        e.preventDefault();
        e.stopPropagation();
        console.debug('[chrome-screenshots] Quick send hotkey matched, sending with last text');
        await startQuickSendFlow();
      }
    } catch {}
  }, true);
  hotkeyListenerAttached = true;
}

function loadSettings(callback) {
  chrome.storage.local.get(['settings'], (res) => {
    const defaults = {
      screenshotArea: 'full',
      selector: '',
      hotkey: 'Ctrl+Shift+S',
      quickHotkey: 'Ctrl+Shift+Q',
      texts: [''],
      targetPlatform: 'chatgpt',
      targetChatGPTTabId: null,
      targetGoogleAITabId: null,
      lastUsedText: '',
    };
    settings = Object.assign({}, defaults, res.settings || {});
    applyHotkeyListener();
    if (typeof callback === 'function') callback(settings);
  });
}

function saveSettings(newSettings, callback) {
  settings = Object.assign({}, settings, newSettings || {});
  chrome.storage.local.set({ settings }, () => {
    applyHotkeyListener();
    if (typeof callback === 'function') callback();
  });
}

function beginScreenshotCapture(element) {
  return (async () => {
    try {
      const screenshotBlob = await captureElement(element);
      return await blobToBase64(screenshotBlob);
    } catch (e) {
      console.error('截图失败（将仅发送文本）:', e);
      return null;
    }
  })();
}

async function sendToActiveAssistant(imageDataUrl, text) {
  const { meta, tabId } = getCurrentTargetConfig();
  let resp = null;
  try {
    resp = await sendMessageSafe({
      type: meta.sendMessageType,
      imageDataUrl: imageDataUrl || null,
      text: text != null ? String(text) : '',
      targetTabId: tabId != null ? tabId : null,
    });
  } catch (e) {
    console.error(`发送到 ${meta.label} 失败:`, e);
    return null;
  }
  if (resp && !resp.success) {
    console.error(`发送到 ${meta.label} 失败:`, resp?.error);
  }
  return resp;
}

async function startCaptureFlow() {
  try {
    const element = settings.screenshotArea === 'full' ? document.documentElement : document.querySelector(settings.selector);
    if (!element) {
      console.error('未找到选择的元素用于截图:', settings.selector);
      return;
    }

    // 先触发截图，让后台尽快完成可见区域快照；随后稍作延迟再显示对话框，避免弹框被截入
    const capturePromise = beginScreenshotCapture(element);

    // 给截图一个微小的时间窗口，尽量在对话框出现前完成屏幕快照
    await new Promise(r => setTimeout(r, 160));

    // 弹框与编码可并行进行（截图快照已在之前触发）
    const chosenText = await showTextSelectionModal(settings.texts || []);
    if (chosenText == null) return; // 用户取消

    // 追加保存新输入的文本（去重）
    const trimmed = String(chosenText || '').trim();
    const dataUrl = await capturePromise; // 若截图失败则为 null

    await sendToActiveAssistant(dataUrl || null, trimmed);

    const existingTexts = Array.isArray(settings.texts) ? settings.texts.slice() : [];
    const updates = { lastUsedText: trimmed };
    if (trimmed && !existingTexts.includes(trimmed)) {
      updates.texts = existingTexts.concat(trimmed);
    }
    saveSettings(updates);
  } catch (err) {
    console.error('自动截图流程失败:', err);
  }
}

async function startQuickSendFlow() {
  try {
    const element = settings.screenshotArea === 'full' ? document.documentElement : document.querySelector(settings.selector);
    if (!element) {
      console.error('未找到选择的元素用于截图:', settings.selector);
      return;
    }

    const capturePromise = beginScreenshotCapture(element);
    await new Promise(r => setTimeout(r, 160));

    let candidate = typeof settings.lastUsedText === 'string' ? settings.lastUsedText : '';
    if (!candidate) {
      const arr = Array.isArray(settings.texts) ? settings.texts : [];
      if (arr.length) {
        candidate = arr[arr.length - 1] || '';
      }
    }
    const textToSend = String(candidate || '').trim();

    const dataUrl = await capturePromise;

    await sendToActiveAssistant(dataUrl || null, textToSend);

    const existingTexts = Array.isArray(settings.texts) ? settings.texts.slice() : [];
    const updates = { lastUsedText: textToSend };
    if (textToSend && !existingTexts.includes(textToSend)) {
      updates.texts = existingTexts.concat(textToSend);
    }
    saveSettings(updates);
  } catch (err) {
    console.error('快速发送流程失败:', err);
  }
}

async function attachImageToAssistant(dataUrl, platform = 'chatgpt') {
  const normalized = normalizePlatform(platform);
  const resp = await fetch(dataUrl);
  const blob = await resp.blob();
  const file = new File([blob], 'screenshot.png', { type: blob.type || 'image/png' });
  const dt = new DataTransfer();
  dt.items.add(file);

  const findFileInput = () => {
    const selectors = [
      'input[type="file"][accept*="image" i]',
      'input[type="file"][accept*="png" i]',
      'input[type="file"][accept*="jpg" i]',
      'input[type="file"]'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  };

  let input = findFileInput();
  if (!input) {
    // 尝试点击“添加附件/上传”按钮以触发文件输入出现
    const attachSelectors = [
      'button[aria-label*="attach" i]',
      'button[aria-label*="upload" i]',
      'button[aria-label*="image" i]',
      'button[aria-label*="photo" i]',
      'button[aria-label*="上传" i]',
      'button[aria-label*="添加附件" i]',
      'button[aria-label*="图片" i]',
      'button[data-testid*="attach" i]',
    ];
    if (normalized === 'google') {
      attachSelectors.push(
        'button[aria-label*="add image" i]',
        'button[aria-label*="add file" i]',
        'button[aria-label*="insert" i]',
        'button[data-tooltip*="upload" i]'
      );
    }
    for (const sel of attachSelectors) {
      const attachBtn = document.querySelector(sel);
      if (attachBtn) {
        attachBtn.click();
        input = await waitFor(() => findFileInput(), 2500, 150);
        if (input) break;
      }
    }
  }
  if (!input) throw new Error('未找到图片上传控件');

  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

async function fillTextAndSend(text) {
  function findTargetsAll() {
    const textareas = Array.from(document.querySelectorAll('textarea[data-testid="prompt-textarea"], form textarea'));
    const editables = Array.from(document.querySelectorAll('div[contenteditable="true"][role="textbox"], div[contenteditable="true"][data-lexical-editor], [contenteditable="true"]'));
    const visTextarea = textareas.find(isVisible) || null;
    const visEditable = editables.find(isVisible) || null;
    return { textarea: visTextarea, editable: visEditable };
  }

  // 等待输入区域可用
  let { textarea, editable } = findTargetsAll();
  if (!textarea && !editable) {
    const res = await waitFor(() => {
      const t = findTargetsAll();
      return (t.textarea || t.editable) ? t : null;
    }, 6000, 150);
    if (res) { textarea = res.textarea; editable = res.editable; }
  }
  if (!textarea && !editable) {
    throw new Error('未找到对话输入框');
  }

  // 文本插入逻辑（带校验与多策略）
  const want = String(text || '');
  let ok = false;

  if (textarea) {
    textarea.focus();
    try {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      if (setter) setter.call(textarea, want); else textarea.value = want;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      ok = (textarea.value || '') === want;
      if (!ok) {
        // 退化方案：使用 setRangeText
        try {
          textarea.value = '';
          textarea.setRangeText(want);
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
          ok = (textarea.value || '') === want;
        } catch {}
      }
    } catch {}
  }

  if (!ok && editable) {
    editable.focus();
    try {
      // 优先用 selection + execCommand 插入
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editable);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('insertText', false, want);
      editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
      ok = (editable.innerText || '').includes(want);
    } catch {}

    if (!ok) {
      try {
        // 尝试 beforeinput
        const ev = new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: want });
        editable.dispatchEvent(ev);
        editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
        ok = (editable.innerText || '').includes(want);
      } catch {}
    }

    if (!ok) {
      try {
        editable.innerHTML = '';
        editable.appendChild(document.createTextNode(want));
        editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
        ok = (editable.innerText || '').includes(want);
      } catch {}
    }
  }

  if (!ok) {
    throw new Error('写入文本失败');
  }

  // 等待 UI 处理输入
  await new Promise(r => setTimeout(r, 250));

  // 取消任何自动发送逻辑，仅填入文本
  const target = textarea || editable;
  console.debug('[chrome-screenshots] text filled');
  try {
    target?.focus();
    if (textarea) {
      const len = (textarea.value || '').length;
      textarea.selectionStart = textarea.selectionEnd = len;
    }
  } catch {}
  return;
}

function showTextSelectionModal(texts) {
  return new Promise((resolve) => {
    const id = 'text-select-modal';
    let modal = document.getElementById(id);
    if (!modal) {
      modal = document.createElement('div');
      modal.id = id;
      modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:2147483647;display:flex;align-items:center;justify-content:center';
      modal.innerHTML = `
        <div style="background:#fff;padding:20px;border-radius:8px;width:360px;max-width:90%">
          <h3 style="margin-top:0;margin-bottom:12px">选择或输入文本</h3>
          <input id="text-select-modal-input" list="text-select-modal-datalist" placeholder="选择或输入..." style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;margin-bottom:12px" />
          <datalist id="text-select-modal-datalist"></datalist>
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button id="text-select-cancel" style="padding:6px 12px">取消</button>
            <button id="text-select-ok" style="padding:6px 12px;background:#4a90e2;color:#fff;border:none;border-radius:4px">确定</button>
          </div>
        </div>`;
      document.body.appendChild(modal);
    }
    const input = modal.querySelector('#text-select-modal-input');
    const datalist = modal.querySelector('#text-select-modal-datalist');
    datalist.innerHTML = '';
    (texts && texts.length ? texts : ['']).forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t;
      datalist.appendChild(opt);
    });
    input.value = '';
    modal.style.display = 'flex';
    console.debug('[chrome-screenshots] Text selection modal displayed');
    setTimeout(() => input.focus(), 0);
    const cleanup = () => { modal.style.display = 'none'; };
    input.onkeydown = (e) => {
      if (e.key === 'Enter') { const val = input.value; cleanup(); resolve(val); }
      if (e.key === 'Escape') { cleanup(); resolve(null); }
    };
    modal.querySelector('#text-select-cancel').onclick = () => { cleanup(); resolve(null); };
    modal.querySelector('#text-select-ok').onclick = () => { const val = input.value; cleanup(); resolve(val); };
  });
}

// 初始化设置（不显示侧边栏，仅绑定热键）
loadSettings();

function injectSidebar() {
  if (!document.getElementById('screenshot-task-sidebar')) {
    const sidebarHTML = `
      <div id="screenshot-task-sidebar" style="display: block;">
        <div class="sidebar-header">
          <h2>截图设置</h2>
          <div>
            <button id="refresh-ai-tabs-btn">刷新 ChatGPT 标签</button>
            <button id="close-sidebar-btn">关闭</button>
          </div>
        </div>
        <div class="form-group">
          <label>目标 AI 平台</label>
          <div class="ai-platform-toggle">
            <button class="ai-platform-btn active" data-platform="chatgpt">ChatGPT</button>
            <button class="ai-platform-btn" data-platform="google">Google AI Studio</button>
          </div>
        </div>
        <div class="form-group">
          <label>截图区域</label>
          <select id="cfg-screenshot-area">
            <option value="full">整页</option>
            <option value="selector">CSS 选择器</option>
          </select>
          <input type="text" id="cfg-selector" placeholder="输入 CSS 选择器，如 #chart-container" style="display:none;margin-top:8px" />
        </div>
        <div class="form-group">
          <label>快捷键</label>
          <input type="text" id="cfg-hotkey" placeholder="Ctrl+Shift+S" />
          <div style="font-size:12px;color:#666;margin-top:6px">在输入框中按下你想要的组合键；示例：Ctrl+Shift+S</div>
        </div>
        <div class="form-group">
          <label>快速发送快捷键</label>
          <input type="text" id="cfg-quick-hotkey" placeholder="Ctrl+Shift+Q" />
          <div style="font-size:12px;color:#666;margin-top:6px">按下后会使用最近一次发送的文本直接发送</div>
        </div>
        <div class="form-group">
          <label>预设文本</label>
          <div id="cfg-texts-container" style="display:flex;flex-direction:column;gap:8px"></div>
          <button id="cfg-add-text" style="margin-top:8px">新增一条文本</button>
        </div>
        <div class="form-group">
          <label id="cfg-tabs-label">ChatGPT 标签页</label>
          <select id="ai-tabs-select"></select>
        </div>
        <div class="form-group">
          <label><input type="checkbox" id="cfg-auto-send-after-upload" /> 图片上传完成后自动发送消息</label>
        </div>
        <div class="form-group">
          <label>等待回复完成参数</label>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <div>
              <div style="font-size:12px;color:#666;margin-bottom:4px">超时(ms)</div>
              <input type="number" id="cfg-reply-timeout-ms" placeholder="120000" />
            </div>
            <div>
              <div style="font-size:12px;color:#666;margin-bottom:4px">稳定周期次数</div>
              <input type="number" id="cfg-reply-stable-cycles" placeholder="6" />
            </div>
            <div>
              <div style="font-size:12px;color:#666;margin-bottom:4px">轮询间隔(ms)</div>
              <input type="number" id="cfg-reply-poll-interval-ms" placeholder="500" />
            </div>
            <div>
              <div style="font-size:12px;color:#666;margin-bottom:4px">发送按钮等待超时(ms)</div>
              <input type="number" id="cfg-send-button-timeout-ms" placeholder="60000" />
            </div>
          </div>
        </div>
        <div class="form-group">
          <label>ibbot URL</label>
          <input type="text" id="cfg-ibbot-url" placeholder="https://your-ibbot-endpoint" />
        </div>
        <div class="form-group">
          <label>ibbot Token</label>
          <input type="password" id="cfg-ibbot-token" placeholder="用于鉴权的 token" />
        </div>
        <div class="form-group">
          <button id="cfg-save-settings" style="width:100%;background:#16a34a">保存</button>
        </div>
      </div>
    `;

    const style = `
      <style>
          #screenshot-task-sidebar {
            position: fixed;
            right: 0;
            top: 0;
            width: 420px;
            height: 100vh;
            background: #fff;
            box-shadow: -2px 0 5px rgba(0,0,0,0.15);
            z-index: 10000;
            padding: 20px;
            box-sizing: border-box;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
            overflow-y: auto; /* 允许内容滚动，避免底部表单被遮挡 */
            -webkit-overflow-scrolling: touch; /* 移动端更顺滑的滚动 */
          }

          .sidebar-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
          }
          .sidebar-header h2 { margin: 0; font-size: 18px; }
          .sidebar-header > div { display: flex; gap: 10px; }

          .form-group { margin-bottom: 16px; }
          .form-group label { display:block; margin-bottom: 8px; font-weight: 600; }
          .form-group select, .form-group input {
            width: 100%;
            padding: 8px;
            border: 1px solid #ddd;
            border-radius: 4px;
            box-sizing: border-box;
          }

          button {
            padding: 8px 12px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            background: #4a90e2;
            color: white;
            font-size: 14px;
          }
          button:hover { background: #357abd; }

          .ai-platform-toggle {
            display: flex;
            gap: 8px;
          }
          .ai-platform-btn {
            flex: 1;
            background: #f3f4f6;
            color: #333;
            border: 1px solid #d1d5db;
          }
          .ai-platform-btn:hover {
            background: #e5e7eb;
          }
          .ai-platform-btn.active {
            background: #2563eb;
            border-color: #2563eb;
            color: #fff;
          }

          #close-sidebar-btn { background: #e2e2e2; color:#333; }
          #close-sidebar-btn:hover { background: #d1d1d1; }

          .text-row { display:flex; gap:8px; align-items:center; }
          .text-row input { flex:1; }
          .remove-text { background:#f44336; }
          .remove-text:hover { background:#d32f2f; }
      </style>
    `;

    document.body.insertAdjacentHTML('beforeend', sidebarHTML);
    document.head.insertAdjacentHTML('beforeend', style);

    initializeSettingsPanel();
  }
}

function initializeSettingsPanel() {
  const sidebar = document.getElementById('screenshot-task-sidebar');
  if (!sidebar) return;

  const areaSel = sidebar.querySelector('#cfg-screenshot-area');
  const selectorInput = sidebar.querySelector('#cfg-selector');
  const hotkeyInput = sidebar.querySelector('#cfg-hotkey');
  const quickHotkeyInput = sidebar.querySelector('#cfg-quick-hotkey');
  const textsContainer = sidebar.querySelector('#cfg-texts-container');
  const addTextBtn = sidebar.querySelector('#cfg-add-text');
  const tabsSelect = sidebar.querySelector('#ai-tabs-select');
  const refreshTabsBtn = sidebar.querySelector('#refresh-ai-tabs-btn');
  const tabsLabel = sidebar.querySelector('#cfg-tabs-label');
  const platformButtons = Array.from(sidebar.querySelectorAll('.ai-platform-btn'));
  const closeBtn = sidebar.querySelector('#close-sidebar-btn');
  const saveBtn = sidebar.querySelector('#cfg-save-settings');
  const autoSendCheckbox = sidebar.querySelector('#cfg-auto-send-after-upload');
  const ibbotUrlInput = sidebar.querySelector('#cfg-ibbot-url');
  const ibbotTokenInput = sidebar.querySelector('#cfg-ibbot-token');
  const replyTimeoutInput = sidebar.querySelector('#cfg-reply-timeout-ms');
  const replyStableCyclesInput = sidebar.querySelector('#cfg-reply-stable-cycles');
  const replyPollIntervalInput = sidebar.querySelector('#cfg-reply-poll-interval-ms');
  const sendBtnTimeoutInput = sidebar.querySelector('#cfg-send-button-timeout-ms');

  let draft = null; // 草稿设置，点击保存时一次性提交
  let dragIndex = null;

  const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const formatHotkeyForDisplay = (normalized) => {
    const parts = String(normalized || '').split('+').filter(Boolean);
    return parts.map(p => {
      const up = p.toLowerCase();
      if (["ctrl","shift","alt","meta"].includes(up)) return capitalize(up);
      return up.length === 1 ? up.toUpperCase() : capitalize(up);
    }).join('+');
  };

  function renderTexts(textsArr) {
    textsContainer.innerHTML = '';
    (textsArr && textsArr.length ? textsArr : ['']).forEach((t, idx) => {
      const row = document.createElement('div');
      row.className = 'text-row';
      row.setAttribute('draggable', 'true');
      row.dataset.index = String(idx);
      row.innerHTML = `
        <input type="text" data-index="${idx}" value="${(t || '').replace(/"/g, '&quot;')}">
        <button class="remove-text" data-index="${idx}">删除</button>
      `;
      textsContainer.appendChild(row);
    });
  }

  function collectTexts() {
    const inputs = textsContainer.querySelectorAll('input[type="text"][data-index]');
    return Array.from(inputs).map(i => i.value || '');
  }

  const PLATFORM_UI = {
    chatgpt: {
      refreshLabel: '刷新 ChatGPT 标签',
    },
    google: {
      refreshLabel: '刷新 Google 标签',
    },
  };

  function refreshPlatformTabs(selectedId) {
    const platform = normalizePlatform(draft?.targetPlatform);
    const meta = getPlatformMeta(platform);
    tabsSelect.innerHTML = '';
    const autoOpt = document.createElement('option');
    autoOpt.value = '';
    autoOpt.textContent = `自动选择（当前活动的 ${meta.label} 标签）`;
    tabsSelect.appendChild(autoOpt);

    if (!chrome?.runtime?.id) {
      console.warn('扩展上下文不可用，无法刷新标签列表');
      return;
    }

    try {
      chrome.runtime.sendMessage({ type: meta.listMessageType }, (resp) => {
        if (chrome.runtime.lastError) {
          console.warn(`${meta.listMessageType} 调用失败：`, chrome.runtime.lastError.message || chrome.runtime.lastError);
          return;
        }
        const tabs = (resp && resp.success && Array.isArray(resp.tabs)) ? resp.tabs : [];
        let activeId = '';
        tabs.forEach(t => {
          const opt = document.createElement('option');
          opt.value = String(t.id);
          opt.textContent = `${t.active ? '[活动] ' : ''}${t.title || t.url || meta.label} (ID: ${t.id})`;
          tabsSelect.appendChild(opt);
          if (t.active) activeId = String(t.id);
        });
        const preferred = (selectedId !== undefined && selectedId !== null) ? String(selectedId) : '';
        const hasPreferred = preferred && Array.from(tabsSelect.options).some(opt => opt.value === preferred);
        if (hasPreferred) {
          tabsSelect.value = preferred;
        } else if (activeId) {
          tabsSelect.value = activeId;
        } else {
          tabsSelect.value = '';
        }
      });
    } catch (e) {
      console.warn('刷新标签时出现异常：', e);
    }
  }

  function setActivePlatform(platform, { forceRefresh = false } = {}) {
    const normalized = normalizePlatform(platform);
    const previous = normalizePlatform(draft?.targetPlatform);
    if (draft) {
      draft.targetPlatform = normalized;
    }
    settings.targetPlatform = normalized;
    platformButtons.forEach((btn) => {
      const btnPlatform = normalizePlatform(btn.dataset.platform);
      btn.classList.toggle('active', btnPlatform === normalized);
    });
    if (tabsLabel) {
      tabsLabel.textContent = `${getPlatformLabel(normalized)} 标签页`;
    }
    const uiCfg = PLATFORM_UI[normalized] || PLATFORM_UI.chatgpt;
    if (refreshTabsBtn) {
      refreshTabsBtn.textContent = uiCfg.refreshLabel;
    }
    if (forceRefresh || normalized !== previous) {
      const storedId = getPlatformTabIdFrom(draft, normalized);
      const selectedValue = storedId != null ? String(storedId) : '';
      refreshPlatformTabs(selectedValue);
    }
  }

  // 绑定事件
  closeBtn.addEventListener('click', () => {
    sidebar.style.display = 'none';
    chrome.storage.local.set({ sidebarVisible: false });
  });

  addTextBtn.addEventListener('click', () => {
    const next = collectTexts().concat('');
    draft.texts = next;
    renderTexts(draft.texts);
  });

  platformButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!draft) return;
      const btnPlatform = normalizePlatform(btn.dataset.platform);
      const current = normalizePlatform(draft.targetPlatform);
      const forceRefresh = btnPlatform === current;
      setActivePlatform(btnPlatform, { forceRefresh });
    });
  });

  autoSendCheckbox.addEventListener('change', () => {
    draft.autoSendAfterUpload = !!autoSendCheckbox.checked;
  });
  ibbotUrlInput.addEventListener('input', () => {
    draft.ibbotUrl = ibbotUrlInput.value || '';
  });
  ibbotTokenInput.addEventListener('input', () => {
    draft.ibbotToken = ibbotTokenInput.value || '';
  });
  replyTimeoutInput.addEventListener('input', () => {
    draft.replyWaitTimeoutMs = Number(replyTimeoutInput.value || 0) || 120000;
  });
  replyStableCyclesInput.addEventListener('input', () => {
    draft.replyStableCycles = Math.max(1, Number(replyStableCyclesInput.value || 0) || 6);
  });
  replyPollIntervalInput.addEventListener('input', () => {
    draft.replyPollIntervalMs = Math.max(50, Number(replyPollIntervalInput.value || 0) || 500);
  });
  sendBtnTimeoutInput.addEventListener('input', () => {
    draft.sendButtonWaitTimeoutMs = Number(sendBtnTimeoutInput.value || 0) || 60000;
  });

  // 文本输入变更（不立刻保存，只更新草稿）
  textsContainer.addEventListener('input', (e) => {
    if (e.target && e.target.matches('input[type="text"][data-index]')) {
      draft.texts = collectTexts();
    }
  });

  // 删除一条文本（不立刻保存）
  textsContainer.addEventListener('click', (e) => {
    if (e.target && e.target.classList.contains('remove-text')) {
      const idx = Number(e.target.getAttribute('data-index'));
      const arr = collectTexts();
      arr.splice(idx, 1);
      draft.texts = arr;
      renderTexts(draft.texts);
    }
  });

  // 拖拽排序
  textsContainer.addEventListener('dragstart', (e) => {
    const row = e.target.closest('.text-row');
    if (!row) return;
    dragIndex = Number(row.dataset.index || row.querySelector('input')?.dataset.index || 0);
    e.dataTransfer.effectAllowed = 'move';
  });
  textsContainer.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  });
  textsContainer.addEventListener('drop', (e) => {
    e.preventDefault();
    const targetRow = e.target.closest('.text-row');
    if (!targetRow || dragIndex == null) return;
    const targetIndex = Number(targetRow.dataset.index || targetRow.querySelector('input')?.dataset.index || 0);
    if (targetIndex === dragIndex) return;
    const arr = collectTexts();
    const [moved] = arr.splice(dragIndex, 1);
    arr.splice(targetIndex, 0, moved);
    draft.texts = arr;
    renderTexts(draft.texts);
    dragIndex = null;
  });
  textsContainer.addEventListener('dragend', () => { dragIndex = null; });

  areaSel.addEventListener('change', () => {
    const val = areaSel.value;
    selectorInput.style.display = val === 'selector' ? 'block' : 'none';
    draft.screenshotArea = val;
  });
  selectorInput.addEventListener('input', () => {
    draft.selector = selectorInput.value;
  });

  hotkeyInput.addEventListener('keydown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.metaKey) parts.push('Meta');
    if (e.shiftKey) parts.push('Shift');
    if (e.altKey) parts.push('Alt');
    const key = e.key && e.key.length === 1 ? e.key.toUpperCase() : (e.key || '').toUpperCase();
    if (key && !['CONTROL','META','SHIFT','ALT'].includes(key)) parts.push(key);
    const display = parts.join('+') || 'Ctrl+Shift+S';
    hotkeyInput.value = display;
    draft.hotkey = display;
  }, true);

  quickHotkeyInput.addEventListener('keydown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.metaKey) parts.push('Meta');
    if (e.shiftKey) parts.push('Shift');
    if (e.altKey) parts.push('Alt');
    const key = e.key && e.key.length === 1 ? e.key.toUpperCase() : (e.key || '').toUpperCase();
    if (key && !['CONTROL','META','SHIFT','ALT'].includes(key)) parts.push(key);
    const display = parts.join('+') || 'Ctrl+Shift+Q';
    quickHotkeyInput.value = display;
    draft.quickHotkey = display;
  }, true);

  refreshTabsBtn.addEventListener('click', () => {
    if (!draft) return;
    refreshPlatformTabs(tabsSelect.value || '');
  });

  tabsSelect.addEventListener('change', () => {
    if (!draft) return;
    const val = tabsSelect.value;
    const normalized = normalizePlatform(draft.targetPlatform);
    setPlatformTabIdFor(draft, normalized, val && val !== '' ? Number(val) : null);
    setPlatformTabIdFor(settings, normalized, val && val !== '' ? Number(val) : null);
  });


  // 保存按钮：一次性保存草稿
  saveBtn.addEventListener('click', () => {
    if (!draft) return;
    // 最终收集 UI 值，避免遗漏
    draft.texts = collectTexts();
    draft.selector = selectorInput.value;
    draft.screenshotArea = areaSel.value;
    const normalized = normalizePlatform(draft.targetPlatform);
    const selectedVal = tabsSelect.value;
    setPlatformTabIdFor(draft, normalized, selectedVal && selectedVal !== '' ? Number(selectedVal) : null);
    draft.targetPlatform = normalized;
    saveSettings(draft, () => {
      console.log('设置已保存');
    });
  });

  // 初始化填充
  loadSettings((s) => {
    draft = JSON.parse(JSON.stringify(s));
    draft.targetPlatform = normalizePlatform(draft.targetPlatform);
    areaSel.value = draft.screenshotArea || 'full';
    selectorInput.style.display = areaSel.value === 'selector' ? 'block' : 'none';
    selectorInput.value = draft.selector || '';
    hotkeyInput.value = formatHotkeyForDisplay((draft.hotkey || 'Ctrl+Shift+S').replace(/\s+/g, '').toLowerCase());
    quickHotkeyInput.value = formatHotkeyForDisplay((draft.quickHotkey || 'Ctrl+Shift+Q').replace(/\s+/g, '').toLowerCase());
    renderTexts(Array.isArray(draft.texts) ? draft.texts : ['']);
    autoSendCheckbox.checked = !!draft.autoSendAfterUpload;
    ibbotUrlInput.value = draft.ibbotUrl || '';
    ibbotTokenInput.value = draft.ibbotToken || '';
    replyTimeoutInput.value = draft.replyWaitTimeoutMs != null ? draft.replyWaitTimeoutMs : '';
    replyStableCyclesInput.value = draft.replyStableCycles != null ? draft.replyStableCycles : '';
    replyPollIntervalInput.value = draft.replyPollIntervalMs != null ? draft.replyPollIntervalMs : '';
    sendBtnTimeoutInput.value = draft.sendButtonWaitTimeoutMs != null ? draft.sendButtonWaitTimeoutMs : '';
    setActivePlatform(draft.targetPlatform, { forceRefresh: true });
  });
}

// 避免旧版侧边栏覆盖新设置面板
function injectSidebar_legacy_disabled() {
  console.warn('Legacy task sidebar is disabled.');
}


function isRecoverableRuntimeError(msg) {
  const m = String(msg || '').toLowerCase();
  return [
    'extension context invalidated',
    'receiving end does not exist',
    'could not establish connection',
    'message port closed',
    'no receiving end',
    'message channel closed'
  ].some(s => m.includes(s));
}

function sendMessageSafe(payload, retries = 3, delay = 600) {
  return new Promise((resolve, reject) => {
    const attempt = (left) => {
      try {
        chrome.runtime.sendMessage(payload, (resp) => {
          const err = chrome.runtime.lastError;
          if (err) {
            if (left > 0 && isRecoverableRuntimeError(err.message)) {
              setTimeout(() => attempt(left - 1), delay);
            } else {
              reject(new Error(err.message || 'sendMessage failed'));
            }
          } else {
            resolve(resp);
          }
        });
      } catch (e) {
        if (left > 0 && isRecoverableRuntimeError(e.message)) {
          setTimeout(() => attempt(left - 1), delay);
        } else {
          reject(e);
        }
      }
    };
    attempt(retries);
  });
}

// 新增：等待发送按钮可用、点击发送、等待助手回复完成、发送提示词并等待
function getSendButtonElement() {
  const platform = normalizePlatform(activeComposePlatform);
  const selectors = [
    'button[data-testid="send-button"]',
    'button[data-testid*="send" i]',
    'button[aria-label*="send" i]',
    'button[aria-label*="发送" i]',
    'form button[type="submit"]'
  ];
  if (platform === 'google') {
    selectors.push(
      'button[aria-label*="submit" i]',
      'button[aria-label*="回复" i]',
      'button[aria-label*="回答" i]',
      'button[aria-label*="create" i]',
      'button[aria-label*="start" i]'
    );
  }
  const seen = new Set();
  for (const sel of selectors) {
    if (seen.has(sel)) continue;
    seen.add(sel);
    const btn = document.querySelector(sel);
    if (btn && isVisible(btn)) return btn;
  }
  return null;
}

async function waitForSendButtonEnabled(timeout = 60000) {
  const btn = await waitFor(() => {
    const b = getSendButtonElement();
    return b && !b.disabled ? b : null;
  }, timeout, 200);
  return !!btn;
}

async function clickSendButtonWhenEnabled(timeout = 60000) {
  const ok = await waitForSendButtonEnabled(timeout);
  if (!ok) return false;
  const btn = getSendButtonElement();
  if (!btn) return false;
  btn.click();
  return true;
}

function getLastAssistantMessageEl() {
  const selectors = [
    '[data-message-author-role="assistant"]',
    'div[data-testid="conversation-turn"]',
    'div[data-testid*="response" i]',
    'article[data-testid*="response" i]',
    'div[aria-live="polite"] article',
    'section[aria-live] article'
  ];
  const collected = [];
  const seen = new Set();
  selectors.forEach((sel) => {
    document.querySelectorAll(sel).forEach((node) => {
      if (!seen.has(node)) {
        seen.add(node);
        collected.push(node);
      }
    });
  });
  const candidates = collected;
  const last = candidates.length ? candidates[candidates.length - 1] : null;
  return last || null;
}

function getLastAssistantText() {
  const el = getLastAssistantMessageEl();
  if (!el) return '';
  // 常见内容容器
  const textEl = el.querySelector('.markdown, [data-message-author-role="assistant"], .prose, article, div, [data-testid*="response" i]');
  return (textEl ? textEl.innerText : el.innerText) || '';
}

function isGenerating() {
  // 存在“停止生成/Stop generating”按钮时，通常表示仍在生成
  const stopBtn = document.querySelector('button[aria-label*="stop" i], button[aria-label*="停止" i]');
  return !!(stopBtn && isVisible(stopBtn));
}

async function waitForAssistantResponseDone(timeout = 120000, stableCycles = 6, pollInterval = 500) {
  const end = Date.now() + timeout;
  let last = getLastAssistantText();
  let stable = 0;
  while (Date.now() < end) {
    await new Promise(r => setTimeout(r, pollInterval));
    const cur = getLastAssistantText();
    if (cur && cur === last && !isGenerating()) {
      stable++;
      if (stable >= stableCycles) return cur;
    } else {
      stable = 0;
      last = cur;
    }
  }
  return last || '';
}

async function sendPromptAndWait(promptText) {
  await fillTextAndSend(promptText);
  const clicked = await clickSendButtonWhenEnabled(settings.sendButtonWaitTimeoutMs || 60000);
  if (!clicked) throw new Error('发送按钮不可用');
  return await waitForAssistantResponseDone(
    settings.replyWaitTimeoutMs || 120000,
    settings.replyStableCycles || 6,
    settings.replyPollIntervalMs || 500
  );
}

function buildJsonPrompt() {
  return (
    '请仅返回 JSON，不要包含任何多余文字、解释或 Markdown 代码块。' +
    '生成一个 JSON 数组（如果有多条建议，按推荐程度从高到低排序）。' +
    '字段名称必须为英文，字段定义如下：\n' +
    '- strategyName: 策略名称（字符串）\n' +
    '- action: 策略动作（open/close/add）\n' +
    '- conditions: 数组。当 action 为 open 或 add 时，每一项包含：{ direction: "long"|"short", condition: 文本, SL: 文本, TP: 文本 }；当 action 为 close 时，每一项至少包含 { condition: 文本 }\n' +
    '- shouldTrade: 是否建议交易（布尔 true/false）。\n' +
    '- priority: 数值型，越大表示推荐程度越高。\n' +
    '请确保整个数组已按 priority 从高到低排序。只输出纯 JSON 数组，不要加反引号或注释。'
  );
}

function extractJsonFromText(text) {
  const t = String(text || '').trim();
  // 先尝试直接解析
  try { return JSON.parse(t); } catch {}
  // 尝试截取第一个 JSON 数组
  const startArr = t.indexOf('[');
  const endArr = t.lastIndexOf(']');
  if (startArr !== -1 && endArr !== -1 && endArr > startArr) {
    const sub = t.slice(startArr, endArr + 1);
    try { return JSON.parse(sub); } catch {}
  }
  // 退化：尝试对象
  const startObj = t.indexOf('{');
  const endObj = t.lastIndexOf('}');
  if (startObj !== -1 && endObj !== -1 && endObj > startObj) {
    const sub2 = t.slice(startObj, endObj + 1);
    try { return JSON.parse(sub2); } catch {}
  }
  console.warn('未能从文本中提取有效 JSON');
  return null;
}

function normalizeStrategyJson(data) {
  try {
    if (!data) return null;
    let arr = Array.isArray(data) ? data : [data];
    arr = arr.filter(Boolean).map((item) => {
      const it = (item && typeof item === 'object') ? item : {};
      let p = Number(it.priority);
      if (!Number.isFinite(p)) p = 0;
      return Object.assign({}, it, { priority: p });
    });
    arr.sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0));
    return arr;
  } catch {
    return null;
  }
}
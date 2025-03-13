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
    chrome.runtime.sendMessage({
      type: 'startTask',
      task: task
    });
  } else {
    chrome.runtime.sendMessage({
      type: 'stopTask',
      taskId: taskId
    });
  }
  
  chrome.storage.local.set({ tasks });
  renderTasks();
}

// Add message listener for task execution
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'executeTask') {
    captureAndSend(request.task);
  }
  if (request.type === 'toggleSidebar') {
    console.log('收到 toggleSidebar 消息');
    const sidebar = document.getElementById('screenshot-task-sidebar');
    if (sidebar) {
      // 如果侧边栏已存在，切换其显示状态
      chrome.storage.local.get(['sidebarVisible'], (result) => {
        const isVisible = result.sidebarVisible !== false;
        console.log('当前侧边栏状态:', isVisible ? '显示' : '隐藏');
        sidebar.style.display = isVisible ? 'none' : 'block';
        chrome.storage.local.set({ sidebarVisible: !isVisible });
      });
    } else {
      // 如果侧边栏不存在，注入并显示
      console.log('侧边栏不存在，正在注入...');
      injectSidebar();
      // 确保侧边栏显示
      setTimeout(() => {
        const newSidebar = document.getElementById('screenshot-task-sidebar');
        if (newSidebar) {
          newSidebar.style.display = 'block';
          chrome.storage.local.set({ sidebarVisible: true });
        }
      }, 100);
    }
    // 发送响应表示消息已处理
    if (sendResponse) {
      sendResponse({ success: true });
    }
  }
});

// 修改 editTask 函数
function editTask(taskId) {
  const task = tasks[taskId];
  if (!task) return;

  const form = document.getElementById('task-form');
  const modal = document.getElementById('task-modal');
  const selectorInput = form.querySelector('[name="selector"]');

  form.elements['screenshotArea'].value = task.screenshotArea;
  form.elements['selector'].value = task.selector;
  form.elements['interval'].value = task.interval;
  form.elements['apiUrl'].value = task.apiUrl;
  form.elements['apiToken'].value = task.apiToken;

  // Show/hide selector input based on screenshotArea value
  selectorInput.style.display = task.screenshotArea === 'selector' ? 'block' : 'none';

  // Store editing task ID
  form.dataset.editTaskId = taskId;

  modal.style.display = 'flex';
}

// 修改 deleteTask 函数
function deleteTask(taskId) {
  const task = tasks[taskId];
  if (!task) return;

  if (task.active) {
    clearInterval(task.intervalId);
  }
  
  delete tasks[taskId];
  chrome.storage.local.set({ tasks });
  renderTasks();
}

function stopAllTasks() {
  Object.values(tasks).forEach(task => {
    if (task.active) {
      clearInterval(task.intervalId);
      task.active = false;
    }
  });
  chrome.storage.local.set({ tasks });
}



async function captureElement(element) {
  // Get device pixel ratio for scaling
  const pixelRatio = window.devicePixelRatio;
  
  // Get scroll position
  const scrollLeft = window.scrollX || document.documentElement.scrollLeft;
  const scrollTop = window.scrollY || document.documentElement.scrollTop;
  
  // Get element dimensions
  const rect = element.getBoundingClientRect();
  
  // Calculate actual dimensions accounting for DPI and scroll
  const dimensions = {
      x: Math.round(rect.width * pixelRatio * 3 / 4),
      y: Math.round((rect.top + scrollTop) * pixelRatio),
      width: Math.round(rect.width * pixelRatio / 4),
      height: Math.round(rect.height * pixelRatio)
  };

  // For full page, use scrollWidth/scrollHeight
  if (element === document.documentElement) {
      dimensions.width = Math.round(element.scrollWidth * pixelRatio);
      dimensions.height = Math.round(element.scrollHeight * pixelRatio);
  }

  const response = await chrome.runtime.sendMessage({
      type: 'captureScreenshot',
      data: dimensions
  });

  // Convert array back to Blob
  return new Blob([new Uint8Array(response.data)], {
      type: response.type
  });
}

async function captureAndSend(task) {
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
        console.log('截图发送成功');
      } else {
        console.error('截图发送失败:', response ? response.error : '未知错误');
      }
    });
  } catch (error) {
    console.error('Screenshot capture/send failed:', error);
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

// 添加 injectSidebar 函数定义
function injectSidebar() {
  if (!document.getElementById('screenshot-task-sidebar')) {
    const sidebarHTML = `
      <div id="screenshot-task-sidebar" style="display: block;">
        <div class="sidebar-header">
          <h2>Screenshot Tasks</h2>
          <button id="add-task-btn">Add Task</button>
          <button id="close-sidebar-btn">Close</button>
        </div>
        <div id="task-list"></div>
      </div>

      <div id="task-modal" class="modal" style="display: none;">
        <div class="modal-content">
          <h3>Add/Edit Task</h3>
          <form id="task-form">
            <div class="form-group">
              <label>Screenshot Area:</label>
              <select name="screenshotArea">
                <option value="full">Full Page</option>
                <option value="selector">CSS Selector</option>
              </select>
              <input type="text" name="selector" placeholder="Enter CSS selector" style="display:none">
            </div>
            <div class="form-group">
              <label>Interval:</label>
              <select name="interval">
                <option value="60000">1 minutes</option>
                <option value="300000">5 minutes</option>
                <option value="900000">15 minutes</option>
                <option value="1800000">30 minutes</option>
                <option value="3600000">1 hour</option>
                <option value="86400000">1 day</option>
              </select>
            </div>
            <div class="form-group">
              <label>API Endpoint:</label>
              <input type="url" name="apiUrl" required>
              <input type="text" name="apiToken" placeholder="API Token" required>
            </div>
            <button type="submit">Save Task</button>
            <button type="button" class="cancel-btn">Cancel</button>
          </form>
        </div>
      </div>
    `;

    const style = `
      <style>
          #screenshot-task-sidebar {
          position: fixed;
          right: 0;
          top: 0;
          width: 400px;
          height: 100vh;
          background: white;
          box-shadow: -2px 0 5px rgba(0,0,0,0.2);
          z-index: 10000;
          padding: 20px;
          box-sizing: border-box;
          }

          .modal {
          display: none;
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0,0,0,0.5);
          z-index: 10001;
          display: flex;
          align-items: center;
          justify-content: center;
          }

          .modal-content {
          background: white;
          width: 400px;
          max-width: 90%;
          padding: 25px;
          border-radius: 8px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          position: relative;
          }

          .form-group {
          margin-bottom: 20px;
          }

          .form-group label {
          display: block;
          margin-bottom: 8px;
          font-weight: bold;
          }

          .form-group select,
          .form-group input {
          width: 100%;
          padding: 8px;
          border: 1px solid #ddd;
          border-radius: 4px;
          box-sizing: border-box;
          }

          .task-item {
          border: 1px solid #ddd;
          padding: 15px;
          margin-bottom: 15px;
          border-radius: 5px;
          background: #f9f9f9;
          }

          .task-controls {
          margin-top: 15px;
          display: flex;
          gap: 10px;
          }

          button {
          padding: 8px 16px;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          background: #4a90e2;
          color: white;
          font-size: 14px;
          }

          button:hover {
          background: #357abd;
          }

          .cancel-btn {
          background: #e2e2e2;
          color: #333;
          }

          .cancel-btn:hover {
          background: #d1d1d1;
          }

          #add-task-btn {
          margin-bottom: 20px;
          }
          
          #close-sidebar-btn {
          margin-bottom: 20px;
          }

          .sidebar-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
          }

          .sidebar-header h2 {
          margin: 0;
          font-size: 20px;
          }
          #close-sidebar-btn {
            background: #e2e2e2;
            margin-left: 10px;
          }
          .sidebar-header > div {
            display: flex;
            gap: 10px;
          }
      </style>
      `;

    document.body.insertAdjacentHTML('beforeend', sidebarHTML);
    document.head.insertAdjacentHTML('beforeend', style);

    console.log('侧边栏已注入，正在初始化...');
    initializeTaskManager();
  }
}
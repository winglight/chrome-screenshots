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
    const taskData = {
      id: Date.now(),
      screenshotArea: formData.get('screenshotArea'),
      selector: formData.get('selector'),
      interval: parseInt(formData.get('interval')),
      apiUrl: formData.get('apiUrl'),
      apiToken: formData.get('apiToken'),
      active: false
    };

    if (form.dataset.editTaskId && tasks[form.dataset.editTaskId]?.active) {
      taskData.active = true;
      taskData.intervalId = tasks[form.dataset.editTaskId].intervalId;
    }

    tasks[taskData.id] = taskData;
    chrome.storage.local.set({ tasks });
    modal.style.display = 'none';
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
    captureAndSend(task);
    task.intervalId = setInterval(() => {
      captureAndSend(task);
    }, task.interval);
  } else {
    clearInterval(task.intervalId);
  }
  
  chrome.storage.local.set({ tasks });
  renderTasks();
}

// 修改 editTask 函数
function editTask(taskId) {
  const task = tasks[taskId];
  if (!task) return;

  const form = document.getElementById('task-form');
  const modal = document.getElementById('task-modal');

  form.elements['screenshotArea'].value = task.screenshotArea;
  form.elements['selector'].value = task.selector;
  form.elements['interval'].value = task.interval;
  form.elements['apiUrl'].value = task.apiUrl;
  form.elements['apiToken'].value = task.apiToken;

  // 存储当前编辑的任务ID
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
  const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
  const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
  
  // Get element dimensions
  const rect = element.getBoundingClientRect();
  
  // Calculate actual dimensions accounting for DPI and scroll
  const dimensions = {
      x: Math.round((rect.left + scrollLeft) * pixelRatio),
      y: Math.round((rect.top + scrollTop) * pixelRatio),
      width: Math.round(rect.width * pixelRatio),
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
  
  if (!element) return;

  try {
    // const canvas = await html2canvas(element);
    const screenshot = await captureElement(element);
    // const blob = await new Promise(resolve => screenshot.toBlob(resolve));
    // const screenshotBlob = screenshot instanceof Blob ? screenshot : 
    //   await fetch(screenshot).then(r => r.blob());
    
    const formData = new FormData();
    formData.append('screenshot', screenshot, 'screenshot.png');
    
    await fetch(task.apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${task.apiToken}`
      },
      body: formData
    });
  } catch (error) {
    console.error('Screenshot capture/send failed:', error);
  }
}

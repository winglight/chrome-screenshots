let tasks = {};

function initializeTaskManager() {
  const addTaskBtn = document.getElementById('add-task-btn');
  const modal = document.getElementById('task-modal');
  const form = document.getElementById('task-form');
  const cancelBtn = document.querySelector('.cancel-btn');
  
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
    taskElement.innerHTML = `
      <div>Screenshot: ${task.screenshotArea === 'full' ? 'Full Page' : `Selector: ${task.selector}`}</div>
      <div>Interval: ${task.interval/1000/60} minutes</div>
      <div>API Endpoint: ${task.apiUrl}</div>
      <div class="task-controls">
        <button onclick="toggleTask(${task.id})">${task.active ? 'Stop' : 'Start'}</button>
        <button onclick="editTask(${task.id})">Edit</button>
        <button onclick="deleteTask(${task.id})">Delete</button>
      </div>
    `;
    taskList.appendChild(taskElement);
  });
}

function toggleTask(taskId) {
  const task = tasks[taskId];
  task.active = !task.active;
  
  if (task.active) {
    task.intervalId = setInterval(() => {
      captureAndSend(task);
    }, task.interval);
  } else {
    clearInterval(task.intervalId);
  }
  
  chrome.storage.local.set({ tasks });
  renderTasks();
}

async function captureAndSend(task) {
  let element = task.screenshotArea === 'full' ? document.documentElement : 
                document.querySelector(task.selector);
  
  if (!element) return;

  try {
    const canvas = await html2canvas(element);
    const blob = await new Promise(resolve => canvas.toBlob(resolve));
    
    const formData = new FormData();
    formData.append('screenshot', blob, 'screenshot.png');
    
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

function editTask(taskId) {
  const task = tasks[taskId];
  const form = document.getElementById('task-form');
  const modal = document.getElementById('task-modal');

  form.elements['screenshotArea'].value = task.screenshotArea;
  form.elements['selector'].value = task.selector;
  form.elements['interval'].value = task.interval;
  form.elements['apiUrl'].value = task.apiUrl;
  form.elements['apiToken'].value = task.apiToken;

  modal.style.display = 'flex';
}

function deleteTask(taskId) {
  const task = tasks[taskId];
  if (task.active) {
    clearInterval(task.intervalId);
  }
  
  delete tasks[taskId];
  chrome.storage.local.set({ tasks });
  renderTasks();
}
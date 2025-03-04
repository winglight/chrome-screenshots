let intervalTasks = {};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'startTask') {
        const task = request.task;
        // Execute immediately
        executeTask(task, sender.tab.id);
        
        // Set up interval
        intervalTasks[task.id] = setInterval(() => {
            executeTask(task, sender.tab.id);
        }, task.interval);
        
        sendResponse({success: true});
    }
    
    if (request.type === 'stopTask') {
        if (intervalTasks[request.taskId]) {
            clearInterval(intervalTasks[request.taskId]);
            delete intervalTasks[request.taskId];
        }
        sendResponse({success: true});
    }
    return true;
});

async function executeTask(task, tabId) {
    try {
        chrome.tabs.sendMessage(tabId, {
            type: 'executeTask',
            task: task
        });
    } catch (error) {
        console.error(`Task ${task.id} execution failed:`, error);
    }
}

chrome.action.onClicked.addListener((tab) => {
  chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: () => {
          const sidebar = document.getElementById('screenshot-task-sidebar');
          if (sidebar) {
              chrome.storage.local.get(['sidebarVisible'], (result) => {
                  const isVisible = result.sidebarVisible !== false;
                  sidebar.style.display = isVisible ? 'none' : 'block';
                  chrome.storage.local.set({ sidebarVisible: !isVisible });
              });
          } else {
              injectSidebar();
              chrome.storage.local.set({ sidebarVisible: true });
          }
      }
  });
});
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'captureScreenshot') {
      chrome.tabs.captureVisibleTab(null, {format: 'png'}, async (dataUrl) => {
          const image = await createImageBitmap(await (await fetch(dataUrl)).blob());
          const canvas = new OffscreenCanvas(request.data.width, request.data.height);
          const ctx = canvas.getContext('2d');
          
          ctx.drawImage(image,
              request.data.x, request.data.y,
              request.data.width, request.data.height,
              0, 0,
              request.data.width, request.data.height
          );
          
          const blob = await canvas.convertToBlob({type: 'image/png'});
          // Convert Blob to ArrayBuffer for message passing
          const arrayBuffer = await blob.arrayBuffer();
          sendResponse({
              type: 'image/png',
              data: Array.from(new Uint8Array(arrayBuffer))
          });
      });
      return true; // Will respond asynchronously
  }
});

chrome.action.onClicked.addListener((tab) => {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: injectSidebar
    });
  });
  
  function injectSidebar() {
    if (!document.getElementById('screenshot-task-sidebar')) {
      const sidebarHTML = `
        <div id="screenshot-task-sidebar">
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
  
      initializeTaskManager();
    }
  }